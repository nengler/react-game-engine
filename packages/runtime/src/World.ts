import { GameObject } from "./GameObject.ts";
import { Collider, type Contact } from "./components/Collider.ts";
import { Tilemap } from "./components/Tilemap.ts";
import { boxesOverlap, type BodySpace, type Box } from "./body.ts";
import { findTilemap } from "./tilemap.ts";
import { takeTreeRestore } from "./gameTree.ts";
import { restoreHotState } from "./hot.ts";
import type { Pressable } from "./components/Pointer.ts";
import { NO_INPUT, type InputState } from "./input.ts";
import { countStep } from "./Sound.ts";

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
export class World implements BodySpace {
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
  /** Objects with `modal`, in the order they were mounted: the last one in this world takes the input. */
  readonly #modals: GameObject[] = [];
  /** Every `<Pointer>` and `<Flex>` in this world: what a `pressKey`, the focus and the confirm key look through. */
  readonly #pressables = new Set<GameObject & Pressable>();
  #focused: (GameObject & Pressable) | null = null;
  readonly #live: (GameObject & Pressable)[] = [];
  readonly #focusables: (GameObject & Pressable)[] = [];
  #frozen = 0;
  /** While true no `onUpdate` runs (the player sets it from `<Game paused>`); `onInput` and presses still do. */
  paused = false;
  /** Objects with timers waiting (`GameObject.after`, `every`), stepped after the updates of each step that is not frozen or paused. */
  readonly #timed = new Set<GameObject>();

  /** An object in this world has a timer waiting. */
  addTimed(object: GameObject): void {
    this.#timed.add(object);
  }

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
    countStep();
    this.#boxes = null;
    const anyInert = this.#hasInert();
    if (this.#pressables.size > 0 && input !== NO_INPUT) this.#keys(input, anyInert);
    const inputs = [...this.#onInput];
    for (const object of inputs) if (object.world === this) object.onInput(anyInert && this.isInert(object) ? NO_INPUT : input);
    if (this.#frozen > 0) this.#frozen--;
    else if (!this.paused) {
      beforeUpdate?.();
      const updates = [...this.#onUpdate];
      for (const object of updates) if (object.world === this) object.onUpdate(dt, anyInert && this.isInert(object) ? NO_INPUT : input);
      // Timers, after the updates of the step, in the order their objects first set one.
      if (this.#timed.size > 0) {
        for (const object of [...this.#timed]) {
          if (object.world !== this || !object.stepTimers(dt)) this.#timed.delete(object);
        }
      }
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

  /** Put back a freeze a snapshot had (development rewind). */
  set frozenSteps(steps: number) {
    this.#frozen = Math.max(0, Math.floor(steps));
  }

  /**
   * Report that two colliders began touching (the mock has no physics; a
   * collision system calls this). Each collider's own `onCollisionEnter`
   * callback is called with the other collider. Dispatch only: the player
   * calls `flush` after the step's contacts, so what they change renders
   * before the next step.
   */
  reportCollision(a: Collider, b: Collider): void {
    if (a.world === this) a.onCollisionEnter?.(b as unknown as Contact);
    if (b.world === this) b.onCollisionEnter?.(a as unknown as Contact);
  }

  /**
   * Report that two colliders stopped touching, because they moved apart or because one of them left the world or
   * lost its area. Each collider's own `onCollisionExit` callback is called with the other, but only for a collider
   * that is still mounted in this world (one that left is gone, and hears nothing). Dispatch only.
   */
  reportCollisionExit(a: Collider, b: Collider): void {
    if (a.world === this) a.onCollisionExit?.(b as unknown as Contact);
    if (b.world === this) b.onCollisionExit?.(a as unknown as Contact);
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
    // A disabled one is hit, so what is under it does not get the press, but it hears nothing and takes no focus.
    if (pointer.disabled === true) return true;
    if (pointer.focusable === true) this.focus(pointer);
    this.#pressed = pointer;
    pointer.onPressAt?.(x, y);
    pointer.onPress?.();
    return true;
  }

  #pressed: Pressable | null = null;

  /** The pressable a press began on, while the mouse button is still held (null for none): what a `<Flex>`'s `pressed*` props are drawn for. */
  get pressed(): Pressable | null {
    return this.#pressed;
  }

  /** The mouse button is up: nothing is pressed any more. The player calls it every step the button is not held. */
  reportRelease(): void {
    this.#pressed = null;
  }

  #hovered: Pressable | null = null;

  /** The pressable the mouse is over, as of the last `reportHover` (null for none): what a `<Flex>`'s `hover*` props are drawn for. */
  get hovered(): Pressable | null {
    return this.#hovered;
  }

  /**
   * The topmost pressable under the mouse this frame (null for none, or for a mouse off the screen): when it is not the one
   * before, the one before hears `onPointerLeave` (if it is still in this world) and the new one `onPointerEnter`, as the DOM's
   * `pointerenter` / `pointerleave`. One in an inert subtree counts as none. Dispatch only: renders happen in the next `tick`.
   */
  reportHover(pointer: Pressable | null, silent = false): void {
    if (pointer !== null && (pointer.world !== this || (this.#hasInert() && this.isInert(pointer as unknown as GameObject)))) pointer = null;
    if (pointer === this.#hovered) return;
    const previous = this.#hovered;
    this.#hovered = pointer;
    // `silent`: the mouse was already over it (development rewind puts back a tree the mouse was over), so nobody is told.
    if (silent) return;
    if (previous !== null && previous.world === this) previous.onPointerLeave?.();
    pointer?.onPointerEnter?.();
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

  /**
   * Make an object modal, or not, as a `<dialog>` opened with `showModal()`: while it is in this world, everything outside its
   * subtree is inert (see `setInert`). The one made modal last takes the input. `GameObject.modal` calls it.
   */
  setModal(object: GameObject, modal: boolean): void {
    const at = this.#modals.indexOf(object);
    if (at !== -1) this.#modals.splice(at, 1);
    if (modal) this.#modals.push(object);
  }

  /** The modal that takes the input now, or null: the last one made modal that is still in this world. */
  get modal(): GameObject | null {
    const modals = this.#modals;
    while (modals.length > 0 && modals[modals.length - 1]!.world !== this) modals.pop();
    return modals.at(-1) ?? null;
  }

  /** Whether `object` hears no input: it is in a subtree made inert (see `setInert`), or outside the modal (see `setModal`). */
  isInert(object: GameObject): boolean {
    const modal = this.#modals.length > 0 ? this.modal : null;
    if (this.#inert.size === 0 && modal === null) return false;
    let insideModal = modal === null;
    for (let at: GameObject | null = object; at !== null; at = at.parent) {
      if (this.#inert.has(at)) return true;
      if (at === modal) insideModal = true;
    }
    return !insideModal;
  }

  #hasInert(): boolean {
    for (const object of this.#inert) if (object.world !== this) this.#inert.delete(object);
    return this.#inert.size > 0 || (this.#modals.length > 0 && this.modal !== null);
  }

  /** What has the focus (see `PressableProps.focusable`), or null. */
  get focused(): Pressable | null {
    return this.#focused;
  }

  /**
   * Give the focus to a focusable pressable in this world (null takes it away): the one that had it hears `onBlur`, this one
   * `onFocus`. A click on a focusable one focuses it, as in a browser; the arrow keys move it (`tick`).
   */
  focus(target: Pressable | null): void {
    const next = target !== null && (target as GameObject & Pressable).world === this && target.focusable === true && target.disabled !== true ? (target as GameObject & Pressable) : null;
    if (next === this.#focused) return;
    const previous = this.#focused;
    this.#focused = next;
    if (previous !== null && previous.world === this) previous.onBlur?.();
    next?.onFocus?.();
  }

  /**
   * Keys that press things, before any `onInput`: each mounted, not inert pressable whose `pressKey` was pressed is pressed; the focus
   * goes to an `autoFocus` one when nothing has it, moves with the direction actions (`left` `right` `up` `down`, or the arrows and the
   * d-pad when the controls have no such action) to the nearest focusable that way, and `confirm` (or Enter and PadA) presses it.
   */
  #keys(input: InputState, anyInert: boolean): void {
    // Scratch lists kept between ticks, so a tick allocates nothing here once warm.
    const live = this.#live;
    const focusables = this.#focusables;
    live.length = 0;
    focusables.length = 0;
    for (const p of this.#pressables) {
      if (p.world !== this || (anyInert && this.isInert(p))) continue;
      if (p.disabled === true) continue;
      live.push(p);
      if (p.focusable === true) focusables.push(p);
    }
    const ask = (action: string, keys: readonly string[]): boolean => (input.isAction?.(action) ? input.pressed(action) : keys.some((k) => input.pressed(k)));
    if (this.#focused !== null && !focusables.includes(this.#focused)) this.focus(null);
    if (this.#focused === null) {
      const auto = focusables.find((p) => p.autoFocus === true);
      if (auto) this.focus(auto);
    }
    if (focusables.length > 0) {
      const dx = (ask("right", ["ArrowRight", "PadRight"]) ? 1 : 0) - (ask("left", ["ArrowLeft", "PadLeft"]) ? 1 : 0);
      const dy = dx !== 0 ? 0 : (ask("down", ["ArrowDown", "PadDown"]) ? 1 : 0) - (ask("up", ["ArrowUp", "PadUp"]) ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        if (this.#focused === null) this.focus(focusables[0]!);
        else if (this.#focused.onNavigate?.(dx, dy) === true) {
          // It used the direction itself (a slider moving its thumb), so the focus stays.
        } else {
          const next = nearestInDirection(this.#focused, focusables, dx, dy);
          if (next !== null) this.focus(next);
        }
      } else if (this.#focused !== null && ask("confirm", ["Enter", "PadA"])) this.#focused.onPress?.();
    }
    for (const p of live) if (p.pressKey !== undefined && p.world === this && input.pressed(p.pressKey)) p.onPress?.();
  }

  /** Called by GameObject when it joins this world: remember which per-tick hooks it overrides. */
  /** The colliders and the solid tilemaps in this world, for bodies (`useBody`). */
  readonly #colliders = new Set<Collider>();
  /**
   * The colliders' world boxes, worked out once per update phase: a body's queries (twenty towers each asking which of a hundred
   * enemies are near) would otherwise compose each collider's transform up the tree every time. Transforms change when the tree
   * renders, so the cache is dropped as a tick starts and after every flush: a query sees the colliders where they were when the
   * step's updates began, as the step's state is a snapshot.
   */
  #boxes: Map<Collider, Box> | null = null;
  readonly #tilemaps = new Set<Tilemap>();

  /** `BodySpace`: the tag of something solid in `box` (`"tile"` for a solid tile), or null. */
  solidIn(box: Box, ignore: GameObject): string | null {
    for (const map of this.#tilemaps) {
      if (!map.solid) continue;
      const grid = findTilemap(map.map);
      if (grid === undefined) continue;
      const at = map.worldTransform();
      const { tileWidth, tileHeight } = grid.data;
      const left = Math.floor((box.x - at.x) / tileWidth);
      const right = Math.floor((box.x + box.width - 1 - at.x) / tileWidth);
      const top = Math.floor((box.y - at.y) / tileHeight);
      const bottom = Math.floor((box.y + box.height - 1 - at.y) / tileHeight);
      for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) if (grid.solidAt(col, row)) return "tile";
    }
    for (const collider of this.#colliders) {
      if (!collider.solid || isUnder(collider, ignore)) continue;
      if (boxesOverlap(box, this.#boxOf(collider))) return collider.tag;
    }
    return null;
  }

  /** `BodySpace`: whether a collider with this tag overlaps `box`. */
  tagIn(box: Box, tag: string, ignore: GameObject): boolean {
    for (const collider of this.#colliders) {
      if (collider.tag !== tag || isUnder(collider, ignore)) continue;
      if (boxesOverlap(box, this.#boxOf(collider))) return true;
    }
    return false;
  }

  /** `BodySpace`: every collider with this tag that overlaps `box`. */
  collidersIn(box: Box, tag: string, ignore: GameObject): Contact[] {
    const out: Contact[] = [];
    for (const collider of this.#colliders) {
      if (collider.tag !== tag || isUnder(collider, ignore)) continue;
      if (boxesOverlap(box, this.#boxOf(collider))) out.push(collider as unknown as Contact);
    }
    return out;
  }

  #boxOf(collider: Collider): Box {
    const boxes = (this.#boxes ??= new Map());
    let box = boxes.get(collider);
    if (box === undefined) {
      box = colliderBox(collider);
      boxes.set(collider, box);
    }
    return box;
  }

  registerObject(object: GameObject): void {
    if (object instanceof Collider) this.#colliders.add(object);
    else if (object instanceof Tilemap) this.#tilemaps.add(object);
    if ("pressKey" in object && "focusable" in object) this.#pressables.add(object as GameObject & Pressable);
    if (object.onInput !== GameObject.prototype.onInput) this.#onInput.add(object);
    if (object.onUpdate !== GameObject.prototype.onUpdate) this.#onUpdate.add(object);
  }

  unregisterObject(object: GameObject): void {
    this.#timed.delete(object);
    if (object instanceof Collider) this.#colliders.delete(object);
    else if (object instanceof Tilemap) this.#tilemaps.delete(object);
    this.#pressables.delete(object as GameObject & Pressable);
    if (this.#focused === object) this.#focused = null;
    if (this.#pressed === (object as unknown as Pressable)) this.#pressed = null;
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
    // A save loaded with its tree (`createSave({ tree: true })`): the game state it applied has now built the tree, so its
    // components take their saved state back. `restoreHotState` flushes again; the restore was taken, so it runs once.
    const restore = takeTreeRestore(this);
    if (restore !== null) restoreHotState(this, restore.root, restore.state);
    this.#boxes = null;
    return renders;
  }
}

/**
 * The focusable nearest to `from` in a direction: only those on that side of it count, and distance across the direction
 * counts double, so the focus goes along a row before it jumps to the next one. Null when there is none that way.
 */
function nearestInDirection(from: Pressable, candidates: readonly (GameObject & Pressable)[], dx: number, dy: number): (GameObject & Pressable) | null {
  const here = from.focusPoint?.() ?? { x: 0, y: 0 };
  let best: (GameObject & Pressable) | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c === from) continue;
    const at = c.focusPoint?.() ?? { x: 0, y: 0 };
    const along = (at.x - here.x) * dx + (at.y - here.y) * dy;
    if (along <= 0) continue;
    const across = Math.abs((at.x - here.x) * dy) + Math.abs((at.y - here.y) * dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Is `object` `root` or inside it? */
function isUnder(object: GameObject, root: GameObject): boolean {
  for (let at: GameObject | null = object; at !== null; at = at.parent) if (at === root) return true;
  return false;
}

/** A collider's box in world space: its top left at its world position, not scaled or turned (bodies are boxes on the grid). */
function colliderBox(collider: Collider): Box {
  const at = collider.worldTransform();
  return { x: at.x, y: at.y, width: collider.width, height: collider.height };
}
