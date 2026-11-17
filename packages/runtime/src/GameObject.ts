import type { MessageOf, Nearby, SendTarget } from "./components/Collider.ts";
import { developmentWarning } from "./develop.ts";
import type { GameStore } from "./GameState.ts";
import type { InputState } from "./input.ts";
import { IDENTITY_TRANSFORM, Transform, composeTransforms, offsetTransform, type WorldTransform } from "./Transform.ts";
import type { World } from "./World.ts";

type StructureOp =
  | { readonly kind: "add"; readonly child: GameObject; readonly slot: number; readonly order: ChildOrder }
  | { readonly kind: "remove"; readonly child: GameObject }
  | { readonly kind: "reorder"; readonly slot: number; readonly children: readonly GameObject[]; readonly prefix: readonly number[] };

/** What decides whether a subtree hears input, on the containers (`<Entity>`, `<Flex>`, `<Hud>`): see `GameObject.inert` and `modal`. */
/**
 * Where a child sits within its slot: a number (an item's index in a keyed list), or, among a component's passed children, a path of
 * numbers compared in turn (`[1, 4]` is the fifth item of the list passed second, after `[1, 3]` and before `[2]`).
 */
export type ChildOrder = number | readonly number[];

/** Negative, zero or positive as `a` sorts before, with or after `b`: numbers as they are, paths in turn, a number as a path of one. */
function compareOrder(a: ChildOrder, b: ChildOrder): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = typeof a === "number" ? [a] : a;
  const y = typeof b === "number" ? [b] : b;
  for (let i = 0; i < x.length && i < y.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

function prependOrder(first: number, order: ChildOrder): readonly number[] {
  return typeof order === "number" ? [first, order] : [first, ...order];
}

export interface InputScopeProps {
  /** The subtree hears no input, as the HTML attribute `inert`. */
  inert?: boolean;
  /** While mounted, everything outside this subtree hears no input, as a `<dialog>` opened with `showModal()`. */
  modal?: boolean;
}

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
export class GameObject<P extends object = {}> {
  /** Marks runtime-provided classes; compiled components do not have this as an own static. */
  static readonly intrinsic = true;

  /**
   * Position, rotation and scale relative to the parent (unless `global`).
   * Every game object has one, so any built-in element can be placed; set
   * with its `x`, `y`, … props.
   */
  readonly transform: Transform = new Transform();
  /**
   * Where a scene placed this object, composed under `transform`: the
   * object's own (state-driven) `transform` moves it relative to its
   * placement. Identity unless a scene set it.
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
  /**
   * A list item's key (`key={e.id}`), set by the list that made it: hot reload and saves name a keyed object by it
   * (`Enemy[beetle-3]`), so state stays with its item when an earlier one is removed. Undefined for anything else.
   */
  hotKey: string | number | undefined = undefined;
  /** The component's props: a private copy, updated in place by `updateProps`. */
  props: P;
  /**
   * How to read a prop as the component that made this one has it now, set by that component (`withPropGetters`): a handler reads
   * `health` through it, so it sees what a handler that ran before it wrote to the parent's state, where `props` holds what the
   * parent's last render copied. `$all` works out every value prop at once (a spread among them). Null where the props are all
   * constants, or the parent could not say.
   */
  propGetters: Readonly<Record<string, () => unknown>> | null = null;

  /** A prop as a handler reads it: the parent's current value, or the last render's where the parent gave no getter. */
  liveProp<K extends keyof P>(name: K): P[K] {
    const getters = this.propGetters;
    if (getters !== null) {
      const own = getters[name as string];
      if (own !== undefined) {
        const value = own() as P[K];
        if (value !== undefined) return value;
      } else if (getters["$all"] !== undefined) {
        // Nothing, where the item or the condition it was made under is gone: the last props stand.
        const all = getters["$all"]() as P | undefined;
        if (all !== undefined && all[name] !== undefined) return all[name];
      }
    }
    return this.props[name];
  }

  /** `child` with its prop getters set; what generated code writes where it makes a child whose props read state. */
  withPropGetters<T extends GameObject<any>>(child: T, getters: Readonly<Record<string, () => unknown>>): T {
    child.propGetters = getters;
    return child;
  }
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
   * The player's interpolation (`<Game interpolate>`): this object's transform after the step before last and after the last step
   * (x, y, rotation, scaleX, scaleY each), and the step it was last seen at. Null until a step sees it with interpolation on.
   */
  interpolation: Float64Array | null = null;
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
    // `definedOnly` makes a new object: with no defaults to put under it, it is the props.
    this.props = (defaults === undefined ? definedOnly(props) : { ...defaults, ...definedOnly(props) }) as P;
  }

  /**
   * Apply changed props from the parent. A key whose value is `undefined`
   * falls back to its default; a key not mentioned is left alone. Compares
   * with `===` and returns whether anything changed, so the caller can mark
   * the component dirty exactly once.
   */
  protected applyProps(next: Partial<P>, defaults: Partial<P> = {}): boolean {
    let changed = false;
    // `for…in`, not `Object.keys`: a parent re-rendering a thousand list items calls this for each, every step, and an array of keys
    // for each call was garbage. `next` is an object literal the generated code made, with no inherited enumerable keys.
    for (const name in next) {
      const key = name as keyof P;
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
  /** Structural changes queued for the next commit; null while there are none (most objects never queue one, so none is made). */
  #pending: StructureOp[] | null = null;
  /** Source position among the parent's children (see `addChild`); `Infinity` for unslotted children. */
  #slot = Infinity;
  /** Position within the slot: the item's index in a keyed list (see `queueReorder`), or a path of positions for passed children; 0 otherwise. */
  #order: ChildOrder = 0;
  /** `onMount` has run and `onUnmount` has not: each runs once per stay in a World. */
  #mounted = false;
  /** It was mounted and has since left its World (and not come back): what a `useMutable`'s object checks before a write. */
  #unmounted = false;
  #inert = false;
  #modal = false;
  /** What `useMount` handlers returned this stay in a World (`keepCleanup`), run after `onUnmount` when it leaves. */
  #cleanups: (() => void)[] | null = null;

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

  /**
   * Where this component's `{children}` sit among the children it passes on to `passedChildrenForward`
   * (`<Card><Title />{children}<Footer /></Card>` sets 1): what it was given goes between its own.
   */
  protected passedChildrenForwardAt = 0;

  /**
   * Immediately attach a passed child, at `order` among the passed children (the slot of `{children}` is fixed). An order is the
   * child's position as its parent wrote it, or a path (`[2, 5]`: the sixth item of the list written third); a component that forwards
   * its children puts its own position of `{children}` in front, so they sort between the children it passes itself.
   */
  attachPassedChild(child: GameObject, order: ChildOrder): void {
    if (this.passedChildrenForward !== null)
      return this.passedChildrenForward.attachPassedChild(child, prependOrder(this.passedChildrenForwardAt, order));
    this.#passedHost().addChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be attached when structure is next committed. */
  queueAttachPassedChild(child: GameObject, order: ChildOrder): void {
    if (this.passedChildrenForward !== null)
      return this.passedChildrenForward.queueAttachPassedChild(child, prependOrder(this.passedChildrenForwardAt, order));
    this.#passedHost().queueAddChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be detached when structure is next committed. */
  queueDetachPassedChild(child: GameObject): void {
    if (this.passedChildrenForward !== null) return this.passedChildrenForward.queueDetachPassedChild(child);
    this.#passedHost().queueRemoveChild(child);
  }

  /** Queue a new order for the items of a keyed list among the passed children, see `queueReorder`; `prefix` is the list's own position. */
  queueReorderPassedChildren(children: readonly GameObject[], prefix: readonly number[] = []): void {
    if (this.passedChildrenForward !== null)
      return this.passedChildrenForward.queueReorderPassedChildren(children, [this.passedChildrenForwardAt, ...prefix]);
    this.#passedHost().queueReorder(this.passedChildrenSlot, children, prefix);
  }

  #passedHost(): GameObject {
    if (this.passedChildrenHost === null) {
      throw new Error(
        `${this.constructor.name} was given children but does not render {children}: declare \`children: Child\` in its props and write {children} where they belong.`
      );
    }
    return this.passedChildrenHost;
  }

  get isDirty(): boolean {
    return this.#dirty;
  }

  get hasPendingStructure(): boolean {
    return this.#pending !== null && this.#pending.length > 0;
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
  addChild(child: GameObject, slot: number = Infinity, order: ChildOrder = 0): void {
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
    if (last === undefined || last.#slot < slot || (last.#slot === slot && compareOrder(last.#order, order) <= 0)) {
      this.children.push(child);
    } else {
      const index = this.children.findIndex(
        (sibling) => sibling.#slot > slot || (sibling.#slot === slot && compareOrder(sibling.#order, order) > 0)
      );
      this.children.splice(index, 0, child);
    }
    this.markChanged();
    if (this.world !== null) {
      this.world.orderChanged();
      child.attachToWorld(this.world);
    }
  }

  /** Immediately detach a child. */
  removeChild(child: GameObject): void {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("GameObject is not a child of this object");
    this.markChanged();
    this.children.splice(index, 1);
    this.world?.orderChanged();
    child.parent = null;
    child.drawCache = null;
    child.#slot = Infinity;
    child.#order = 0;
    child.detachFromWorld();
  }

  /** `removeChild` for each of `ops[from..to)` (all removals), in that order, with one pass over the children. */
  #removeChildren(ops: readonly StructureOp[], from: number, to: number): void {
    const leaving = new Set<GameObject>();
    for (let k = from; k < to; k++) {
      const child = (ops[k] as { readonly child: GameObject }).child;
      if (child.parent !== this || leaving.has(child)) throw new Error("GameObject is not a child of this object");
      leaving.add(child);
    }
    this.markChanged();
    const children = this.children;
    let kept = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as GameObject;
      if (!leaving.has(child)) children[kept++] = child;
    }
    children.length = kept;
    this.world?.orderChanged();
    for (let k = from; k < to; k++) {
      const child = (ops[k] as { readonly child: GameObject }).child;
      child.parent = null;
      child.drawCache = null;
      child.#slot = Infinity;
      child.#order = 0;
      child.detachFromWorld();
    }
  }

  /** Queue a child to be attached (at `slot` and `order`, see `addChild`) when structure is next committed. */
  queueAddChild(child: GameObject, slot: number = Infinity, order: ChildOrder = 0): void {
    (this.#pending ??= []).push({ kind: "add", child, slot, order });
    this.world?.scheduleCommit(this);
  }

  /**
   * Queue a new order for the items of a keyed list (the children in `slot`):
   * when structure is next committed, each child's order becomes its index in
   * `children`, and the slot is re-sorted. Children in other slots keep their
   * positions. Queue it after the list's adds and removals. With a `prefix` (a list among passed children), each order is the
   * prefix and then the index.
   */
  queueReorder(slot: number, children: readonly GameObject[], prefix: readonly number[] = []): void {
    (this.#pending ??= []).push({ kind: "reorder", slot, children, prefix });
    this.world?.scheduleCommit(this);
  }

  /** Queue a child to be detached when structure is next committed. */
  queueRemoveChild(child: GameObject): void {
    (this.#pending ??= []).push({ kind: "remove", child });
    this.world?.scheduleCommit(this);
  }

  /** Apply queued structural changes in the order they were queued, then those of children just attached. */
  commitStructure(): void {
    const ops = this.#pending;
    if (ops === null) return;
    this.#pending = null;
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k] as StructureOp;
      if (op.kind === "remove" && k + 1 < ops.length && (ops[k + 1] as StructureOp).kind === "remove") {
        // A run of removals (a list dropping many items, shots leaving the screen): the children array is compacted once, instead of
        // searched and spliced for each.
        let end = k;
        while (end < ops.length && (ops[end] as StructureOp).kind === "remove") end++;
        this.#removeChildren(ops, k, end);
        k = end - 1;
        continue;
      }
      if (op.kind === "add") {
        this.addChild(op.child, op.slot, op.order);
        // A child that queued its own changes while it had no parent (nested conditionals)
        // is now attached; settle it too, so a subtree is complete without a World.
        if (op.child.hasPendingStructure) op.child.commitStructure();
      } else if (op.kind === "remove") {
        this.removeChild(op.child);
      } else {
        this.#reorder(op.slot, op.children, op.prefix);
      }
    }
  }

  #reorder(slot: number, children: readonly GameObject[], prefix: readonly number[]): void {
    children.forEach((child, index) => {
      if (child.parent === this && child.#slot === slot) child.#order = prefix.length === 0 ? index : [...prefix, index];
    });
    this.markChanged();
    // Children are kept sorted by (slot, order), so this slot's children are one run of `children`. When `children` is exactly
    // that run in its new order (a keyed list's items, which is what reorders), it is written over the run: no sort. A list of a
    // thousand enemies reordered every step something died was sorted every step.
    if (prefix.length !== 0 || !this.#writeSlot(slot, children))
      this.children.sort((a, b) => (a.#slot === b.#slot ? compareOrder(a.#order, b.#order) : a.#slot < b.#slot ? -1 : 1));
    this.world?.orderChanged();
  }

  /** Write `order` over the run of this object's children in `slot`, if it holds exactly those children; returns whether it did. */
  #writeSlot(slot: number, order: readonly GameObject[]): boolean {
    const children = this.children;
    let start = 0;
    while (start < children.length && children[start]!.#slot !== slot) start++;
    let end = start;
    while (end < children.length && children[end]!.#slot === slot) end++;
    let count = 0;
    for (let i = 0; i < order.length; i++) {
      const child = order[i]!;
      if (child.parent === this && child.#slot === slot) count++;
    }
    if (count !== end - start) return false;
    let at = start;
    for (let i = 0; i < order.length; i++) {
      const child = order[i]!;
      if (child.parent === this && child.#slot === slot) children[at++] = child;
    }
    return true;
  }

  /**
   * This object's transform in world space: the parent's, then this object's
   * layout offset (`layoutX`, `layoutY`), then its `placement`, then its own
   * `transform` (see `Transform`). A `global` placement ignores the parent and
   * the layout offset; a `global` transform ignores all three.
   */
  worldTransform(): WorldTransform {
    return this.worldTransformIn(this.parent === null ? IDENTITY_TRANSFORM : this.parent.childSpace());
  }

  /**
   * `worldTransform()` for a caller that already holds the parent's `childSpace()` (the identity with no parent): asking each of
   * many siblings in turn then walks up the tree once, not once for each of them.
   */
  worldTransformIn(parentSpace: WorldTransform): WorldTransform {
    return composeTransforms(composeTransforms(offsetTransform(parentSpace, this.layoutX, this.layoutY), this.placement), this.transform);
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

  #memos: Map<string, { readonly deps: readonly unknown[]; readonly value: unknown }> | undefined;

  /**
   * For generated code: a component's derived value (`const hero = heroOf(run)`), worked out again only when one of `deps` (the state
   * and props it reads) is a different value than last time (`===`), as React's `useMemo`. So a render, and each handler that reads
   * it, sees the same value for as long as what it is made from stays the same.
   */
  $memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
    this.#memos ??= new Map();
    const last = this.#memos.get(key);
    if (last !== undefined && last.deps.length === deps.length && last.deps.every((d, i) => d === deps[i])) return last.value as T;
    const value = compute();
    this.#memos.set(key, { deps, value });
    return value;
  }

  /**
   * For generated code: whether a write through one of this component's `useMutable` objects (`takeHit(s)`, called later) may still
   * change it. False once it has been mounted and has left its World, until it is mounted again. A write that may not does nothing,
   * and says so once in development (see `develop.ts`): the component is gone, so nothing would ever show it.
   */
  $mayWrite(field: string): boolean {
    if (!this.#unmounted) return true;
    const name = this.constructor.name;
    developmentWarning(
      `unmounted-write:${name}:${field}`,
      `A write to ${name}'s '${field}' after it was unmounted was ignored: something kept its useMutable object (passed whole, as \`takeHit(s)\`) and wrote to it later. Write only while the component is mounted, or keep the value somewhere that outlives it (the game state).`
    );
    return false;
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
  /** How many times this object has rendered: what the development inspector shows. */
  renderCount = 0;

  /**
   * Which per-step hooks the world it is in runs for it: `HANDLES_INPUT`, `HANDLES_UPDATE`, set by `World.registerObject` and cleared
   * when it leaves. What `World`'s handler sets hold, kept on the object so making the order handlers run in again (every step that
   * something mounts or unmounts) is a walk with no lookups, and leaves with no hooks are not walked at all.
   */
  worldHandlers = 0;

  runRender(): void {
    this.renderCount++;
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

  /**
   * A `useMount` handler's result: a function is kept and called once when this object leaves its World, after its
   * `onUnmount`, in the order they were kept (`useMount(() => settings.subscribe(…))` stops listening). Anything else is
   * ignored. Generated code calls it from `onMount`.
   */
  protected keepCleanup(cleanup: unknown): void {
    if (typeof cleanup === "function") (this.#cleanups ??= []).push(cleanup as () => void);
  }

  /** Recompute dynamic props and conditional children. Generated code overrides this. */
  render(): void {}

  /**
   * For hot reload: this object's own state (`useMutable` fields, refs) by stable id, or null when it has none. Generated code
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
    // A state that holds an instance of a class (a `useBody` body) is kept, never replaced: the saved one's fields (from the
    // component this one replaces, or a plain copy of them in a rewind snapshot) are put into the instance this object already has,
    // which keeps its own links (its owner, its world). The saved instance belonged to a component that has left, and is detached.
    if (
      typeof value === "object" &&
      value !== null &&
      typeof current === "object" &&
      current !== null &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      !Array.isArray(current)
    ) {
      const proto = Object.getPrototypeOf(value);
      if (value !== current && (proto === Object.getPrototypeOf(current) || proto === Object.prototype)) Object.assign(current, value);
      return false;
    }
    return true;
  }

  /**
   * `inert`, as the HTML attribute: this subtree still updates, draws and collides, but hears no input. Its `useInput` and
   * `useUpdate` get no keys, and none of its pointers or buttons can be pressed, hovered, focused or reached by a `pressKey`.
   * `<Menu inert={capturing} />` stops a menu while something else takes the keys.
   */
  get inert(): boolean {
    return this.#inert;
  }

  set inert(value: boolean) {
    this.#inert = value === true;
    this.world?.setInert(this, this.#inert);
  }

  /**
   * `modal`, as a `<dialog>` opened with `showModal()`: while this object is in a world, everything outside its subtree is
   * inert. The pause screen or a "press a key" prompt takes the keys, and the focus stays inside it. When several are mounted,
   * the one mounted last takes the keys (an inner modal over an outer one).
   */
  get modal(): boolean {
    return this.#modal;
  }

  set modal(value: boolean) {
    this.#modal = value === true;
    this.world?.setModal(this, this.#modal);
  }

  /**
   * The per-instance objects this component keeps in state (`useMutable({ body: createBody(…) })`) that want to know their owner and
   * world: each is told when the component joins a world and leaves it (`attachOwner` / `detachOwner`). Generated code lists them.
   */
  protected ownedHandles(): readonly unknown[] {
    return NO_HANDLES;
  }

  /**
   * This object's timers (`after`, `every`): its id, seconds left, the period for a repeating one (0: once), what to call, and
   * whether `cancelTimer` took it out (so a step already running them skips it).
   */
  /** `NO_TIMERS` (shared, never written) until the first timer is set, so an object with none makes no array. */
  #timers: Timer[] = NO_TIMERS;
  /** The id the next timer gets: 1, 2, 3… for this object, never reused, so 0 can mean "no timer" in a component's state. */
  #nextTimerId = 1;

  /**
   * Call `fn` once, `seconds` of game time from now: `after(0.15, () => setFlash(false))` in a handler. Timers count the fixed
   * step's time in the update phase (so they stop during `freeze` and `<Game paused>`, and replay), and are cancelled when this
   * object leaves the world, so one never sets state on a component that is gone.
   */
  after(seconds: number, fn: () => void): number {
    return this.#addTimer(seconds, 0, fn);
  }

  /** Call `fn` every `seconds` of game time, the first time `seconds` from now, until `cancelTimers` or the object leaves the world. */
  every(seconds: number, fn: () => void): number {
    return this.#addTimer(seconds, seconds > 0 ? seconds : 0, fn);
  }

  /**
   * Cancel the timer `after` or `every` returned `id` for, and no other: a hit flash restarted without stopping the object's other
   * timers. An id that is done, cancelled already, or 0 is ignored.
   */
  cancelTimer(id: number): void {
    const timers = this.#timers;
    for (let i = 0; i < timers.length; i++) {
      const timer = timers[i] as Timer;
      if (timer.id !== id) continue;
      timer.cancelled = true;
      timers.splice(i, 1);
      return;
    }
  }

  /**
   * The colliders with `tag` whose boxes come within `radius` of (`x`, `y`) in world space, nearest first, not counting the
   * colliders this component draws itself (those of components inside it count): `nearby("enemy", x, y, 60)` in a component (see `World.nearby`). None while it is not in a world.
   */
  nearby<Tag extends string>(tag: Tag, x: number, y: number, radius: number): Nearby<Tag>[] {
    return this.world?.nearby(tag, x, y, radius, this) ?? [];
  }

  /**
   * Send `value` to the `onReceive` of the colliders with `tag` that `where` names (a circle, or one `nearby` result), at the end of
   * this step's update phase: `send("enemy", { x, y, radius: 20 }, blast)` in a component (see `World.send`).
   */
  send<Tag extends string>(tag: Tag, where: SendTarget<Tag>, value: MessageOf<Tag>): void {
    this.world?.send(tag, where, value);
  }

  /** Cancel every timer of this object. */
  cancelTimers(): void {
    for (const timer of this.#timers) timer.cancelled = true;
    this.#timers = NO_TIMERS;
  }

  /** The id this object's next timer will get. Kept by hot reload and tree saves (see `resumeTimerIds`). */
  get nextTimerId(): number {
    return this.#nextTimerId;
  }

  /**
   * Go on numbering timers from `next`: this object replaces one (a hot reload, a save loaded with its tree) whose state may hold the
   * ids of that one's timers, so a new timer must not take one of them and be cancelled by mistake.
   */
  resumeTimerIds(next: number): void {
    if (Number.isInteger(next) && next > this.#nextTimerId) this.#nextTimerId = next;
  }

  /** How many timers of this object are waiting. */
  get pendingTimers(): number {
    return this.#timers.length;
  }

  #addTimer(seconds: number, period: number, fn: () => void): number {
    if (this.#timers === NO_TIMERS) this.#timers = [];
    const id = this.#nextTimerId++;
    this.#timers.push({ id, left: seconds > 0 ? seconds : 0, period, fn, cancelled: false });
    this.world?.addTimed(this);
    return id;
  }

  /**
   * Run the timers that are due after `dt` more seconds, in the order they were set (the world calls this in each update).
   * Returns whether any are left.
   */
  stepTimers(dt: number): boolean {
    const timers = this.#timers;
    if (timers.length === 0) return false;
    // A snapshot: a timer set by a callback starts counting from the next step.
    const due = [...timers];
    for (const timer of due) {
      if (this.#timers !== timers || this.world === null) break; // cancelled by a callback, or gone
      if (timer.cancelled) continue; // cancelled on its own by an earlier callback this step
      timer.left -= dt;
      // A repeating timer due more than once in one step (a period shorter than the step) runs once a step: no bursts.
      if (timer.left > 1e-9) continue;
      if (timer.period > 0) timer.left += Math.max(timer.period, dt);
      else timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
    return this.#timers.length > 0;
  }

  attachToWorld(world: World): void {
    this.world = world;
    world.registerObject(this);
    if (this.#timers.length > 0) world.addTimed(this);
    for (const handle of this.ownedHandles()) (handle as OwnedHandle | null)?.attachOwner?.(this, world);
    // Before the children attach, so an outer modal is below an inner one.
    if (this.#inert) world.setInert(this, true);
    if (this.#modal) world.setModal(this, true);
    if (this.gameStateStore && this.gameStateKeys.length > 0) {
      this.gameStateStore.subscribe(this, this.gameStateKeys);
      // It may have been built before a change it missed (it was not subscribed): refresh it once.
      this.markDirty();
    }
    if (this.#dirty) world.scheduleRender(this);
    if (this.#pending !== null && this.#pending.length > 0) world.scheduleCommit(this);
    for (const child of this.children) child.attachToWorld(world);
    if (!this.#mounted) {
      this.#mounted = true;
      this.#unmounted = false;
      this.onMount();
    }
  }

  detachFromWorld(): void {
    if (this.#modal) this.world?.setModal(this, false);
    if (this.#inert) this.world?.setInert(this, false);
    this.gameStateStore?.unsubscribe(this, this.gameStateKeys);
    if (this.#mounted) {
      this.#mounted = false;
      this.#unmounted = true;
      this.onUnmount();
      const cleanups = this.#cleanups;
      this.#cleanups = null;
      if (cleanups !== null) for (const cleanup of cleanups) cleanup();
    }
    for (const handle of this.ownedHandles()) (handle as OwnedHandle | null)?.detachOwner?.();
    // Its timers go with it: a timer never calls back into a component that has left.
    this.#timers = NO_TIMERS;
    this.world?.unregisterObject(this);
    this.world = null;
    for (const child of this.children) child.detachFromWorld();
  }
}

const NO_KEYS: readonly string[] = [];
const NO_HANDLES: readonly unknown[] = [];

/** A per-instance object that wants to know the component that owns it (see `GameObject.ownedHandles`). */
interface OwnedHandle {
  attachOwner?(owner: GameObject, world: World): void;
  detachOwner?(): void;
}

/** A timer of `GameObject.after` / `every`. */
interface Timer {
  readonly id: number;
  left: number;
  readonly period: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/** What `#timers` holds while there are none. Never written: the first timer replaces it with an array of its own. */
const NO_TIMERS: Timer[] = [];

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (value) for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}
