import { boxesOverlap, type BodySpace, type Box } from "./body.ts";
import { Collider, type Contact, type Nearby, type SendTarget } from "./components/Collider.ts";
import { Menu } from "./components/Menu.ts";
import type { Pressable } from "./components/Pointer.ts";
import { Tilemap } from "./components/Tilemap.ts";
import { GameObject } from "./GameObject.ts";
import { takeTreeRestore } from "./gameTree.ts";
import { restoreHotState } from "./hot.ts";
import { NO_INPUT, type InputState } from "./input.ts";
import { activeProfiler, PROFILE_INPUT, PROFILE_RENDER, PROFILE_UPDATE } from "./profile.ts";
import { geometryOf, geometryOverlapsBox } from "./shapes.ts";
import { countStep } from "./Sound.ts";
import { findTilemap } from "./tilemap.ts";
import type { WorldTransform } from "./Transform.ts";

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
/** A focusable that takes typing (`<TextInput>`): while it has the focus, the World hands it `InputState.typed`, and Enter submits it. */
interface TextEntry {
  takeText(typed: string): void;
  submit(): void;
}

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
  /**
   * The objects with an `onInput` or an `onUpdate`, in tree order (depth first, a parent before its children, siblings as they are
   * children of their parent): the order handlers run in. It is made when a frame needs it after the tree or the set of handlers
   * changed (`orderChanged`), and a frame runs over the list it began with, so an object added during it starts next frame.
   */
  #order: { readonly input: readonly GameObject[]; readonly update: readonly GameObject[] } | null = null;
  readonly #inert = new Set<GameObject>();
  /** Objects with `modal`, in the order they were mounted: the last one in this world takes the input. */
  readonly #modals: GameObject[] = [];
  /** Every `<Pointer>` and `<Flex>` in this world: what a `pressKey`, the focus and the confirm key look through. */
  readonly #pressables = new Set<GameObject & Pressable>();
  #focused: (GameObject & Pressable) | null = null;
  /** What had the focus when a modal made it inert, to give it back when it can take it again (as a browser does when a dialog closes). */
  #focusBeforeInert: (GameObject & Pressable) | null = null;
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
    this.#spaces = null;
    this.#indexes = null;
    const anyInert = this.#hasInert();
    if (this.#pressables.size > 0 && input !== NO_INPUT) this.#keys(input, anyInert);
    const order = (this.#order ??= this.#treeOrder());
    const inputs = order.input;
    const profiler = activeProfiler();
    if (profiler === null) {
      for (const object of inputs) if (object.world === this) object.onInput(anyInert && this.isInert(object) ? NO_INPUT : input);
    } else {
      for (const object of inputs) {
        if (object.world !== this) continue;
        const started = profiler.now();
        object.onInput(anyInert && this.isInert(object) ? NO_INPUT : input);
        profiler.add(object, PROFILE_INPUT, profiler.now() - started);
      }
    }
    if (this.#frozen > 0) this.#frozen--;
    else if (!this.paused) {
      beforeUpdate?.();
      const updates = order.update;
      if (profiler === null) {
        for (const object of updates) if (object.world === this) object.onUpdate(dt, anyInert && this.isInert(object) ? NO_INPUT : input);
      } else {
        for (const object of updates) {
          if (object.world !== this) continue;
          const started = profiler.now();
          object.onUpdate(dt, anyInert && this.isInert(object) ? NO_INPUT : input);
          profiler.add(object, PROFILE_UPDATE, profiler.now() - started);
        }
      }
      // Timers, after the updates of the step, in the order their objects first set one.
      if (this.#timed.size > 0) {
        for (const object of [...this.#timed]) {
          const started = profiler?.now() ?? 0;
          if (object.world !== this || !object.stepTimers(dt)) this.#timed.delete(object);
          if (profiler !== null) profiler.add(object, PROFILE_UPDATE, profiler.now() - started);
        }
      }
    }
    // What was sent this step (`send`), now that every update and timer has run: before the step renders, so what a receiver
    // changes is drawn this step. Run even while frozen or paused, as collisions are: a send from `useInput` still lands.
    if (this.#sends.length > 0) this.#deliver();
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
    if (pointer !== null && (pointer.world !== this || (this.#hasInert() && this.isInert(pointer as unknown as GameObject))))
      pointer = null;
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
    const next =
      target !== null && (target as GameObject & Pressable).world === this && target.focusable === true && target.disabled !== true
        ? (target as GameObject & Pressable)
        : null;
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
    // While a text field has the focus, what is typed goes into it, and the keys that move or press are only the plain ones (the arrows,
    // Enter, Escape and the gamepad's), never letters an action is bound to: typing "x" must not go back, nor a `pressKey` fire.
    const ask = (action: string, keys: readonly string[]): boolean =>
      !typing() && input.isAction?.(action) ? input.pressed(action) : keys.some((k) => input.pressed(k));
    const typing = (): boolean => this.#focused !== null && typeof (this.#focused as Partial<TextEntry>).takeText === "function";
    if (this.#focused !== null && !focusables.includes(this.#focused)) {
      const lost = this.#focused;
      if (anyInert && lost.world === this && lost.focusable === true && lost.disabled !== true && this.isInert(lost))
        this.#focusBeforeInert = lost;
      this.focus(null);
    }
    const before = this.#focusBeforeInert;
    if (before !== null && (before.world !== this || focusables.includes(before))) {
      this.#focusBeforeInert = null;
      if (before.world === this && (this.#focused === null || this.#focused.world !== this)) this.focus(before);
    }
    if (this.#focused === null) {
      const auto = focusables.find((p) => p.autoFocus === true);
      if (auto) this.focus(auto);
    }
    if (typing()) (this.#focused as unknown as TextEntry).takeText(input.typed ?? "");
    if (focusables.length > 0) {
      const dx = (ask("right", ["ArrowRight", "PadRight"]) ? 1 : 0) - (ask("left", ["ArrowLeft", "PadLeft"]) ? 1 : 0);
      const dy = dx !== 0 ? 0 : (ask("down", ["ArrowDown", "PadDown"]) ? 1 : 0) - (ask("up", ["ArrowUp", "PadUp"]) ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        if (this.#focused === null) this.focus(focusables[0]!);
        else if (this.#focused.onNavigate?.(dx, dy) === true) {
          // It used the direction itself (a slider moving its thumb), so the focus stays.
        } else {
          const next = this.#nextFocus(this.#focused, focusables, dx, dy);
          if (next !== null) this.focus(next);
        }
      } else if (this.#focused !== null && ask("confirm", ["Enter", "PadA"])) {
        if (typing()) (this.#focused as unknown as TextEntry).submit();
        else this.#focused.onPress?.();
      } else if (this.#focused !== null && ask("back", ["Escape", "PadB"])) menuOf(this.#focused)?.onBack?.();
    }
    if (typing()) return;
    for (const p of live) if (p.pressKey !== undefined && p.world === this && input.pressed(p.pressKey)) p.onPress?.();
  }

  /**
   * Where the focus goes from `from` in a direction: inside a `<Menu>`, the nearest of the menu's own items that way, or round to the
   * far end when there is none and the menu loops (it never leaves the menu); elsewhere, the nearest focusable that way.
   */
  #nextFocus(
    from: GameObject & Pressable,
    focusables: readonly (GameObject & Pressable)[],
    dx: number,
    dy: number
  ): (GameObject & Pressable) | null {
    const menu = menuOf(from);
    if (menu === null) return nearestInDirection(from, focusables, dx, dy);
    const items = focusables.filter((p) => menuOf(p) === menu);
    return nearestInDirection(from, items, dx, dy) ?? (menu.loop ? farthestInDirection(from, items, -dx, -dy) : null);
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
  /** Objects' child spaces, for the boxes (`#spaceOf`): dropped with them. */
  #spaces: Map<GameObject, WorldTransform> | null = null;
  /** The colliders by tag on a grid, for queries (`#indexOf`): dropped whenever the boxes are, and when a collider joins or leaves. */
  #indexes: Map<string, ColliderIndex> | null = null;
  readonly #tilemaps = new Set<Tilemap>();

  /**
   * The colliders with `tag` whose boxes come within `radius` of (`x`, `y`) in world space, nearest first (by the distance from the
   * point to the box, 0 inside it; ties in the order the colliders joined the world). The colliders `ignore` draws itself (the
   * asking component's own, not those of components inside it) do not count. Each is its contact (`tag`, `owner`, `data`) with where its box's middle is and that distance; it can
   * be handed to `send` to reach that one collider. Boxes are where they were when the step's updates began, as for bodies.
   */
  nearby<Tag extends string>(tag: Tag, x: number, y: number, radius: number, ignore: GameObject | null = null): Nearby<Tag>[] {
    if (!(radius >= 0) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const found = this.#indexOf(tag).within(x, y, radius, ignore);
    const out: Nearby<Tag>[] = new Array(found);
    for (let i = 0; i < found; i++) {
      const { collider, box } = NEAR_ENTRIES[i]!;
      out[i] = new NearbyResult(collider, box.x + box.width / 2, box.y + box.height / 2, NEAR_DISTANCES[i]!) as unknown as Nearby<Tag>;
    }
    return out;
  }

  /**
   * Send `value` to the colliders with `tag` that `where` names: every one whose box comes within a circle (`{ x, y, radius }`), or the
   * one collider a `nearby` result is. Delivered to their `onReceive` at the end of this step's update phase (after every
   * `useUpdate` and timer), in the order sent, each send's receivers nearest first; a send made while delivering (from an
   * `onReceive`) is delivered after the ones before it, in the same step. A send from outside a tick (a collision callback) is
   * delivered at the end of the next step's update phase. A receiver that left the world by then hears nothing.
   */
  send<Tag extends string>(tag: Tag, where: SendTarget<Tag>, value: unknown): void {
    this.#sends.push({ tag, where, value });
  }

  /**
   * Deliver now what `send` has queued, instead of at the end of the next step's update phase: for a test that hands a component
   * a value between steps (`@tsengine/testing`'s `t.send`). A game never needs it.
   */
  deliverSends(): void {
    if (this.#sends.length > 0) this.#deliver();
  }

  /** What `send` has queued for the end of the update phase. */
  readonly #sends: { readonly tag: string; readonly where: SendTarget; readonly value: unknown }[] = [];

  #deliver(): void {
    let delivered = 0;
    // Sends made by receivers join the end of the queue, so every one is delivered in order, in this step.
    for (let i = 0; i < this.#sends.length; i++) {
      const { tag, where, value } = this.#sends[i]!;
      const one = colliderOfResult(where);
      const receivers: Collider[] =
        one !== undefined
          ? one.tag === tag && one.world === this
            ? [one]
            : []
          : "radius" in where
            ? this.#collidersWithin(tag, where.x, where.y, where.radius)
            : [];
      for (const receiver of receivers) {
        if (receiver.world !== this) continue;
        (receiver.onReceive as ((value: unknown) => void) | undefined)?.(value);
        if (++delivered > MAX_DELIVERIES)
          throw new Error(
            `More than ${MAX_DELIVERIES} values were delivered in one step: receivers are sending to each other without end (an onReceive that sends to its own tag?).`
          );
      }
    }
    this.#sends.length = 0;
  }

  /** The colliders with `tag` within `radius` of a point, nearest first: whom a send to a circle reaches. */
  #collidersWithin(tag: string, x: number, y: number, radius: number): Collider[] {
    if (!(radius >= 0) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const found = this.#indexOf(tag).within(x, y, radius, null);
    const out: Collider[] = new Array(found);
    for (let i = 0; i < found; i++) out[i] = NEAR_ENTRIES[i]!.collider;
    return out;
  }

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
    for (const entry of this.#indexOf(SOLID).query(box)) if (!isUnder(entry.collider, ignore)) return entry.collider.tag;
    return null;
  }

  /** `BodySpace`: whether a collider with this tag overlaps `box` (a shaped one, by its shape). */
  tagIn(box: Box, tag: string, ignore: GameObject): boolean {
    for (const entry of this.#indexOf(tag).query(box))
      if (!isUnder(entry.collider, ignore) && shapeOverlaps(entry.collider, box)) return true;
    return false;
  }

  /** `BodySpace`: every collider with this tag that overlaps `box` (a shaped one, by its shape), in the order the colliders joined the world. */
  collidersIn(box: Box, tag: string, ignore: GameObject): Contact[] {
    const out: Contact[] = [];
    for (const entry of this.#indexOf(tag).query(box))
      if (!isUnder(entry.collider, ignore) && shapeOverlaps(entry.collider, box)) out.push(entry.collider as unknown as Contact);
    return out;
  }

  /**
   * The colliders with a tag (or, for `SOLID`, the solid ones), with their boxes, on a grid: made on the first query for that tag
   * in an update phase and dropped with the boxes, so twenty towers asking about a hundred enemies look at the few near each, not
   * every collider in the world. What a query returns is in the order of `#colliders`, as a plain scan would give it.
   */
  #indexOf(tag: string): ColliderIndex {
    const indexes = (this.#indexes ??= new Map());
    let index = indexes.get(tag);
    if (index === undefined) {
      const entries: IndexEntry[] = [];
      let order = 0;
      for (const collider of this.#colliders) {
        if (tag === SOLID ? collider.solid : collider.tag === tag)
          entries.push({ collider, box: this.#boxOf(collider), order, seen: 0, component: undefined });
        order++;
      }
      index = new ColliderIndex(entries);
      indexes.set(tag, index);
    }
    return index;
  }

  #boxOf(collider: Collider): Box {
    const boxes = (this.#boxes ??= new Map());
    let box = boxes.get(collider);
    if (box === undefined) {
      const at = collider.parent === null ? collider.worldTransform() : collider.worldTransformIn(this.#spaceOf(collider.parent));
      box = { x: at.x, y: at.y, width: collider.width, height: collider.height };
      boxes.set(collider, box);
    }
    return box;
  }

  /**
   * The space `object`'s children are placed in (`childSpace()`), remembered with the boxes: a thousand enemies' colliders share every
   * object above their own entity, and composing each one's transform up the tree from scratch was most of making the index.
   */
  #spaceOf(object: GameObject): WorldTransform {
    const spaces = (this.#spaces ??= new Map());
    let space = spaces.get(object);
    if (space === undefined) {
      // An object that places its children its own way (a `Camera` is transparent to them) is asked.
      space =
        object.childSpace !== GameObject.prototype.childSpace || object.worldTransform !== GameObject.prototype.worldTransform
          ? object.childSpace()
          : object.parent === null
            ? object.worldTransform()
            : object.worldTransformIn(this.#spaceOf(object.parent));
      spaces.set(object, space);
    }
    return space;
  }

  /** The tree changed (a child added, removed or moved) or an object with handlers joined or left: the order handlers run in is made again. */
  orderChanged(): void {
    this.#order = null;
  }

  #treeOrder(): { readonly input: readonly GameObject[]; readonly update: readonly GameObject[] } {
    const input: GameObject[] = [];
    const update: GameObject[] = [];
    const stack: GameObject[] = [this.root];
    while (stack.length > 0) {
      const object = stack.pop() as GameObject;
      const handlers = object.worldHandlers;
      if ((handlers & HANDLES_INPUT) !== 0) input.push(object);
      if ((handlers & HANDLES_UPDATE) !== 0) update.push(object);
      const children = object.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i] as GameObject;
        // A leaf with no hooks (a sprite, a collider) adds nothing: most of a crowd's objects.
        if (child.children.length > 0 || child.worldHandlers !== 0) stack.push(child);
      }
    }
    // An object registered but not under the root (it should not happen) still runs, after the rest, as it did before. Each object is
    // in the tree once, so when every registered one was found there is nothing to add, and no set of what was seen is needed.
    if (input.length !== this.#onInput.size) {
      const found = new Set(input);
      for (const object of this.#onInput) if (!found.has(object)) input.push(object);
    }
    if (update.length !== this.#onUpdate.size) {
      const found = new Set(update);
      for (const object of this.#onUpdate) if (!found.has(object)) update.push(object);
    }
    return { input, update };
  }

  registerObject(object: GameObject): void {
    if (object instanceof Collider) {
      this.#colliders.add(object);
      this.#indexes = null;
    } else if (object instanceof Tilemap) this.#tilemaps.add(object);
    if ("pressKey" in object && "focusable" in object) this.#pressables.add(object as GameObject & Pressable);
    object.worldHandlers = 0;
    if (object.onInput !== GameObject.prototype.onInput) {
      this.#onInput.add(object);
      object.worldHandlers |= HANDLES_INPUT;
    }
    if (object.onUpdate !== GameObject.prototype.onUpdate) {
      this.#onUpdate.add(object);
      object.worldHandlers |= HANDLES_UPDATE;
    }
    this.#order = null;
  }

  unregisterObject(object: GameObject): void {
    this.#timed.delete(object);
    if (object instanceof Collider) {
      this.#colliders.delete(object);
      this.#indexes = null;
    } else if (object instanceof Tilemap) this.#tilemaps.delete(object);
    this.#pressables.delete(object as GameObject & Pressable);
    if (this.#focused === object) this.#focused = null;
    if (this.#pressed === (object as unknown as Pressable)) this.#pressed = null;
    this.#onInput.delete(object);
    this.#onUpdate.delete(object);
    object.worldHandlers = 0;
    this.#order = null;
  }

  /** Process all pending work until the tree is stable. Returns the number of renders run. */
  flush(): number {
    let renders = 0;
    while (this.#dirty.length > 0 || this.#structure.size > 0) {
      const dirty = this.#dirty;
      this.#dirty = [];
      const pass = ++passes;
      const profiler = activeProfiler();
      if (profiler === null) {
        for (let i = 0; i < dirty.length; i++) if ((dirty[i] as GameObject).renderInPass(this, pass)) renders++;
      } else {
        for (let i = 0; i < dirty.length; i++) {
          const object = dirty[i] as GameObject;
          const started = profiler.now();
          if (!object.renderInPass(this, pass)) continue;
          renders++;
          profiler.add(object, PROFILE_RENDER, profiler.now() - started);
        }
      }
      const structure = [...this.#structure];
      this.#structure.clear();
      for (const object of structure) object.commitStructure();
    }
    // A save loaded with its tree (`createSave({ tree: true })`): the game state it applied has now built the tree, so its
    // components take their saved state back. `restoreHotState` flushes again; the restore was taken, so it runs once.
    const restore = takeTreeRestore(this);
    if (restore !== null) restoreHotState(this, restore.root, restore.state);
    this.#boxes = null;
    this.#spaces = null;
    this.#indexes = null;
    return renders;
  }
}

/**
 * The focusable nearest to `from` in a direction: only those on that side of it count, and distance across the direction
 * counts double, so the focus goes along a row before it jumps to the next one. Null when there is none that way.
 */
function nearestInDirection(
  from: Pressable,
  candidates: readonly (GameObject & Pressable)[],
  dx: number,
  dy: number
): (GameObject & Pressable) | null {
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

/** The farthest of `candidates` from `from` in a direction (the other end of a menu, to go round to), or null when none is that way. */
function farthestInDirection(
  from: Pressable,
  candidates: readonly (GameObject & Pressable)[],
  dx: number,
  dy: number
): (GameObject & Pressable) | null {
  const here = from.focusPoint?.() ?? { x: 0, y: 0 };
  let best: (GameObject & Pressable) | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c === from) continue;
    const at = c.focusPoint?.() ?? { x: 0, y: 0 };
    const along = (at.x - here.x) * dx + (at.y - here.y) * dy;
    if (along <= 0) continue;
    const across = Math.abs((at.x - here.x) * dy) + Math.abs((at.y - here.y) * dx);
    const score = along - across * 2;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** The nearest `<Menu>` that holds `object` (not counting itself), or null. */
function menuOf(object: Pressable): Menu | null {
  for (let at = (object as unknown as GameObject).parent; at !== null; at = at.parent) if (at instanceof Menu) return at;
  return null;
}

/** Is `object` `root` or inside it? */
function isUnder(object: GameObject, root: GameObject): boolean {
  for (let at: GameObject | null = object; at !== null; at = at.parent) if (at === root) return true;
  return false;
}

/** Whether a collider found by its box overlaps `box` by its shape: always for a plain box, which the box already answers. */
function shapeOverlaps(collider: Collider, box: Box): boolean {
  if (collider.shape === "box") return true;
  const g = geometryOf(collider, collider.worldTransform());
  return g !== null && geometryOverlapsBox(g, box.x, box.y, box.width, box.height);
}

/**
 * The component a collider belongs to: the nearest object above it that is not a built-in (a compiled component's class has no
 * `intrinsic` of its own), or null.
 */
function componentOf(collider: Collider): GameObject | null {
  // Starting at the collider: a component whose root is the `<Collider>` is that collider.
  for (let at: GameObject | null = collider; at !== null; at = at.parent) if (!Object.hasOwn(at.constructor, "intrinsic")) return at;
  return null;
}

/** The distance from a point to a box (0 inside it). */
function distanceToBox(x: number, y: number, box: Box): number {
  const dx = box.x > x ? box.x - x : x > box.x + box.width ? x - (box.x + box.width) : 0;
  const dy = box.y > y ? box.y - y : y > box.y + box.height ? y - (box.y + box.height) : 0;
  // Not `Math.hypot`, which V8 runs several times slower: this is asked for every collider a query looks at.
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A `nearby` result: the collider's contact (`tag`, `owner`, `data`), where its box's middle is and how far it is, and, hidden, the
 * collider itself, so `send` can reach that one. A private field and not a `WeakMap` from result to collider: putting each result in
 * a map cost about 200 times making it, and kept every result alive past the young generation, in a crowd where every enemy asks
 * for its neighbours every step. A copy of a result (a save, a snapshot) has no collider and reaches nothing, as a result kept past
 * its world does.
 */
class NearbyResult {
  readonly #collider: Collider;
  readonly tag: string;
  readonly owner: unknown;
  readonly data: unknown;
  readonly x: number;
  readonly y: number;
  readonly distance: number;

  constructor(collider: Collider, x: number, y: number, distance: number) {
    this.#collider = collider;
    this.tag = collider.tag;
    this.owner = collider.owner;
    this.data = collider.data;
    this.x = x;
    this.y = y;
    this.distance = distance;
  }

  static colliderOf(where: object): Collider | undefined {
    return #collider in where ? (where as NearbyResult).#collider : undefined;
  }
}

/** The collider a `nearby` result is, or undefined for anything else (a circle, a copy of a result). */
const colliderOfResult = (where: object): Collider | undefined => NearbyResult.colliderOf(where);

/** `GameObject.worldHandlers`: the world runs its `onInput`, its `onUpdate`. */
const HANDLES_INPUT = 1;
const HANDLES_UPDATE = 2;

/** More deliveries than this in one step is a loop of receivers sending to each other. */
const MAX_DELIVERIES = 100_000;

/** The key of the index of the solid colliders, whatever their tags (`solidIn`): not a tag a game can write. */
const SOLID = "\u0000solid";
/** The sides a collider index's cells may have, in pixels: about one and a half times its boxes' typical side, as a power of two. */
const MIN_CELL = 16;
const MAX_CELL = 64;
/** A collider whose box covers more cells than this is kept out of the cells and looked at by every query. */
const MAX_CELLS = 64;
/** Fewer entries than this, and a query looks at them all: a grid costs more than it saves. */
const SMALL = 16;

interface IndexEntry {
  readonly collider: Collider;
  readonly box: Box;
  /** Its place in the world's colliders: queries answer in this order. */
  readonly order: number;
  /** The query that last looked at it, so an entry in several cells is taken once. */
  seen: number;
  /** The component it belongs to (`componentOf`), worked out the first time a query needs it (undefined until then). */
  component: GameObject | null | undefined;
}

let queries = 0;

/**
 * What `ColliderIndex.within` found, nearest first: its entries and their distances, in arrays kept from one query to the next, so a
 * thousand enemies each asking for their neighbours make no garbage but the results they are given.
 */
const NEAR_ENTRIES: IndexEntry[] = [];
const NEAR_DISTANCES: number[] = [];

/**
 * `ColliderIndex.within`'s look at one entry: if it is not `ignore`'s own and comes within `radius` of (x, y), put it in its place in
 * the sorted run of `found` in `NEAR_ENTRIES` (a query finds a handful, so an insertion). Returns the new count.
 */
function take(entry: IndexEntry, x: number, y: number, radius: number, ignore: GameObject | null, found: number): number {
  if (ignore !== null && (entry.component === undefined ? (entry.component = componentOf(entry.collider)) : entry.component) === ignore)
    return found;
  const distance = distanceToBox(x, y, entry.box);
  if (!(distance <= radius)) return found;
  let i = found;
  while (i > 0 && nearer(entry, distance, NEAR_ENTRIES[i - 1]!, NEAR_DISTANCES[i - 1]!)) {
    NEAR_ENTRIES[i] = NEAR_ENTRIES[i - 1]!;
    NEAR_DISTANCES[i] = NEAR_DISTANCES[i - 1]!;
    i--;
  }
  NEAR_ENTRIES[i] = entry;
  NEAR_DISTANCES[i] = distance;
  return found + 1;
}

/** Whether entry `a` at distance `da` comes before `b` at `db`: nearer first, then in the world's order. */
const nearer = (a: IndexEntry, da: number, b: IndexEntry, db: number): boolean => da < db || (da === db && a.order < b.order);

/**
 * The entries of one tag, on a grid. A cell is about one and a half times the boxes' typical side: in a crowd, a cell much bigger than
 * the boxes holds dozens of them, and every query looks at all of them (32-pixel cells under 10-pixel enemies looked at fifty entries
 * a query to find four).
 */
class ColliderIndex {
  readonly #entries: readonly IndexEntry[];
  readonly #cells = new Map<number, IndexEntry[]>();
  /** Entries too big (or not finite) to put in cells. */
  readonly #wide: IndexEntry[] = [];
  readonly #out: IndexEntry[] = [];
  readonly #cell: number;

  constructor(entries: readonly IndexEntry[]) {
    this.#entries = entries;
    this.#cell = cellSideFor(entries);
    if (entries.length < SMALL) return;
    const CELL = this.#cell;
    for (const entry of entries) {
      const { box } = entry;
      const left = Math.floor(box.x / CELL);
      const right = Math.floor((box.x + box.width) / CELL);
      const top = Math.floor(box.y / CELL);
      const bottom = Math.floor((box.y + box.height) / CELL);
      if (!Number.isFinite(left + right + top + bottom) || (right - left + 1) * (bottom - top + 1) > MAX_CELLS) {
        this.#wide.push(entry);
        continue;
      }
      for (let cy = top; cy <= bottom; cy++) {
        for (let cx = left; cx <= right; cx++) {
          const key = cellKey(cx, cy);
          const cell = this.#cells.get(key);
          if (cell === undefined) this.#cells.set(key, [entry]);
          else cell.push(entry);
        }
      }
    }
  }

  /**
   * The entries whose boxes overlap `box`, in the world's order (or in no order, with `sorted` false, for a caller that sorts them
   * itself). The array is reused by the next query.
   */
  query(box: Box, sorted = true): readonly IndexEntry[] {
    const out = this.#out;
    out.length = 0;
    const entries = this.#entries;
    const CELL = this.#cell;
    const left = Math.floor(box.x / CELL);
    const right = Math.floor((box.x + box.width) / CELL);
    const top = Math.floor(box.y / CELL);
    const bottom = Math.floor((box.y + box.height) / CELL);
    const cells = (right - left + 1) * (bottom - top + 1);
    if (entries.length < SMALL || !Number.isFinite(cells) || cells > entries.length) {
      for (const entry of entries) if (boxesOverlap(box, entry.box)) out.push(entry);
      return out;
    }
    const stamp = ++queries;
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        const cell = this.#cells.get(cellKey(cx, cy));
        if (cell === undefined) continue;
        for (const entry of cell) {
          if (entry.seen === stamp) continue;
          entry.seen = stamp;
          if (boxesOverlap(box, entry.box)) out.push(entry);
        }
      }
    }
    for (const entry of this.#wide) if (boxesOverlap(box, entry.box)) out.push(entry);
    if (sorted && out.length > 1) out.sort(byOrder);
    return out;
  }

  /**
   * The entries whose boxes come within `radius` of (`x`, `y`), not counting those `ignore` draws itself, into `NEAR_ENTRIES` and
   * `NEAR_DISTANCES`, nearest first (ties in the world's order); returns how many. One pass over the cells the circle's bounds
   * cover (a pixel wider, so a box that just touches the circle is looked at), with no object made per entry.
   */
  within(x: number, y: number, radius: number, ignore: GameObject | null): number {
    const entries = this.#entries;
    const CELL = this.#cell;
    const left = Math.floor((x - radius - 1) / CELL);
    const right = Math.floor((x + radius + 1) / CELL);
    const top = Math.floor((y - radius - 1) / CELL);
    const bottom = Math.floor((y + radius + 1) / CELL);
    const cells = (right - left + 1) * (bottom - top + 1);
    let found = 0;
    if (entries.length < SMALL || !Number.isFinite(cells) || cells > entries.length) {
      for (let i = 0; i < entries.length; i++) found = take(entries[i]!, x, y, radius, ignore, found);
    } else {
      const stamp = ++queries;
      for (let cy = top; cy <= bottom; cy++) {
        for (let cx = left; cx <= right; cx++) {
          const cell = this.#cells.get(cellKey(cx, cy));
          if (cell === undefined) continue;
          for (let i = 0; i < cell.length; i++) {
            const entry = cell[i]!;
            if (entry.seen === stamp) continue;
            entry.seen = stamp;
            found = take(entry, x, y, radius, ignore, found);
          }
        }
      }
      const wide = this.#wide;
      for (let i = 0; i < wide.length; i++) found = take(wide[i]!, x, y, radius, ignore, found);
    }
    return found;
  }
}

const byOrder = (a: IndexEntry, b: IndexEntry): number => a.order - b.order;

/** A power of two about one and a half times the median longer side of the boxes, from `MIN_CELL` to `MAX_CELL`. */
function cellSideFor(entries: readonly IndexEntry[]): number {
  if (entries.length < SMALL) return MAX_CELL;
  // The median of a sample of up to 64 is enough to size the cells.
  const step = Math.max(1, Math.floor(entries.length / 64));
  const sides: number[] = [];
  for (let i = 0; i < entries.length; i += step) {
    const { width, height } = entries[i]!.box;
    const side = Math.max(width, height);
    if (Number.isFinite(side)) sides.push(side);
  }
  if (sides.length === 0) return MAX_CELL;
  sides.sort((a, b) => a - b);
  const want = sides[sides.length >> 1]! * 1.5;
  let cell = MIN_CELL;
  while (cell < want && cell < MAX_CELL) cell *= 2;
  return cell;
}

/** One number for a cell: distinct for any cell a game reaches (±32,768 cells, a million pixels each way); a clash would only cost a check. */
function cellKey(cx: number, cy: number): number {
  return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
}
