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
  readonly children: GameObject[] = [];
  world: World | null = null;

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

  /** Whether this component renders `{children}`: a scene (or a parent) may pass it children. */
  get acceptsPassedChildren(): boolean {
    return this.passedChildrenHost !== null;
  }

  /** Immediately attach a passed child, at `order` among the passed children (the slot of `{children}` is fixed). */
  attachPassedChild(child: GameObject, order: number): void {
    this.#passedHost().addChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be attached when structure is next committed. */
  queueAttachPassedChild(child: GameObject, order: number): void {
    this.#passedHost().queueAddChild(child, this.passedChildrenSlot, order);
  }

  /** Queue a passed child to be detached when structure is next committed. */
  queueDetachPassedChild(child: GameObject): void {
    this.#passedHost().queueRemoveChild(child);
  }

  /** Queue a new order for the passed children (a keyed list passed as the whole of the children), see `queueReorder`. */
  queueReorderPassedChildren(children: readonly GameObject[]): void {
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
    if (this.world !== null) child.attachToWorld(this.world);
  }

  /** Immediately detach a child. */
  removeChild(child: GameObject): void {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("GameObject is not a child of this object");
    this.children.splice(index, 1);
    child.parent = null;
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
    this.commitState();
    this.render();
  }

  /** Apply queued state updates. Generated code overrides this for components with state setters. */
  commitState(): void {}

  /** Per-tick hooks. Generated code overrides the ones a component declares; the World only visits overriders. */
  onInput(_input: InputState): void {}

  onUpdate(_dt: number): void {}

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

  attachToWorld(world: World): void {
    this.world = world;
    world.registerObject(this);
    if (this.#dirty) world.scheduleRender(this);
    if (this.#pending.length > 0) world.scheduleCommit(this);
    for (const child of this.children) child.attachToWorld(world);
    if (!this.#mounted) {
      this.#mounted = true;
      this.onMount();
    }
  }

  detachFromWorld(): void {
    if (this.#mounted) {
      this.#mounted = false;
      this.onUnmount();
    }
    this.world?.unregisterObject(this);
    this.world = null;
    for (const child of this.children) child.detachFromWorld();
  }
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (value) for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}
