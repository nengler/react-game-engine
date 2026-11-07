import type { InputState } from "./input.ts";
import type { World } from "./World.ts";

type StructureOp =
  | { readonly kind: "add"; readonly child: GameObject }
  | { readonly kind: "remove"; readonly child: GameObject };

/**
 * Base class for every persistent game object. Compiled components extend
 * this (via Entity). It owns the object tree, the dirty flag, and queued
 * structural changes; it knows nothing about rendering backends.
 */
export class GameObject {
  /** Marks runtime-provided classes; compiled components do not have this as an own static. */
  static readonly intrinsic = true;

  parent: GameObject | null = null;
  readonly children: GameObject[] = [];
  world: World | null = null;

  #dirty = false;
  #pending: StructureOp[] = [];

  get isDirty(): boolean {
    return this.#dirty;
  }

  get hasPendingStructure(): boolean {
    return this.#pending.length > 0;
  }

  /** Immediately attach a child. Used for children that exist for the object's whole life. */
  addChild(child: GameObject): void {
    if (child.parent !== null) {
      throw new Error("GameObject already has a parent");
    }
    child.parent = this;
    this.children.push(child);
    if (this.world !== null) child.attachToWorld(this.world);
  }

  /** Immediately detach a child. */
  removeChild(child: GameObject): void {
    const index = this.children.indexOf(child);
    if (index === -1) throw new Error("GameObject is not a child of this object");
    this.children.splice(index, 1);
    child.parent = null;
    child.detachFromWorld();
  }

  /** Queue a child to be attached when structure is next committed. */
  queueAddChild(child: GameObject): void {
    this.#pending.push({ kind: "add", child });
    this.world?.scheduleCommit(this);
  }

  /** Queue a child to be detached when structure is next committed. */
  queueRemoveChild(child: GameObject): void {
    this.#pending.push({ kind: "remove", child });
    this.world?.scheduleCommit(this);
  }

  /** Apply queued structural changes in the order they were queued. */
  commitStructure(): void {
    const ops = this.#pending;
    this.#pending = [];
    for (const op of ops) {
      if (op.kind === "add") this.addChild(op.child);
      else this.removeChild(op.child);
    }
  }

  /** Request a render pass for this object. */
  markDirty(): void {
    if (this.#dirty) return;
    this.#dirty = true;
    this.world?.scheduleRender(this);
  }

  /** Called by the World for dirty objects. Clears the flag, then renders. */
  runRender(): void {
    this.#dirty = false;
    this.render();
  }

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
