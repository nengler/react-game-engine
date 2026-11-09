import type { Collider, World, WorldTransform } from "@rge/runtime";
import type { ColliderEntry } from "./draw.ts";

/** An axis-aligned box in world space. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Where a collider is: the box `width × height` with its top-left corner at the object's world position
 * (the same origin as a `Sprite` and a `Shape`), scaled by the world scale and turned by the world rotation,
 * then boxed in axis-aligned bounds of its four corners. A **rotated collider is therefore approximated by
 * the smallest upright box around it** (a quarter turn is exact; 45° makes the box about 41% wider each way).
 * A negative scale flips the box, as it flips a sprite.
 *
 * Null when the collider has no area: a width or height that is not positive, a zero scale, or anything that
 * is not a finite number. Such a collider never collides.
 */
export function colliderBounds(width: number, height: number, world: WorldTransform): Bounds | null {
  if (!writeBounds(width, height, world, SCRATCH, 0)) return null;
  return { minX: SCRATCH[0] as number, minY: SCRATCH[1] as number, maxX: SCRATCH[2] as number, maxY: SCRATCH[3] as number };
}

const SCRATCH = new Float64Array(4);

/**
 * `colliderBounds`, written into `out[at .. at + 4)` as minX, minY, maxX, maxY instead of a new object (the tracker
 * calls it for every collider every frame). Returns false, having written nothing useful, when the collider has no area.
 */
function writeBounds(width: number, height: number, world: WorldTransform, out: Float64Array, at: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  const w = width * world.scaleX;
  const h = height * world.scaleY;
  let minX: number;
  let minY: number;
  let maxX: number;
  let maxY: number;
  if (world.rotation === 0) {
    // Upright (the usual case): the corners are the origin and (w, h), whatever their signs.
    minX = Math.min(world.x, world.x + w);
    maxX = Math.max(world.x, world.x + w);
    minY = Math.min(world.y, world.y + h);
    maxY = Math.max(world.y, world.y + h);
  } else {
    const cos = Math.cos(world.rotation);
    const sin = Math.sin(world.rotation);
    // The corners (0, 0), (w, 0), (0, h) and (w, h), turned about the origin.
    const x1 = world.x + w * cos;
    const y1 = world.y + w * sin;
    const x2 = world.x - h * sin;
    const y2 = world.y + h * cos;
    const x3 = world.x + w * cos - h * sin;
    const y3 = world.y + w * sin + h * cos;
    minX = Math.min(world.x, x1, x2, x3);
    maxX = Math.max(world.x, x1, x2, x3);
    minY = Math.min(world.y, y1, y2, y3);
    maxY = Math.max(world.y, y1, y2, y3);
  }
  if (!(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))) return false;
  if (!(maxX > minX && maxY > minY)) return false;
  out[at] = minX;
  out[at + 1] = minY;
  out[at + 2] = maxX;
  out[at + 3] = maxY;
  return true;
}

/** Whether two boxes overlap. Boxes that only share an edge do not: touching is not colliding. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * Ids below this make an int pair key: `low * 2^15 + high` is below 2^30, so both engines store it as a small
 * integer. The tracker renumbers ids to keep them below it (see `CollisionTracker.#renumber`); beyond it (more
 * colliders than this in one frame) `pairKey` falls back to a string, which is slower but still exact.
 */
const SMALL_ID = 0x8000;
const KEY_MASK = 0x3fffffff;
/** Odd, so multiplying by it is a bijection on 30-bit numbers; `MIX_INVERSE` undoes it (Newton's iteration for 1/x mod 2^32). */
const MIX = 0x2545f491;
const MIX_INVERSE = [0, 1, 2, 3].reduce((x) => Math.imul(x, 2 - Math.imul(MIX, x)), MIX);

/**
 * One key per pair of collider ids, `low < high`. The int key is scrambled (multiplied by an odd number, then
 * xor-shifted, both reversible) because QuickJS-ng hashes an integer key with a single multiply and keeps its low
 * bits, which in `low * 2^15 + high` come from `high` alone: a pile of overlapping colliders filled a few buckets,
 * and was slower than string keys. Numbers above int32 are worse still there (about ten times slower than strings).
 */
function pairKey(low: number, high: number): number | string {
  if (high >= SMALL_ID) return `${low}:${high}`;
  const key = Math.imul(low * SMALL_ID + high, MIX) & KEY_MASK;
  return key ^ (key >>> 15);
}

/** The ids `pairKey` was given. */
function pairOf(key: number | string): [number, number] {
  if (typeof key === "string") {
    const colon = key.indexOf(":");
    return [Number(key.slice(0, colon)), Number(key.slice(colon + 1))];
  }
  const plain = Math.imul(key ^ (key >>> 15), MIX_INVERSE) & KEY_MASK;
  return [Math.floor(plain / SMALL_ID), plain % SMALL_ID];
}

/** Two colliders that were touching last frame, kept so their exit can be reported after one has left the list. */
type Pair = readonly [Collider, Collider];

/**
 * Colliders by id. Ids are kept below `SMALL_ID`, so an array indexed by id does for them (a `Map` refilled every frame
 * cost 8 ms for 2,000 colliders under QuickJS); the few above it, in a game with that many colliders, go in a `Map`.
 */
class ById {
  #small: (Collider | undefined)[] = [];
  #large: Map<number, Collider> | undefined;

  set(id: number, collider: Collider): void {
    if (id < SMALL_ID) this.#small[id] = collider;
    else (this.#large ??= new Map()).set(id, collider);
  }

  get(id: number): Collider | undefined {
    return id < SMALL_ID ? this.#small[id] : this.#large?.get(id);
  }

  clear(): void {
    this.#small.length = 0;
    this.#large?.clear();
  }
}

/**
 * Finds the moment two colliders start touching and reports it with `world.reportCollision(a, b)`: the
 * collider's own `onCollisionEnter` is called with the other collider, on both sides. A pair that keeps
 * overlapping is not reported again, and a pair that separates and touches again is.
 *
 * It also finds the moment a pair stops touching and reports it with `world.reportCollisionExit(a, b)` (each
 * collider's `onCollisionExit`). That happens when the boxes move apart, and also when one collider leaves the
 * world or loses its area, since it is no longer in the frame's list. Exits are reported before enters.
 *
 * Call `update` once per frame with the colliders the frame's tree walk found (`BuiltFrame.colliders`); the
 * player does. A pair is forgotten as soon as it is not overlapping in a frame, so one that comes back already
 * touching is a new contact.
 *
 * **Colliders with the same parent never collide with each other**, so a component with several colliders (a
 * hitbox and a shield) does not hit itself. A pair is also skipped unless each collider's `hits` allows the
 * other's `layer` (see `ColliderProps.hits`). Everything else collides.
 *
 * Reports run after the frame's renders, so what a callback changes is rendered by the next tick.
 *
 * Cost: a sweep over x (see `update`), so a spread-out scene costs about n log n and only boxes that overlap in x
 * are compared. A scene where most colliders share the same columns degrades towards every pair. Measured: see
 * `packages/player/bench/frame.ts`, and the numbers in `docs/NATIVE_PLAN.md`.
 */
export class CollisionTracker {
  #ids = new WeakMap<Collider, number>();
  #nextId = 0;
  readonly #compactAt: number;
  /** `pairKey` of every pair that overlapped in the last frame. */
  #touching = new Set<number | string>();
  /** This frame's pairs, being collected; swapped with `#touching` at the end of `update` and reused. */
  #now = new Set<number | string>();
  /**
   * Last frame's colliders by id, so a pair that ended can be turned back into colliders for its exit (its key holds
   * only ids, and one of them may have left the list). One entry per collider, not per pair: a `Map` entry per touching
   * pair was twice as slow as a `Set` in a pile under QuickJS.
   */
  #byId = new ById();
  #byIdNow = new ById();
  // Reused between frames: this frame's boxes (minX, minY, maxX, maxY each), their colliders and ids.
  #bounds = new Float64Array(256);
  #colliders: Collider[] = [];
  #boxIds: number[] = [];
  // Each box's layer and hits, read once per frame so the pair loop does no method calls (a pile tests thousands of pairs).
  #layers: string[] = [];
  #hits: (readonly string[] | undefined)[] = [];
  #order: number[] = [];

  /** Pairs `#renumber` could not carry over because a collider left; their exit is reported by the `update` that renumbered. */
  #lost: Pair[] | undefined;

  /** `compactAt` is for tests: renumber ids once they reach it (default 2^15, the most that make int32 pair keys). */
  constructor(compactAt: number = SMALL_ID) {
    this.#compactAt = Math.min(compactAt, SMALL_ID);
  }

  /** Compare this frame's colliders with last frame's contacts and report new contacts and ended ones. Returns how many contacts started (exits are not counted). */
  update(world: World, colliders: readonly ColliderEntry[]): number {
    // Keep ids small, so pair keys stay int32. Only when it pays: not every frame when there are simply that many colliders.
    if (this.#nextId + colliders.length > this.#compactAt && this.#nextId > 2 * colliders.length) this.#renumber(colliders);

    if (this.#bounds.length < colliders.length * 4) this.#bounds = new Float64Array(colliders.length * 8);
    const bounds = this.#bounds;
    const boxColliders = this.#colliders;
    const ids = this.#boxIds;
    const layers = this.#layers;
    const hitsOf = this.#hits;
    let count = 0;
    const byIdNow = this.#byIdNow;
    byIdNow.clear();
    for (const { collider, world: transform } of colliders) {
      if (!writeBounds(collider.width, collider.height, transform, bounds, count * 4)) continue;
      boxColliders[count] = collider;
      const id = this.#id(collider);
      ids[count] = id;
      layers[count] = collider.layer;
      hitsOf[count] = collider.hits;
      byIdNow.set(id, collider);
      count++;
    }
    boxColliders.length = count;
    ids.length = count;
    layers.length = count;
    hitsOf.length = count;

    // Sweep over x: with the boxes sorted by their left edge, a box can only touch the ones after it that start
    // before it ends, so each inner loop stops at the first box that starts past `maxX`. Those boxes overlap in x
    // by construction, so only y is left to test. (Ties in `minX` keep draw order.)
    const order = this.#order;
    order.length = count;
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((p, q) => (bounds[p * 4] as number) - (bounds[q * 4] as number) || p - q);

    const now = this.#now;
    now.clear();
    const touching = this.#touching;
    const started: [number, number][] = [];
    let kept = 0; // pairs that touched last frame and still do
    for (let s = 0; s < count; s++) {
      const p = order[s] as number;
      const minY = bounds[p * 4 + 1] as number;
      const maxX = bounds[p * 4 + 2] as number;
      const maxY = bounds[p * 4 + 3] as number;
      const parent = (boxColliders[p] as Collider).parent;
      const layerP = layers[p] as string;
      const hitsP = hitsOf[p];
      const idP = ids[p] as number;
      for (let t = s + 1; t < count; t++) {
        const q = order[t] as number;
        if ((bounds[q * 4] as number) >= maxX) break;
        if (!(minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))) continue;
        const other = boxColliders[q] as Collider;
        if (parent === other.parent) continue;
        const hitsQ = hitsOf[q];
        if ((hitsP !== undefined && !hitsP.includes(layers[q] as string)) || (hitsQ !== undefined && !hitsQ.includes(layerP))) continue;
        const idQ = ids[q] as number;
        const key = idP < idQ ? pairKey(idP, idQ) : pairKey(idQ, idP);
        now.add(key);
        if (touching.has(key)) kept++;
        else started.push(p < q ? [p, q] : [q, p]);
      }
    }
    // Pairs that touched last frame and do not now. Collected before the swap; reported below, ahead of the enters.
    let ended: Pair[] | undefined = this.#lost;
    this.#lost = undefined;
    // Nothing ended when every pair of last frame was kept: the common case, and it spares a scan of the whole set.
    for (const key of kept === touching.size ? [] : touching) {
      if (now.has(key)) continue;
      const [low, high] = pairOf(key);
      const a = this.#byId.get(low);
      const b = this.#byId.get(high);
      if (a && b) (ended ??= []).push([a, b]);
    }
    this.#now = touching;
    this.#touching = now;
    this.#byIdNow = this.#byId;
    this.#byId = byIdNow;

    // Exits first, then enters. Both orders are deterministic: exits by collider id (creation order, the best a
    // collider that is gone still has), enters in draw order (the list's order).
    if (ended) {
      const idOf = (c: Collider): number => this.#ids.get(c) ?? 0;
      const ordered = ended
        .map(([a, b]) => (idOf(a) <= idOf(b) ? ([a, b] as const) : ([b, a] as const)))
        .sort((x, y) => idOf(x[0]) - idOf(y[0]) || idOf(x[1]) - idOf(y[1]));
      for (const [a, b] of ordered) world.reportCollisionExit(a, b);
    }

    // In draw order (the list's order), earlier collider first, so reports are deterministic whatever the sweep found
    // first. The colliders are read out before any callback runs, since a callback may add colliders of its own.
    started.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const pairs = started.map(([p, q]) => [boxColliders[p] as Collider, boxColliders[q] as Collider] as const);
    for (const [a, b] of pairs) world.reportCollision(a, b);
    return pairs.length;
  }

  /**
   * Ids are never reused while they are in use, so a game that keeps creating colliders keeps handing out bigger
   * ones. Now and then, give this frame's colliders fresh ids from 0 and carry last frame's contacts between them
   * over; a contact with a collider that is not in this frame is reported as ended, with the next exits.
   */
  #renumber(colliders: readonly ColliderEntry[]): void {
    const before = this.#byId;
    const ids = new WeakMap<Collider, number>();
    const renamed = new Map<number, number>();
    let next = 0;
    for (const { collider } of colliders) {
      if (ids.has(collider)) continue;
      const id = next++;
      ids.set(collider, id);
      const old = this.#ids.get(collider);
      if (old !== undefined) renamed.set(old, id);
    }
    // A contact with a collider that is not in this frame ended, as `update` would find; `#lost` keeps it for its exit.
    const touching = new Set<number | string>();
    for (const key of this.#touching) {
      const [oldLow, oldHigh] = pairOf(key);
      const low = renamed.get(oldLow);
      const high = renamed.get(oldHigh);
      if (low !== undefined && high !== undefined) {
        touching.add(low < high ? pairKey(low, high) : pairKey(high, low));
      } else {
        const a = before.get(oldLow);
        const b = before.get(oldHigh);
        if (a && b) (this.#lost ??= []).push([a, b]);
      }
    }
    // Last frame's colliders under their new ids; `update` fills it in again for this frame straight after.
    this.#byId = new ById();
    for (const [old, id] of renamed) {
      const collider = before.get(old);
      if (collider) this.#byId.set(id, collider);
    }
    this.#ids = ids;
    this.#nextId = next;
    this.#touching = touching;
    this.#now.clear();
  }

  #id(collider: Collider): number {
    let id = this.#ids.get(collider);
    if (id === undefined) {
      id = this.#nextId++;
      this.#ids.set(collider, id);
    }
    return id;
  }
}
