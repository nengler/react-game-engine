import { GameObject } from "./GameObject.ts";
import { Collider } from "./components/Collider.ts";
import { Pointer } from "./components/Pointer.ts";
import { NO_INPUT, type InputState } from "./input.ts";

/**
 * Owns the root of the object tree and drives dirty-driven updates:
 * render every dirty object, then apply queued structural changes.
 */
export class World {
  readonly root: GameObject = new GameObject();
  #dirty = new Set<GameObject>();
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
    this.#dirty.add(object);
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
  reportCollision(a: GameObject, b: GameObject): void {
    if (a instanceof Collider && a.world === this) a.onCollisionEnter?.(b);
    if (b instanceof Collider && b.world === this) b.onCollisionEnter?.(a);
  }

  /**
   * A press at a world-space point: calls the pointer's own `onPress` when the
   * point is inside its area and it is mounted in this world. Returns whether it
   * was hit. Dispatch only: renders happen in the next `tick`. Which pointer
   * to test (and in what order, for overlaps) is the input system's job.
   */
  reportPress(pointer: Pointer, x: number, y: number): boolean {
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
    while (this.#dirty.size > 0 || this.#structure.size > 0) {
      const dirty = [...this.#dirty];
      this.#dirty.clear();
      for (const object of dirty) {
        if (object.world !== this || !object.isDirty) continue;
        object.runRender();
        renders++;
      }
      const structure = [...this.#structure];
      this.#structure.clear();
      for (const object of structure) object.commitStructure();
    }
    return renders;
  }
}
