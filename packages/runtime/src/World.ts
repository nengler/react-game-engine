import { GameObject } from "./GameObject.ts";
import { Collider } from "./components/Collider.ts";
import type { Pressable } from "./components/Pointer.ts";
import { NO_INPUT, type InputState } from "./input.ts";

/** Numbers each pass of any World's `flush` over its list of renders (see `GameObject.renderInPass`): one counter for all worlds, so an object that moves between them is never mistaken for one already seen. */
let passes = 0;

/**
 * Owns the root of the object tree and drives dirty-driven updates:
 * render every dirty object, then apply queued structural changes.
 */
export class World {
  readonly root: GameObject = new GameObject();
  /**
   * A counter the player's frame builder advances once per frame it builds. A change to an object is stamped with
   * the value current when it happens (`GameObject.markChanged`), so the builder can tell what changed since it
   * last drew an object: a stamp at or after the serial of that frame is newer than the frame.
   */
  serial = 0;
  /**
   * The objects that asked for a render, in the order they asked. A list, not a `Set`: adding to one and copying it out each
   * frame was a fifth of the tick for 2,000 objects that re-render every frame. An object can be in it twice (it asks when it
   * turns dirty, and again if it joins this world while dirty), which `flush` sees to: each object is looked at once per pass.
   */
  #dirty: GameObject[] = [];
  #structure = new Set<GameObject>();
  #onInput = new Set<GameObject>();
  #onUpdate = new Set<GameObject>();

  constructor() {
    this.root.attachToWorld(this);
  }

  mount(object: GameObject): void {
    this.root.addChild(object);
  }

  scheduleRender(object: GameObject): void {
    this.#dirty.push(object);
  }

  scheduleCommit(object: GameObject): void {
    this.#structure.add(object);
  }

  /**
   * Run one frame, in a fixed order: `onInput` → `onUpdate` → render dirty
   * objects → commit structure. Only objects that override a hook are visited
   * (registered on attach), and the visit lists are snapshotted at the start,
   * so objects attached during a frame start receiving hooks next frame and
   * objects detached mid-frame are skipped. Returns the number of renders run.
   */
  tick(dt: number, input: InputState = NO_INPUT): number {
    const inputs = [...this.#onInput];
    const updates = [...this.#onUpdate];
    for (const object of inputs) if (object.world === this) object.onInput(input);
    for (const object of updates) if (object.world === this) object.onUpdate(dt);
    return this.flush();
  }

  /**
   * Report that two colliders began touching (the mock has no physics; a
   * collision system calls this). Each collider's own `onCollisionEnter`
   * callback is called with the other collider. Dispatch only: renders happen
   * in the next `tick`.
   */
  reportCollision(a: Collider, b: Collider): void {
    if (a.world === this) a.onCollisionEnter?.(b);
    if (b.world === this) b.onCollisionEnter?.(a);
  }

  /**
   * Report that two colliders stopped touching, because they moved apart or because one of them left the world or
   * lost its area. Each collider's own `onCollisionExit` callback is called with the other, but only for a collider
   * that is still mounted in this world (one that left is gone, and hears nothing). Dispatch only.
   */
  reportCollisionExit(a: Collider, b: Collider): void {
    if (a.world === this) a.onCollisionExit?.(b);
    if (b.world === this) b.onCollisionExit?.(a);
  }

  /**
   * A press at a world-space point: calls the pointer's own `onPress` when the
   * point is inside its area and it is mounted in this world. Returns whether it
   * was hit. Dispatch only: renders happen in the next `tick`. Which pointer
   * to test (and in what order, for overlaps) is the input system's job.
   */
  reportPress(pointer: Pressable, x: number, y: number): boolean {
    if (pointer.world !== this || !pointer.contains(x, y)) return false;
    pointer.onPress?.();
    return true;
  }

  /** Called by GameObject when it joins this world: remember which per-tick hooks it overrides. */
  registerObject(object: GameObject): void {
    if (object.onInput !== GameObject.prototype.onInput) this.#onInput.add(object);
    if (object.onUpdate !== GameObject.prototype.onUpdate) this.#onUpdate.add(object);
  }

  unregisterObject(object: GameObject): void {
    this.#onInput.delete(object);
    this.#onUpdate.delete(object);
  }

  /** Process all pending work until the tree is stable. Returns the number of renders run. */
  flush(): number {
    let renders = 0;
    while (this.#dirty.length > 0 || this.#structure.size > 0) {
      const dirty = this.#dirty;
      this.#dirty = [];
      const pass = ++passes;
      for (let i = 0; i < dirty.length; i++) if ((dirty[i] as GameObject).renderInPass(this, pass)) renders++;
      const structure = [...this.#structure];
      this.#structure.clear();
      for (const object of structure) object.commitStructure();
    }
    return renders;
  }
}
