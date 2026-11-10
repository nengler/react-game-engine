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

/**
 * Put `order` in the order the sweep wants: boxes by `minX`, ties by index (so draw order). `order` is last frame's, when it
 * is a permutation of the same size, and boxes barely move between frames, so an insertion sort over it is close to linear
 * (a comparator sort cost 1.6 ms for 2,000 colliders under QuickJS, this 0.4 ms). The order is total (no NaN gets here), so
 * both ways give the same answer; after too many shifts, which a teleport or a shuffled list causes, it hands over to `sort`.
 */
function sortByLeftEdge(order: number[], count: number, bounds: Float64Array): void {
  if (order.length !== count) {
    order.length = count;
    for (let i = 0; i < count; i++) order[i] = i;
  }
  let budget = count * 8;
  for (let i = 1; i < count; i++) {
    const v = order[i] as number;
    const key = bounds[v * 4] as number;
    let j = i - 1;
    while (j >= 0) {
      const w = order[j] as number;
      const left = bounds[w * 4] as number;
      if (left < key || (left === key && w < v)) break;
      order[j + 1] = w;
      j--;
      if (--budget < 0) {
        order[j + 1] = v; // the array is still a permutation: finish with the general sort
        order.sort((p, q) => (bounds[p * 4] as number) - (bounds[q * 4] as number) || p - q);
        return;
      }
    }
    order[j + 1] = v;
  }
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
 *
 * **Only what moved is looked at again.** An entry that is the same object as the one for that collider last frame is
 * taken to be unchanged: the frame builder reuses the entry of a collider in a subtree it reused (see `FrameBuilder`), and
 * makes a new one otherwise. So when a frame's list is the same colliders in the same order and only a few entries are new,
 * the pairs between colliders that did not change cannot have changed either, and only the new ones are tested, against a
 * list kept sorted by left edge from frame to frame. Any other frame (a collider added, removed or without an area, or
 * more than an eighth of them moved) takes the full sweep, which gives the same reports in the same order. An entry must
 * therefore not be changed after it is handed over: make a new one.
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

  readonly #incremental: boolean;
  /** Last frame's entries (a copy of the list), to find which are new this frame; null when there is nothing to compare with. */
  #last: ColliderEntry[] | null = null;
  /** How many boxes last frame had, when that was every entry (so box index is list index); -1 when some entry had no area. */
  #aligned = -1;
  /** The widest box, which bounds how far left of a box another can start and still reach it; -1 until the first incremental frame needs it. */
  #maxWidth = -1;
  readonly #moved: number[] = [];
  #fresh = new Float64Array(64);
  #incrementalFrames = 0;

  /** How many frames were handled by looking only at what moved (for tests and benchmarks). */
  get incrementalFrames(): number {
    return this.#incrementalFrames;
  }

  /**
   * `compactAt` is for tests: renumber ids once they reach it (default 2^15, the most that make int32 pair keys).
   * `incremental` false always takes the full sweep, which is what the incremental frames are tested against.
   */
  constructor(compactAt: number = SMALL_ID, incremental = true) {
    this.#compactAt = Math.min(compactAt, SMALL_ID);
    this.#incremental = incremental;
  }

  /** Compare this frame's colliders with last frame's contacts and report new contacts and ended ones. Returns how many contacts started (exits are not counted). */
  update(world: World, colliders: readonly ColliderEntry[]): number {
    // Keep ids small, so pair keys stay int32. Only when it pays: not every frame when there are simply that many colliders.
    const renumber = this.#nextId + colliders.length > this.#compactAt && this.#nextId > 2 * colliders.length;
    if (!renumber && this.#incremental) {
      const done = this.#updateMoved(world, colliders);
      if (done >= 0) return done;
    }
    if (renumber) this.#renumber(colliders);

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
      // The same collider at the same index as last frame (a steady scene) keeps its id: no `WeakMap` lookup.
      const id = boxColliders[count] === collider ? (ids[count] as number) : this.#id(collider);
      boxColliders[count] = collider;
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
    sortByLeftEdge(order, count, bounds);

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

    if (this.#incremental) {
      this.#last = colliders.slice();
      this.#aligned = count === colliders.length ? count : -1;
      this.#maxWidth = -1;
    }
    return this.#report(world, ended, started);
  }

  /**
   * Report the pairs that ended and the pairs that started. Both orders are deterministic: exits by collider id (creation
   * order, the best a collider that is gone still has), enters in draw order (the list's order, which is the box index).
   */
  #report(world: World, ended: Pair[] | undefined, started: [number, number][]): number {
    if (ended) {
      const idOf = (c: Collider): number => this.#ids.get(c) ?? 0;
      const ordered = ended
        .map(([a, b]) => (idOf(a) <= idOf(b) ? ([a, b] as const) : ([b, a] as const)))
        .sort((x, y) => idOf(x[0]) - idOf(y[0]) || idOf(x[1]) - idOf(y[1]));
      for (const [a, b] of ordered) world.reportCollisionExit(a, b);
    }

    // In draw order (the list's order), earlier collider first, so reports are deterministic whatever the sweep found
    // first. The colliders are read out before any callback runs, since a callback may add colliders of its own.
    const boxColliders = this.#colliders;
    started.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const pairs = started.map(([p, q]) => [boxColliders[p] as Collider, boxColliders[q] as Collider] as const);
    for (const [a, b] of pairs) world.reportCollision(a, b);
    return pairs.length;
  }

  /**
   * The frame when the list is last frame's colliders in last frame's order and few of the entries are new: test only the
   * colliders whose entries are new. Returns how many contacts started, or -1, having changed nothing, when this is not such
   * a frame (the caller takes the full sweep).
   *
   * Every pair that does not involve a new entry is exactly as it was: the same two boxes, layers and parents. So a new
   * entry's old contacts are found by looking at its old box in last frame's list (before anything is updated), and its new
   * ones by looking at its new box in the updated list; the difference is its exits and enters. A pair of two new entries is
   * dealt with from the lower index only.
   */
  #updateMoved(world: World, colliders: readonly ColliderEntry[]): number {
    const last = this.#last;
    const count = colliders.length;
    if (last === null || this.#aligned !== count || last.length !== count || this.#lost !== undefined) return -1;
    const moved = this.#moved;
    moved.length = 0;
    const limit = count >> 3;
    for (let i = 0; i < count; i++) {
      const entry = colliders[i] as ColliderEntry;
      const before = last[i] as ColliderEntry;
      if (entry === before) continue;
      // A different collider in this place, or too many new entries to be worth it: the full sweep.
      if (entry.collider !== before.collider || moved.length >= limit) return -1;
      moved.push(i);
    }
    const total = moved.length;
    if (total === 0) {
      this.#incrementalFrames++;
      return 0; // nothing changed: the contacts are as they were, and nothing starts or ends
    }
    // The new boxes, worked out first: a collider that lost its area leaves the list, which is the full sweep's business.
    if (this.#fresh.length < total * 4) this.#fresh = new Float64Array(total * 8);
    const fresh = this.#fresh;
    for (let k = 0; k < total; k++) {
      const entry = colliders[moved[k] as number] as ColliderEntry;
      if (!writeBounds(entry.collider.width, entry.collider.height, entry.world, fresh, k * 4)) return -1;
    }

    const bounds = this.#bounds;
    const order = this.#order;
    const ids = this.#boxIds;
    const layers = this.#layers;
    const hitsOf = this.#hits;
    const boxColliders = this.#colliders;
    const touching = this.#touching;
    let maxWidth = this.#maxWidth;
    if (maxWidth < 0) {
      maxWidth = 0;
      for (let i = 0; i < count; i++) {
        const width = (bounds[i * 4 + 2] as number) - (bounds[i * 4] as number);
        if (width > maxWidth) maxWidth = width;
      }
    }
    // The first place in `order` a box that reaches `minX` can start: nothing to its left is wider than `maxWidth`.
    const firstReaching = (minX: number): number => {
      const from = minX - maxWidth;
      let lo = 0;
      let hi = count;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((bounds[(order[mid] as number) * 4] as number) <= from) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    // Old contacts of each new entry: the boxes its old box overlaps that it was touching.
    const oldFlat: number[] = [];
    const oldAt: number[] = [];
    for (let k = 0; k < total; k++) {
      const m = moved[k] as number;
      oldAt.push(oldFlat.length);
      const minX = bounds[m * 4] as number;
      const minY = bounds[m * 4 + 1] as number;
      const maxX = bounds[m * 4 + 2] as number;
      const maxY = bounds[m * 4 + 3] as number;
      const idM = ids[m] as number;
      for (let s = firstReaching(minX); s < count; s++) {
        const q = order[s] as number;
        if ((bounds[q * 4] as number) >= maxX) break;
        if (q === m || !((bounds[q * 4 + 2] as number) > minX && minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))) continue;
        const idQ = ids[q] as number;
        if (touching.has(idM < idQ ? pairKey(idM, idQ) : pairKey(idQ, idM))) oldFlat.push(q);
      }
    }
    oldAt.push(oldFlat.length);

    // Now the new boxes go in, and the order is put right (boxes barely move, so this is close to linear).
    const isMoved = new Uint8Array(count);
    for (let k = 0; k < total; k++) {
      const m = moved[k] as number;
      isMoved[m] = 1;
      for (let j = 0; j < 4; j++) bounds[m * 4 + j] = fresh[k * 4 + j] as number;
      const collider = boxColliders[m] as Collider;
      layers[m] = collider.layer;
      hitsOf[m] = collider.hits;
      const width = (fresh[k * 4 + 2] as number) - (fresh[k * 4] as number);
      if (width > maxWidth) maxWidth = width;
    }
    this.#maxWidth = maxWidth;
    sortByLeftEdge(order, count, bounds);

    // New contacts of each, against the rules, and the difference from the old ones.
    const started: [number, number][] = [];
    let ended: Pair[] | undefined;
    for (let k = 0; k < total; k++) {
      const m = moved[k] as number;
      const minX = bounds[m * 4] as number;
      const minY = bounds[m * 4 + 1] as number;
      const maxX = bounds[m * 4 + 2] as number;
      const maxY = bounds[m * 4 + 3] as number;
      const idM = ids[m] as number;
      const parent = (boxColliders[m] as Collider).parent;
      const layerM = layers[m] as string;
      const hitsM = hitsOf[m];
      const now: number[] = [];
      for (let s = firstReaching(minX); s < count; s++) {
        const q = order[s] as number;
        if ((bounds[q * 4] as number) >= maxX) break;
        if (q === m || (isMoved[q] === 1 && q < m)) continue;
        if (!((bounds[q * 4 + 2] as number) > minX && minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))) continue;
        if (parent === (boxColliders[q] as Collider).parent) continue;
        const hitsQ = hitsOf[q];
        if ((hitsM !== undefined && !hitsM.includes(layers[q] as string)) || (hitsQ !== undefined && !hitsQ.includes(layerM))) continue;
        now.push(q);
      }
      const before = oldFlat.slice(oldAt[k] as number, oldAt[k + 1] as number);
      for (const q of now) {
        if (before.includes(q)) continue;
        const idQ = ids[q] as number;
        touching.add(idM < idQ ? pairKey(idM, idQ) : pairKey(idQ, idM));
        started.push(m < q ? [m, q] : [q, m]);
      }
      for (const q of before) {
        if (isMoved[q] === 1 && q < m) continue; // dealt with from q
        if (now.includes(q)) continue;
        const idQ = ids[q] as number;
        touching.delete(idM < idQ ? pairKey(idM, idQ) : pairKey(idQ, idM));
        (ended ??= []).push([boxColliders[m] as Collider, boxColliders[q] as Collider]);
      }
    }
    this.#last = colliders.slice();
    this.#incrementalFrames++;
    return this.#report(world, ended, started);
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
    this.#colliders.length = 0; // `update` reuses ids by index; these are new
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
