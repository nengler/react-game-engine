import { GameObject } from "./GameObject.ts";
import { Collider } from "./components/Collider.ts";
import type { Pressable } from "./components/Pointer.ts";
import { NO_INPUT, type InputState } from "./input.ts";

/** Steps the world is asked to freeze for by `freeze`: taken up by the next tick that is not already frozen. */
let freezeRequest = 0;

/**
 * Pause the world's `onUpdate` for the next `steps` ticks: a hit, a dash, a death, which feels heavier for a few frames of
 * stillness. Things drawn keep drawing, `onInput` still runs, and renders still happen, so state set by the step that
 * called this still shows. The player keeps the key edges of a frozen step for the first step after it, so a press during
 * the freeze is not lost. Asking again while frozen extends it to the longer of the two. Any code in a tick can call it,
 * including a game state action.
 */
export function freeze(steps: number): void {
  if (steps > freezeRequest) freezeRequest = Math.floor(steps);
}

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
  readonly #inert = new Set<GameObject>();
  #frozen = 0;

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
   *
   * `beforeUpdate`, when given, is called after `onInput` and before `onUpdate`, and only when the update is not frozen: the
   * player uses it to show `onUpdate` the key edges a freeze kept (see `freeze`), which `onInput` has already seen.
   */
  tick(dt: number, input: InputState = NO_INPUT, beforeUpdate?: () => void): number {
    const inputs = [...this.#onInput];
    const anyInert = this.#hasInert();
    for (const object of inputs) if (object.world === this) object.onInput(anyInert && this.isInert(object) ? NO_INPUT : input);
    if (this.#frozen > 0) this.#frozen--;
    else {
      beforeUpdate?.();
      const updates = [...this.#onUpdate];
      for (const object of updates) if (object.world === this) object.onUpdate(dt, anyInert && this.isInert(object) ? NO_INPUT : input);
    }
    // A freeze asked for during this tick starts with the next.
    if (freezeRequest > this.#frozen) this.#frozen = freezeRequest;
    freezeRequest = 0;
    return this.flush();
  }

  /** How many more ticks `onUpdate` will be skipped for (see `freeze`). */
  get frozenSteps(): number {
    return this.#frozen;
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
    if (this.#hasInert() && this.isInert(pointer as unknown as GameObject)) return false;
    pointer.onPress?.();
    return true;
  }

  /**
   * Make a subtree inert, or not, as the HTML attribute does: it still updates, draws and collides, but hears no input (its
   * `useInput` and `useUpdate` get no keys pressed) and none of its pointers can be pressed. A router makes the screen it is
   * leaving inert for the transition, so a button pressed during a fade acts only on the screen being entered.
   */
  setInert(object: GameObject, inert: boolean): void {
    if (inert) this.#inert.add(object);
    else this.#inert.delete(object);
  }

  /** Whether `object` is in a subtree made inert (see `setInert`). */
  isInert(object: GameObject): boolean {
    if (this.#inert.size === 0) return false;
    for (let at: GameObject | null = object; at !== null; at = at.parent) if (this.#inert.has(at)) return true;
    return false;
  }

  #hasInert(): boolean {
    if (this.#inert.size === 0) return false;
    for (const object of this.#inert) if (object.world !== this) this.#inert.delete(object);
    return this.#inert.size > 0;
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
