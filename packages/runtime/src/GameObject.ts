import type { InputState } from "./input.ts";
import { IDENTITY_TRANSFORM, Transform, composeTransforms, type WorldTransform } from "./Transform.ts";
import type { World } from "./World.ts";

type StructureOp =
  | { readonly kind: "add"; readonly child: GameObject; readonly slot: number }
  | { readonly kind: "remove"; readonly child: GameObject };

/**
 * Base class for every persistent game object. Compiled components extend
 * this (via Entity). It owns the object tree, the dirty flag, and queued
 * structural changes; it knows nothing about rendering backends.
 */
export class GameObject {
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
  parent: GameObject | null = null;
  readonly children: GameObject[] = [];
  world: World | null = null;

  #dirty = false;
  #pending: StructureOp[] = [];
  /** Source position among the parent's children (see `addChild`); `Infinity` for unslotted children. */
  #slot = Infinity;

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
   * child is appended (and stays after every slotted child).
   */
  addChild(child: GameObject, slot: number = Infinity): void {
    if (child.parent !== null) {
      throw new Error("GameObject already has a parent");
    }
    child.parent = this;
    child.#slot = slot;
    const index = this.children.findIndex((sibling) => sibling.#slot > slot);
    if (index === -1) this.children.push(child);
    else this.children.splice(index, 0, child);
    if (this.world !== null) child.attachToWorld(this.world);
  }

  /** Immediately detach a child. */
  removeChild(child: GameObject): void {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("GameObject is not a child of this object");
    this.children.splice(index, 1);
    child.parent = null;
    child.#slot = Infinity;
    child.detachFromWorld();
  }

  /** Queue a child to be attached (at `slot`, see `addChild`) when structure is next committed. */
  queueAddChild(child: GameObject, slot: number = Infinity): void {
    this.#pending.push({ kind: "add", child, slot });
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
        this.addChild(op.child, op.slot);
        // A child that queued its own changes while it had no parent (nested conditionals)
        // is now attached; settle it too, so a subtree is complete without a World.
        if (op.child.hasPendingStructure) op.child.commitStructure();
      } else {
        this.removeChild(op.child);
      }
    }
  }

  /**
   * This object's transform in world space: the parent's, then this object's
   * `placement`, then its own `transform` (see `Transform`). A `global`
   * placement ignores the parent; a `global` transform ignores both.
   */
  worldTransform(): WorldTransform {
    const parent = this.parent === null ? IDENTITY_TRANSFORM : this.parent.worldTransform();
    return composeTransforms(composeTransforms(parent, this.placement), this.transform);
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

  /** Called when the World reports a new collision involving this component. */
  onCollisionEnter(_other: GameObject): void {}

  /** Recompute dynamic props and conditional children. Generated code overrides this. */
  render(): void {}

  attachToWorld(world: World): void {
    this.world = world;
    world.registerObject(this);
    if (this.#dirty) world.scheduleRender(this);
    if (this.#pending.length > 0) world.scheduleCommit(this);
    for (const child of this.children) child.attachToWorld(world);
  }

  detachFromWorld(): void {
    this.world?.unregisterObject(this);
    this.world = null;
    for (const child of this.children) child.detachFromWorld();
  }
}
