import type { GameStore } from "./GameState.ts";
import type { InputState } from "./input.ts";
import { IDENTITY_TRANSFORM, Transform, composeTransforms, offsetTransform, type WorldTransform } from "./Transform.ts";
import type { World } from "./World.ts";

type StructureOp =
  | { readonly kind: "add"; readonly child: GameObject; readonly slot: number; readonly order: number }
  | { readonly kind: "remove"; readonly child: GameObject }
  | { readonly kind: "reorder"; readonly slot: number; readonly children: readonly GameObject[] };

/**
 * Base class for every persistent game object. Compiled components extend a
 * built-in that extends this. It owns the object tree, the dirty flag, the
 * component's props, and queued structural changes; it knows nothing about
 * rendering backends.
 *
 * `P` is the props type of a compiled component. A component with props
 * passes them (and the defaults for the optional ones) up through its
 * built-in's constructor, so they are available to field initialisers, which
 * run right after `super()` returns.
 */
/** The memos of each object that has any (`GameObject.$memo`); gone with the object. */
const memoCaches = new WeakMap<object, Map<string, { readonly deps: readonly unknown[]; readonly value: unknown }>>();

export class GameObject<P extends object = {}> {
  /** Marks runtime-provided classes; compiled components do not have this as an own static. */
  static readonly intrinsic = true;

  /**
   * Position, rotation and scale relative to the parent (unless `global`).
   * Every game object has one, so any built-in element can be placed; set
   * with the `transform={{ x, y }}` attribute.
   */
  readonly transform: Transform = new Transform();
  /**
   * Where the parent placed this object, composed under `transform`: a
   * component's own (state-driven) `transform` moves it relative to its
   * placement, so `<Mover transform={{ x: 200 }} />` starts at 200 and moves
   * from there. Set by the parent's `transform` attribute on a component
   * element, or by a scene; identity otherwise.
   */
  readonly placement: Transform = new Transform();
  /**
   * Where layout put this object, in its parent's space, composed before `placement`
   * (`world = parent × layout × placement × transform`). Written by the player's layout pass (a `<Flex>`
   * placing its children), never by components, and zero for anything layout does not place. Only a position:
   * layout never turns or scales anything.
   */
  layoutX = 0;
  layoutY = 0;
  /** The component's props: a private copy, updated in place by `updateProps`. */
  props: P;
  parent: GameObject | null = null;
  /**
   * The game state this object reads from (`useGame(s => …)`), and the dotted paths it reads. Generated code overrides
   * both. While the object is in a world it is told when one of those paths changes, and re-renders.
   */
  readonly gameStateStore: GameStore | null = null;
  readonly gameStateKeys: readonly string[] = NO_KEYS;
  /**
   * True for an object that takes no part in `<Flex>` layout itself, like CSS's `display: contents`: a `<Flex>` above it lays out
   * its children as if they were its own. A compiled component whose root is another component is one (`BuildMenu` rendering
   * `<Panel>`), so the panel still grows to the column it sits in. Such an object should sit at its parent's origin.
   */
  readonly layoutContents: boolean = false;
  readonly children: GameObject[] = [];
  world: World | null = null;
  /**
   * When this object, or anything under it, last changed what it draws (see `markChanged`): the `World`'s `serial` at the
   * time. The player's frame builder reuses the draw records of a subtree that has not changed since it built them.
   * `selfChangedAt` is the object's own change, `subtreeChangedAt` is its own or any descendant's. Zero: never.
   */
  selfChangedAt = 0;
  subtreeChangedAt = 0;
  /**
   * When what this object draws last changed apart from where it is: its own change other than a move (see `markMoved`), or any
   * change at all to something under it. An object whose stamps are newer than this one only moved, and the player can then
   * reuse what it drew for it with the new position.
   */
  contentChangedAt = 0;
  /**
   * Whether this object's `render()` reports each change it makes itself, with `markMoved` and `markChanged` on the objects it
   * wrote to. Generated components do, and set this; for any other class a render is taken to have changed the object and
   * every element it owns.
   */
  protected readonly reportsChanges: boolean = false;
  /** The player's per-object bookkeeping for reusing draw records. Owned by `FrameBuilder`; nothing else reads or writes it. */
  drawCache: object | null = null;
  /** What this object's class is to the player's frame builder (a sprite, a collider, …), kept here once it has asked so the walk reads a field; -1 until then. Owned by `FrameBuilder`. */
  drawKind = -1;

  constructor(props?: P, defaults?: Partial<P>) {
    this.props = { ...defaults, ...definedOnly(props) } as P;
  }

  /**
   * Apply changed props from the parent. A key whose value is `undefined`
   * falls back to its default; a key not mentioned is left alone. Compares
   * with `===` and returns whether anything changed, so the caller can mark
   * the component dirty exactly once.
   */
  protected applyProps(next: Partial<P>, defaults: Partial<P> = {}): boolean {
    let changed = false;
    for (const key of Object.keys(next) as (keyof P)[]) {
      const value = (next[key] === undefined ? defaults[key] : next[key]) as P[keyof P];
      if (this.props[key] !== value) {
        this.props[key] = value;
        changed = true;
      }
    }
    return changed;
  }

  #dirty = false;
  /** The last pass of a World's `flush` that looked at this object (see `renderInPass`). */
  #renderPass = 0;
  #pending: StructureOp[] = [];
  /** Source position among the parent's children (see `addChild`); `Infinity` for unslotted children. */
  #slot = Infinity;
  /** Position within the slot: the item's index in a keyed list (see `queueReorder`); 0 otherwise. */
  #order = 0;
  /** `onMount` has run and `onUnmount` has not: each runs once per stay in a World. */
  #mounted = false;

  /**
   * Where children passed by a parent (`<Panel><Button /></Panel>`) mount: a
   * component that renders `{children}` sets these in its constructor to the
   * container holding that slot and the slot's position among that
   * container's children. The parent owns the passed children (their props,
   * their conditions); this only says where they go.
   */
  protected passedChildrenHost: GameObject | null = null;
  protected passedChildrenSlot = Infinity;
  /**
   * A component that writes `<Panel>{children}</Panel>` does not hold its children itself: it hands each one to the component
   * that does (which may hand it on again), so what the outer parent passes ends up in the innermost container.
   */
  protected passedChildrenForward: GameObject | null = null;

  /** Whether this component renders `{children}`, itself or through the component it forwards them to: a scene (or a parent) may pass it children. */
  get acceptsPassedChildren(): boolean {
    return this.passedChildrenHost !== null || this.passedChildrenForward !== null;
  }

  /** Immediately attach a passed child, at `order` among the passed children (the slot of `{children}` is fixed). */
  attachPassedChild(child: GameObject, order: number): void {
    if (this.passedChildrenForward !== null) return this.passedChildrenForward.attachPassedChild(child, order);
    this.#passedHost().addChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be attached when structure is next committed. */
  queueAttachPassedChild(child: GameObject, order: number): void {
    if (this.passedChildrenForward !== null) return this.passedChildrenForward.queueAttachPassedChild(child, order);
    this.#passedHost().queueAddChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be detached when structure is next committed. */
  queueDetachPassedChild(child: GameObject): void {
    if (this.passedChildrenForward !== null) return this.passedChildrenForward.queueDetachPassedChild(child);
    this.#passedHost().queueRemoveChild(child);
  }

  /** Queue a new order for the passed children (a keyed list passed as the whole of the children), see `queueReorder`. */
  queueReorderPassedChildren(children: readonly GameObject[]): void {
    if (this.passedChildrenForward !== null) return this.passedChildrenForward.queueReorderPassedChildren(children);
    this.#passedHost().queueReorder(this.passedChildrenSlot, children);
  }

  #passedHost(): GameObject {
    if (this.passedChildrenHost === null) {
      throw new Error(`${this.constructor.name} was given children but does not render {children}: declare \`children: Child\` in its props and write {children} where they belong.`);
    }
    return this.passedChildrenHost;
  }

  get isDirty(): boolean {
    return this.#dirty;
  }

  get hasPendingStructure(): boolean {
    return this.#pending.length > 0;
  }

  /**
   * Immediately attach a child. `slot` is the child's position in its parent's
   * source (generated code passes it when a parent has children that come and
   * go), so a child mounted later still lands between its source siblings:
   * it goes after every child whose slot is <= its own. Without a slot, the
   * child is appended (and stays after every slotted child). The items of a
   * keyed list share one slot and are ordered within it by `order`, their
   * index in the list, so children are always sorted by `(slot, order)`.
   */
  addChild(child: GameObject, slot: number = Infinity, order: number = 0): void {
    if (child.parent !== null) {
      throw new Error("GameObject already has a parent");
    }
    child.parent = this;
    child.drawCache = null; // its records were made under another parent
    child.#slot = slot;
    child.#order = order;
    // Children are sorted, so a child that sorts after the last one (the usual case: building a tree in
    // source order, or spawning into a list) is appended without a scan; mounting n children stays linear.
    const last = this.children[this.children.length - 1];
    if (last === undefined || last.#slot < slot || (last.#slot === slot && last.#order <= order)) {
      this.children.push(child);
    } else {
      const index = this.children.findIndex((sibling) => sibling.#slot > slot || (sibling.#slot === slot && sibling.#order > order));
      this.children.splice(index, 0, child);
    }
    this.markChanged();
    if (this.world !== null) child.attachToWorld(this.world);
  }

  /** Immediately detach a child. */
  removeChild(child: GameObject): void {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("GameObject is not a child of this object");
    this.markChanged();
    this.children.splice(index, 1);
    child.parent = null;
    child.drawCache = null;
    child.#slot = Infinity;
    child.#order = 0;
    child.detachFromWorld();
  }

  /** Queue a child to be attached (at `slot` and `order`, see `addChild`) when structure is next committed. */
  queueAddChild(child: GameObject, slot: number = Infinity, order: number = 0): void {
    this.#pending.push({ kind: "add", child, slot, order });
    this.world?.scheduleCommit(this);
  }

  /**
   * Queue a new order for the items of a keyed list (the children in `slot`):
   * when structure is next committed, each child's order becomes its index in
   * `children`, and the slot is re-sorted. Children in other slots keep their
   * positions. Queue it after the list's adds and removals.
   */
  queueReorder(slot: number, children: readonly GameObject[]): void {
    this.#pending.push({ kind: "reorder", slot, children });
    this.world?.scheduleCommit(this);
  }

  /** Queue a child to be detached when structure is next committed. */
  queueRemoveChild(child: GameObject): void {
    this.#pending.push({ kind: "remove", child });
    this.world?.scheduleCommit(this);
  }

  /** Apply queued structural changes in the order they were queued, then those of children just attached. */
  commitStructure(): void {
    const ops = this.#pending;
    this.#pending = [];
    for (const op of ops) {
      if (op.kind === "add") {
        this.addChild(op.child, op.slot, op.order);
        // A child that queued its own changes while it had no parent (nested conditionals)
        // is now attached; settle it too, so a subtree is complete without a World.
        if (op.child.hasPendingStructure) op.child.commitStructure();
      } else if (op.kind === "remove") {
        this.removeChild(op.child);
      } else {
        this.#reorder(op.slot, op.children);
      }
    }
  }

  #reorder(slot: number, children: readonly GameObject[]): void {
    children.forEach((child, index) => {
      if (child.parent === this && child.#slot === slot) child.#order = index;
    });
    this.markChanged();
    // Children are kept sorted by (slot, order), and the sort is stable, so only this slot's range can move.
    this.children.sort((a, b) => (a.#slot === b.#slot ? a.#order - b.#order : a.#slot < b.#slot ? -1 : 1));
  }

  /**
   * This object's transform in world space: the parent's, then this object's
   * layout offset (`layoutX`, `layoutY`), then its `placement`, then its own
   * `transform` (see `Transform`). A `global` placement ignores the parent and
   * the layout offset; a `global` transform ignores all three.
   */
  worldTransform(): WorldTransform {
    const parent = this.parent === null ? IDENTITY_TRANSFORM : this.parent.childSpace();
    return composeTransforms(composeTransforms(offsetTransform(parent, this.layoutX, this.layoutY), this.placement), this.transform);
  }

  /**
   * The space this object's children are placed in: its own world transform.
   * An object that is transparent to its children overrides it (a `Camera`
   * follows its children, so they must not move with it).
   */
  childSpace(): WorldTransform {
    return this.worldTransform();
  }

  /**
   * Say that something this object draws, or where it draws it, has changed outside a render: the player redraws this
   * object and what is under it on the next frame instead of reusing last frame's draw records for it.
   *
   * Compiled components never need this: a render (`runRender`), a structural change and an `AnimatedSprite` frame
   * report themselves. It is for code that writes a transform, a colour or a text directly, anywhere but in `render()`:
   * a hand-written class, a test, or a collision callback that reaches into another object. A class that overrides
   * `onInput` or `onUpdate` and is not a built-in is redrawn every frame anyway, as it is assumed to do exactly that,
   * so a hook there needs no call.
   */
  markChanged(): void {
    const world = this.world;
    if (world === null) return; // nothing has been drawn from a tree that is not in a world, so nothing is reused
    const serial = world.serial;
    this.selfChangedAt = serial;
    this.subtreeChangedAt = serial;
    // Stop at the first object whose content is already stamped with this serial: everything above it was stamped with it.
    for (let object: GameObject | null = this; object !== null && object.contentChangedAt !== serial; object = object.parent) {
      object.contentChangedAt = serial;
      object.subtreeChangedAt = serial;
    }
  }

  /**
   * Say that this object's own `transform` or `placement` has changed, and nothing else about it: the player draws it and what
   * is under it at the new place, and where it can, reuses the rest of what it drew for them last frame. A generated `render()`
   * calls this when it writes a different value to the component's transform; code that moves an object by hand, outside a
   * render, may call it instead of `markChanged`, which is always right but makes the player draw the subtree again.
   */
  markMoved(): void {
    const world = this.world;
    if (world === null) return;
    const serial = world.serial;
    this.selfChangedAt = serial;
    this.subtreeChangedAt = serial;
    // For everything above, something under it changed. (An ancestor that only moved itself this frame is passed through: its content had not changed until now.)
    for (let object = this.parent; object !== null && object.contentChangedAt !== serial; object = object.parent) {
      object.contentChangedAt = serial;
      object.subtreeChangedAt = serial;
    }
  }

  /**
   * For generated code: a component's derived value (`const hero = heroOf(run)`), worked out again only when one of `deps` (the state
   * and props it reads) is a different value than last time (`===`), as React's `useMemo`. So a render, and each handler that reads
   * it, sees the same value for as long as what it is made from stays the same. (The cache is kept outside the object, so objects
   * that have no memos are laid out exactly as before: the bench's frame time is measured on those.)
   */
  $memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
    let memos = memoCaches.get(this);
    if (memos === undefined) memoCaches.set(this, (memos = new Map()));
    const last = memos.get(key);
    if (last !== undefined && last.deps.length === deps.length && last.deps.every((d, i) => d === deps[i])) return last.value as T;
    const value = compute();
    memos.set(key, { deps, value });
    return value;
  }

  /** Request a render pass for this object. */
  markDirty(): void {
    if (this.#dirty) return;
    this.#dirty = true;
    this.world?.scheduleRender(this);
  }

  /**
   * Called by the World for dirty objects: clears the flag, applies the state
   * updates queued since the last render, then renders. This is the only
   * place state changes, so every handler in a frame sees the same snapshot.
   */
  runRender(): void {
    this.#dirty = false;
    // A render may write this object's draw state and that of the elements it owns. Unless it says which itself, all of them changed.
    if (!this.reportsChanges) this.markChanged();
    this.commitState();
    this.render();
  }

  /**
   * What the World calls for each object in its list of renders asked for: `runRender` if this object is still in that
   * world and still wants one. Returns whether it ran. `pass` is the World's number for this pass over its list, so an
   * object that is in the list twice (it asks again when it joins a world while dirty) is looked at once per pass.
   */
  renderInPass(world: World, pass: number): boolean {
    if (this.#renderPass === pass) return false;
    this.#renderPass = pass;
    if (this.world !== world || !this.#dirty) return false;
    this.runRender();
    return true;
  }

  /** Apply queued state updates. Generated code overrides this for components with state setters. */
  commitState(): void {}

  /** Per-tick hooks. Generated code overrides the ones a component declares; the World only visits overriders. */
  onInput(_input: InputState): void {}

  onUpdate(_dt: number, _input?: InputState): void {}

  /**
   * Runs once when this object joins a World, after its whole subtree has
   * (children first, so a parent's `onMount` sees them mounted). Its first
   * render has already committed: the constructor runs it. Setting state here
   * schedules a render in the same `flush`.
   */
  onMount(): void {}

  /**
   * Runs once when this object leaves its World, while it is still attached;
   * a parent runs before its children. Anything it schedules on itself is
   * dropped (the object is going away), so it is for telling other objects.
   */
  onUnmount(): void {}

  /** Recompute dynamic props and conditional children. Generated code overrides this. */
  render(): void {}

  /**
   * For hot reload: this object's own state (`useState` values, refs) by stable id, or null when it has none. Generated code
   * overrides it for a component with state or refs. See `captureHotState`.
   */
  saveHotState(): Record<string, unknown> | null {
    return null;
  }

  /**
   * For hot reload: take back what `saveHotState` returned from the object this one replaces (an older build of the same
   * component). An id it no longer has, or a value of another type, is ignored. It sets state as a setter would, so it shows
   * on the next render.
   */
  loadHotState(_saved: Record<string, unknown>): void {}

  /**
   * Whether a saved value can stand in for `current` after a hot reload: the same kind of value (a number for a number, an
   * array for an array, an object or null for an object). A game object or a function is never kept: it belongs to the
   * build being replaced, and the new tree made its own.
   */
  protected hotFits(value: unknown, current: unknown): boolean {
    if (value === undefined && current !== undefined) return false;
    if (typeof value !== typeof current || typeof value === "function") return false;
    if (value instanceof GameObject) return false;
    if (typeof value === "object" && value !== null && current !== null && Array.isArray(value) !== Array.isArray(current)) return false;
    return true;
  }

  attachToWorld(world: World): void {
    this.world = world;
    world.registerObject(this);
    if (this.gameStateStore && this.gameStateKeys.length > 0) {
      this.gameStateStore.subscribe(this, this.gameStateKeys);
      // It may have been built before a change it missed (it was not subscribed): refresh it once.
      this.markDirty();
    }
    if (this.#dirty) world.scheduleRender(this);
    if (this.#pending.length > 0) world.scheduleCommit(this);
    for (const child of this.children) child.attachToWorld(world);
    if (!this.#mounted) {
      this.#mounted = true;
      this.onMount();
    }
  }

  detachFromWorld(): void {
    this.gameStateStore?.unsubscribe(this, this.gameStateKeys);
    if (this.#mounted) {
      this.#mounted = false;
      this.onUnmount();
    }
    this.world?.unregisterObject(this);
    this.world = null;
    for (const child of this.children) child.detachFromWorld();
  }
}

const NO_KEYS: readonly string[] = [];

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (value) for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}
