import { geometriesOverlap, geometryOf, type Collider, type GameObject, type World, type WorldTransform } from "@tsengine/runtime";

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

/**
 * Whether two colliders whose boxes overlap touch by their shapes (`Collider.shape`): two plain boxes always do (their boxes are
 * what they are), and a pair in which either has another shape is tested exactly, turned and scaled with its object.
 */
function shapesTouch(a: Collider, worldA: WorldTransform, b: Collider, worldB: WorldTransform): boolean {
  if (a.shape === "box" && b.shape === "box") return true;
  const ga = geometryOf(a, worldA);
  const gb = geometryOf(b, worldB);
  return ga !== null && gb !== null && geometriesOverlap(ga, gb);
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
 * Put `order[0 .. count)` in the order the sweep wants: boxes by `minX`, ties by index (so draw order). `ordered` is how many
 * entries of it are a permutation left by an earlier call; when that is `count`, it is last frame's order, and boxes barely
 * move between frames, so an insertion sort over it is close to linear (a comparator sort cost 1.6 ms for 2,000 colliders
 * under QuickJS, this 0.4 ms). The order is total (no NaN gets here), so both ways give the same answer; after too many
 * shifts, which a teleport or a shuffled list causes, it hands over to `sort`.
 */
function sortByLeftEdge(order: Int32Array, ordered: number, count: number, bounds: Float64Array): void {
  if (ordered !== count) for (let i = 0; i < count; i++) order[i] = i;
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
        order.subarray(0, count).sort((p, q) => (bounds[p * 4] as number) - (bounds[q * 4] as number) || p - q);
        return;
      }
    }
    order[j + 1] = v;
  }
}

/**
 * A host's own broad phase (`Backend.overlaps`, which is `tse_overlaps` in `libtse`): the pairs of boxes in
 * `boxes[0 .. count * 4)` that overlap, written to `pairs` two indices each, as many as fit; returns how many there are.
 * `order[0 .. count)` comes back as the box indices by left edge, ties by index, and may hold anything going in.
 */
export type Overlaps = (boxes: Float64Array, count: number, order: Int32Array, pairs: Int32Array) => number;

/** The most bands the sweep is cut into (see `CollisionTracker.update`); past it the bands get taller instead. */
const BAND_LIMIT = 1024;
/** A band is this many times the mean height of a box: taller and each band tests more pairs, shorter and more boxes are in two bands. */
const BAND_HEIGHT = 2;
/** The plain sweep hands over to bands when it tested more than this many pairs per box (a band costs about five tests' time per box to set up). */
const BAND_ENTER = 8;
/** Bands are kept while they save at least this many tests per box. */
const BAND_KEEP = 5;
/** How many banded frames pass between checks that the bands still pay, and how long the plain sweep is kept after they did not (doubling up to `BAND_HOLD_LIMIT`). */
const BAND_PROBE = 64;
const BAND_HOLD_LIMIT = 4096;

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
 * Cost: a sweep over x (see `update`), so only boxes that overlap in x are compared. That alone tests every box against
 * the others in its column, however far apart in y (22 for each box in a square of 2,000), so when a sweep has tested many
 * pairs for each box the next ones first deal the boxes into horizontal bands and sweep each band on its own. Boxes in a
 * row or in a pile gain nothing from bands and are swept as one. A host that can find the overlapping boxes itself
 * (`Backend.overlaps`; both native hosts) is asked instead, and only the rules for each pair run in script. Measured: see
 * `packages/player/bench/frame.ts`, and the numbers in `docs/PLAYER.md`.
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
  /** Each box's world transform, by box index: what a shaped collider's exact test needs. */
  readonly #worlds: WorldTransform[] = [];
  /** The boxes by left edge (see `sortByLeftEdge`), and how many entries of it are in order: last full sweep's count, or 0. */
  #order = new Int32Array(64);
  #ordered = 0;
  /** The pairs of boxes the host's broad phase found, two indices each. */
  #pairs = new Int32Array(128);
  /**
   * The pairs of boxes this full sweep accepted (they overlap and the rules let them collide), two box indices each, in the
   * order they were found; and last full sweep's, to compare with. When the colliders are last frame's box for box and the
   * pairs are the same in the same order, the contacts are exactly `#touching`, and the sweep skips the `Set` work for each
   * pair, which is most of what a pile costs (44,850 pairs: about 15 ms of 25 under QuickJS). `#acceptedValid` is whether
   * `#touching` is still what that last sweep left (an incremental frame that changed it, or a renumbering, clears it).
   */
  #accepted = new Int32Array(128);
  #lastAccepted = new Int32Array(128);
  #lastAcceptedLength = -1;
  #acceptedValid = false;
  readonly #overlaps: Overlaps | undefined;

  // The sweep in bands (see `update`). `#banded` is whether the next full sweep makes them.
  readonly #bands: boolean | "always";
  #banded: boolean;
  #bandHold = 0;
  #bandPenalty = BAND_PROBE;
  #sinceProbe = 0;
  #bandedFrames = 0;
  /** Each box's first and last band, the boxes of each band one after another (by left edge), and where each band starts in that. */
  #bandFirst = new Int32Array(256);
  #bandLast = new Int32Array(256);
  #bandSlots = new Int32Array(512);
  #bandStarts = new Int32Array(65);
  #bandFill = new Int32Array(64);
  readonly #whole = new Int32Array(2);

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

  #reported = 0;

  /** How many contacts the last `update` reported, started and ended: when it is 0, no callback ran. */
  get reported(): number {
    return this.#reported;
  }

  /** How many frames were handled by looking only at what moved (for tests and benchmarks). */
  get incrementalFrames(): number {
    return this.#incrementalFrames;
  }

  /** How many full sweeps ran in bands (for tests and benchmarks). */
  get bandedFrames(): number {
    return this.#bandedFrames;
  }

  /**
   * `compactAt` is for tests: renumber ids once they reach it (default 2^15, the most that make int32 pair keys).
   * `incremental` false always takes the full sweep, which is what the incremental frames are tested against.
   * `bands` false never cuts the sweep into bands, and `"always"` does whenever two or more can be made, which is how the
   * banded sweep is tested against the plain one; the default decides by what the last sweeps cost.
   * `overlaps` is the host's broad phase, when it has one (`Backend.overlaps`): the full sweep then asks it which boxes
   * overlap instead of sweeping in script, and `bands` is not used.
   */
  constructor(compactAt: number = SMALL_ID, incremental = true, bands: boolean | "always" = true, overlaps?: Overlaps) {
    this.#compactAt = Math.min(compactAt, SMALL_ID);
    this.#incremental = incremental;
    this.#bands = bands;
    this.#banded = bands === "always";
    this.#overlaps = overlaps;
  }

  /** Compare this frame's colliders with last frame's contacts and report new contacts and ended ones. Returns how many contacts started (exits are not counted). */
  update(world: World, colliders: readonly ColliderEntry[]): number {
    this.#reported = 0;
    // Keep ids small, so pair keys stay int32. Only when it pays: not every frame when there are simply that many colliders.
    const renumber = this.#nextId + colliders.length > this.#compactAt && this.#nextId > 2 * colliders.length;
    if (!renumber && this.#incremental) {
      const done = this.#updateMoved(world, colliders);
      if (done >= 0) return done;
    }
    if (renumber) this.#renumber(colliders);

    const total = colliders.length;
    if (this.#bounds.length < total * 4) this.#bounds = new Float64Array(total * 8);
    const bounds = this.#bounds;
    const boxColliders = this.#colliders;
    const ids = this.#boxIds;
    const layers = this.#layers;
    const hitsOf = this.#hits;
    const worlds = this.#worlds;
    const byIdNow = this.#byIdNow;
    const overlaps = this.#overlaps;
    const banded = overlaps === undefined && this.#banded;
    const HIGH = Infinity; // a local: QuickJS looks a global up by name each time
    const LOW = -Infinity;
    let top = HIGH; // the boxes' range in y and their heights, for the bands
    let bottom = LOW;
    let heights = 0;
    let count = 0;
    // While this frame's boxes are last frame's colliders, box for box (a steady scene, moving or not), their ids and
    // `#byId` are already right and are left alone.
    let stable = true;
    for (let i = 0; i < total; i++) {
      const entry = colliders[i] as ColliderEntry;
      const collider = entry.collider;
      const transform = entry.world;
      const width = collider.width;
      const height = collider.height;
      const at = count * 4;
      let minY: number;
      let maxY: number;
      if (transform.rotation === 0 && width > 0 && height > 0) {
        // `writeBounds` for an upright box (nearly all of them), without its calls: this runs for every collider.
        const x = transform.x;
        const y = transform.y;
        const x2 = x + width * transform.scaleX;
        const y2 = y + height * transform.scaleY;
        let minX: number;
        let maxX: number;
        if (x < x2) {
          minX = x;
          maxX = x2;
        } else {
          minX = x2;
          maxX = x;
        }
        if (y < y2) {
          minY = y;
          maxY = y2;
        } else {
          minY = y2;
          maxY = y;
        }
        // Finite, with an area. (A NaN lands in one of the pair and fails its comparison.)
        if (!(minX > LOW && maxX < HIGH && maxX > minX && minY > LOW && maxY < HIGH && maxY > minY)) continue;
        bounds[at] = minX;
        bounds[at + 1] = minY;
        bounds[at + 2] = maxX;
        bounds[at + 3] = maxY;
      } else {
        if (!writeBounds(width, height, transform, bounds, at)) continue;
        minY = bounds[at + 1] as number;
        maxY = bounds[at + 3] as number;
      }
      if (stable && boxColliders[count] !== collider) {
        // From here on the list is not last frame's: this frame's colliders by id are collected, starting with those passed.
        stable = false;
        byIdNow.clear();
        for (let k = 0; k < count; k++) byIdNow.set(ids[k] as number, boxColliders[k] as Collider);
      }
      if (!stable) {
        // The same collider at the same index as last frame keeps its id: no `WeakMap` lookup.
        const id = boxColliders[count] === collider ? (ids[count] as number) : this.#id(collider);
        boxColliders[count] = collider;
        ids[count] = id;
        byIdNow.set(id, collider);
      }
      layers[count] = collider.layer;
      hitsOf[count] = collider.hits;
      worlds[count] = transform;
      if (banded) {
        if (minY < top) top = minY;
        if (maxY > bottom) bottom = maxY;
        heights += maxY - minY;
      }
      count++;
    }
    if (stable && boxColliders.length !== count) {
      // Last frame's colliders, less some at the end.
      stable = false;
      byIdNow.clear();
      for (let k = 0; k < count; k++) byIdNow.set(ids[k] as number, boxColliders[k] as Collider);
    }
    boxColliders.length = count;
    ids.length = count;
    layers.length = count;
    hitsOf.length = count;
    worlds.length = count;

    if (this.#order.length < count) {
      this.#order = new Int32Array(count * 2);
      this.#ordered = 0;
    }
    const order = this.#order;
    const now = this.#now;
    const touching = this.#touching;
    const started: [number, number][] = [];
    let kept = 0; // pairs that touched last frame and still do
    // This sweep's pairs go into `accepted`, compared on the way with last sweep's (see `#accepted`).
    let accepted = this.#accepted;
    const last = this.#lastAccepted;
    const lastLength = this.#lastAcceptedLength;
    let same = stable && this.#acceptedValid;
    if (!same) now.clear();
    let n = 0;
    let done = 0; // pairs before this one were found while they matched last sweep's, and are filed below if they turn out not to
    // What the rules need of a box is read when the first other box overlaps it: in a spread-out scene most boxes touch nothing.
    let idP = -1;
    let parent: GameObject | null = null;
    let layerP = "";
    let hitsP: readonly string[] | undefined;
    if (overlaps !== undefined) {
      // The host finds the boxes that overlap (`Backend.overlaps`: the sweep below, compiled), and puts `order` right on the way.
      let pairs = this.#pairs;
      let found = overlaps(bounds, count, order, pairs);
      if (found * 2 > pairs.length) {
        pairs = this.#pairs = new Int32Array(found * 3);
        found = overlaps(bounds, count, order, pairs);
      }
      const filled = Math.min(found * 2, pairs.length);
      if (accepted.length < filled) accepted = this.#accepted = new Int32Array(filled * 2);
      // The rules for each pair, as in the sweep below. A box's pairs come one after another.
      let lastP = -1;
      for (let k = 0; k < filled; k += 2) {
        const p = pairs[k] as number;
        const q = pairs[k + 1] as number;
        if (p !== lastP) {
          lastP = p;
          idP = ids[p] as number;
          parent = (boxColliders[p] as Collider).parent;
          layerP = layers[p] as string;
          hitsP = hitsOf[p];
        }
        const other = boxColliders[q] as Collider;
        if (parent === other.parent) continue;
        const hitsQ = hitsOf[q];
        if ((hitsP !== undefined && !hitsP.includes(layers[q] as string)) || (hitsQ !== undefined && !hitsQ.includes(layerP))) continue;
        if (
          ((boxColliders[p] as Collider).shape !== "box" || other.shape !== "box") &&
          !shapesTouch(boxColliders[p] as Collider, worlds[p] as WorldTransform, other, worlds[q] as WorldTransform)
        )
          continue;
        if (same && (n >= lastLength || last[n] !== p || last[n + 1] !== q)) {
          same = false;
          now.clear();
          done = n;
        }
        accepted[n] = p;
        accepted[n + 1] = q;
        n += 2;
        if (!same) {
          const idQ = ids[q] as number;
          const key = idP < idQ ? pairKey(idP, idQ) : pairKey(idQ, idP);
          now.add(key);
          if (touching.has(key)) kept++;
          else started.push(p < q ? [p, q] : [q, p]);
        }
      }
    } else {
      // Sweep over x: with the boxes sorted by their left edge, a box can only touch the ones after it that start
      // before it ends, so each inner loop stops at the first box that starts past `maxX`. Those boxes overlap in x
      // by construction, so only y is left to test. (Ties in `minX` keep draw order.)
      sortByLeftEdge(order, this.#ordered, count, bounds);

      // That sweep tests every pair of boxes that overlap in x, wherever they are in y: 22 for each box in a square of
      // 2,000, none of them touching. So when the last sweep tested many pairs for each box, the boxes are first dealt
      // into horizontal bands and each band is swept on its own. A box is in every band it reaches into, and a pair that
      // shares several bands is taken in the first of them only.
      let list: ArrayLike<number> = order;
      let starts: ArrayLike<number> = this.#whole;
      let bands = banded ? this.#makeBands(count, top, bottom, heights) : 1;
      if (bands > 1) {
        list = this.#bandSlots;
        starts = this.#bandStarts;
        this.#bandedFrames++;
      } else {
        bands = 1;
        this.#whole[1] = count;
      }
      const firstBand = this.#bandFirst;
      let tests = 0; // pairs of boxes looked at
      for (let band = 0; band < bands; band++) {
        const end = starts[band + 1] as number;
        for (let s = starts[band] as number; s < end; s++) {
          const p = list[s] as number;
          const minY = bounds[p * 4 + 1] as number;
          const maxX = bounds[p * 4 + 2] as number;
          const maxY = bounds[p * 4 + 3] as number;
          idP = -1;
          let t = s + 1;
          for (; t < end; t++) {
            const q = list[t] as number;
            if ((bounds[q * 4] as number) >= maxX) break;
            if (!(minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))) continue;
            if (bands > 1) {
              // Both are in this band; the first band both are in is where the later of the two starts.
              const firstP = firstBand[p] as number;
              const firstQ = firstBand[q] as number;
              if ((firstP > firstQ ? firstP : firstQ) !== band) continue;
            }
            if (idP < 0) {
              idP = ids[p] as number;
              parent = (boxColliders[p] as Collider).parent;
              layerP = layers[p] as string;
              hitsP = hitsOf[p];
            }
            const other = boxColliders[q] as Collider;
            if (parent === other.parent) continue;
            const hitsQ = hitsOf[q];
            if ((hitsP !== undefined && !hitsP.includes(layers[q] as string)) || (hitsQ !== undefined && !hitsQ.includes(layerP))) continue;
            if (
              ((boxColliders[p] as Collider).shape !== "box" || other.shape !== "box") &&
              !shapesTouch(boxColliders[p] as Collider, worlds[p] as WorldTransform, other, worlds[q] as WorldTransform)
            )
              continue;
            if (same && (n >= lastLength || last[n] !== p || last[n + 1] !== q)) {
              same = false;
              now.clear();
              done = n;
            }
            if (n + 2 > accepted.length) {
              const grown = new Int32Array(accepted.length * 2);
              grown.set(accepted);
              accepted = this.#accepted = grown;
            }
            accepted[n] = p;
            accepted[n + 1] = q;
            n += 2;
            if (!same) {
              const idQ = ids[q] as number;
              const key = idP < idQ ? pairKey(idP, idQ) : pairKey(idQ, idP);
              now.add(key);
              if (touching.has(key)) kept++;
              else started.push(p < q ? [p, q] : [q, p]);
            }
          }
          tests += t - s - 1;
        }
      }
      if (this.#bands === true) this.#chooseSweep(count, bands > 1, tests);
    }
    this.#ordered = count;
    this.#accepted = last;
    this.#lastAccepted = accepted;
    this.#lastAcceptedLength = n;
    this.#acceptedValid = true;

    let ended: Pair[] | undefined = this.#lost;
    this.#lost = undefined;
    if (!(same && n === lastLength)) {
      // The contacts changed. The pairs after the first difference were filed as they were found; file those before it
      // (all of them, when the only difference is that last sweep had more), then find which ended.
      if (same) {
        now.clear();
        done = n;
      }
      for (let k = 0; k < done; k += 2) {
        const p = accepted[k] as number;
        const q = accepted[k + 1] as number;
        const idP = ids[p] as number;
        const idQ = ids[q] as number;
        const key = idP < idQ ? pairKey(idP, idQ) : pairKey(idQ, idP);
        now.add(key);
        if (touching.has(key)) kept++;
        else started.push(p < q ? [p, q] : [q, p]);
      }
      // Pairs that touched last frame and do not now. Collected before the swap; reported below, ahead of the enters.
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
    }
    if (!stable) {
      this.#byIdNow = this.#byId;
      this.#byId = byIdNow;
    }

    if (this.#incremental) {
      this.#last = colliders.slice();
      this.#aligned = count === colliders.length ? count : -1;
      this.#maxWidth = -1;
    }
    return this.#report(world, ended, started);
  }

  /**
   * Deal the boxes into horizontal bands for the sweep: `#bandSlots[#bandStarts[b] .. #bandStarts[b + 1])` are the boxes that
   * reach into band `b`, by left edge (they are dealt in the order of `#order`), and `#bandFirst` is each box's first band.
   * Returns how many bands, or 1 when the boxes do not spread over two.
   *
   * A band is `BAND_HEIGHT` times the mean height of a box, so boxes are in one or two bands unless they are far taller than
   * most, and all the entries together are at most a few times the boxes. Two boxes that overlap in y share a band: a
   * point's band never decreases as y grows, so each box's first band is at most the other's last.
   */
  #makeBands(count: number, top: number, bottom: number, heights: number): number {
    const range = bottom - top;
    let height = (heights / count) * BAND_HEIGHT;
    if (!(range < Infinity && height > 0 && range >= height)) return 1;
    let bands = Math.floor(range / height) + 1;
    if (bands > BAND_LIMIT) {
      bands = BAND_LIMIT;
      height = range / bands;
    }
    const inverse = 1 / height;
    const lastBand = bands - 1;
    if (this.#bandFirst.length < count) {
      this.#bandFirst = new Int32Array(count * 2);
      this.#bandLast = new Int32Array(count * 2);
    }
    if (this.#bandFill.length < bands) {
      this.#bandFill = new Int32Array(bands);
      this.#bandStarts = new Int32Array(bands + 1);
    }
    const bounds = this.#bounds;
    const first = this.#bandFirst;
    const last = this.#bandLast;
    const fill = this.#bandFill;
    const starts = this.#bandStarts;
    for (let b = 0; b < bands; b++) fill[b] = 0;
    let entries = 0;
    for (let i = 0; i < count; i++) {
      let a = (((bounds[i * 4 + 1] as number) - top) * inverse) | 0;
      let b = (((bounds[i * 4 + 3] as number) - top) * inverse) | 0;
      if (a > lastBand) a = lastBand;
      if (b > lastBand) b = lastBand;
      first[i] = a;
      last[i] = b;
      if (a === b) fill[a] = (fill[a] as number) + 1;
      else for (let k = a; k <= b; k++) fill[k] = (fill[k] as number) + 1;
      entries += b - a + 1;
    }
    let at = 0;
    for (let b = 0; b < bands; b++) {
      const size = fill[b] as number;
      starts[b] = at;
      fill[b] = at;
      at += size;
    }
    starts[bands] = at;
    if (this.#bandSlots.length < entries) this.#bandSlots = new Int32Array(entries * 2);
    const slots = this.#bandSlots;
    const order = this.#order;
    for (let s = 0; s < count; s++) {
      const p = order[s] as number;
      const a = first[p] as number;
      const b = last[p] as number;
      if (a === b) {
        const slot = fill[a] as number;
        slots[slot] = p;
        fill[a] = slot + 1;
      } else {
        for (let k = a; k <= b; k++) {
          const slot = fill[k] as number;
          slots[slot] = p;
          fill[k] = slot + 1;
        }
      }
    }
    return bands;
  }

  /**
   * Whether the next full sweep runs in bands, from what this one cost. The plain sweep counts the pairs it tested, and
   * hands over when that is many for each box. Bands are checked now and then against an estimate of what the plain sweep
   * would have tested, and dropped when they save little (boxes in a row, in a pile, or with one far away that stretches the
   * bands until all the others share one); the plain sweep is then kept for a while, longer each time.
   */
  #chooseSweep(count: number, wasBanded: boolean, tests: number): void {
    if (wasBanded) {
      if (++this.#sinceProbe < BAND_PROBE) return;
      this.#sinceProbe = 0;
      if (this.#plainTests(count) - tests >= count * BAND_KEEP) {
        this.#bandPenalty = BAND_PROBE;
        return;
      }
      this.#banded = false;
      this.#bandHold = this.#bandPenalty;
      this.#bandPenalty = Math.min(this.#bandPenalty * 2, BAND_HOLD_LIMIT);
    } else if (this.#banded) {
      // Bands were wanted and the boxes did not spread over two.
      this.#banded = false;
      this.#bandHold = BAND_PROBE;
    } else if (this.#bandHold > 0) this.#bandHold--;
    else if (tests > count * BAND_ENTER) {
      this.#banded = true;
      this.#sinceProbe = 0;
    }
  }

  /** About how many pairs the plain sweep would test: for each box, the boxes after it that start within a mean width of its left edge (exact when all are as wide). */
  #plainTests(count: number): number {
    const bounds = this.#bounds;
    const order = this.#order;
    let widths = 0;
    for (let i = 0; i < count; i++) widths += (bounds[i * 4 + 2] as number) - (bounds[i * 4] as number);
    const width = widths / count;
    let tests = 0;
    let t = 0;
    for (let s = 0; s < count; s++) {
      const reach = (bounds[(order[s] as number) * 4] as number) + width;
      if (t <= s) t = s + 1;
      while (t < count && (bounds[(order[t] as number) * 4] as number) < reach) t++;
      tests += t - s - 1;
    }
    return tests;
  }

  /**
   * Report the pairs that ended and the pairs that started. Both orders are deterministic: exits by collider id (creation
   * order, the best a collider that is gone still has), enters in draw order (the list's order, which is the box index).
   */
  #report(world: World, ended: Pair[] | undefined, started: [number, number][]): number {
    this.#reported = (ended?.length ?? 0) + started.length;
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
    this.#acceptedValid = false; // the contacts this frame finds are no longer last full sweep's
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
        if (
          q === m ||
          !((bounds[q * 4 + 2] as number) > minX && minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))
        )
          continue;
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
    sortByLeftEdge(order, this.#ordered, count, bounds);

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
        if (!((bounds[q * 4 + 2] as number) > minX && minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number)))
          continue;
        if (parent === (boxColliders[q] as Collider).parent) continue;
        const hitsQ = hitsOf[q];
        if ((hitsM !== undefined && !hitsM.includes(layers[q] as string)) || (hitsQ !== undefined && !hitsQ.includes(layerM))) continue;
        const self = boxColliders[m] as Collider;
        const other = boxColliders[q] as Collider;
        if (
          (self.shape !== "box" || other.shape !== "box") &&
          !shapesTouch(self, (colliders[m] as ColliderEntry).world, other, (colliders[q] as ColliderEntry).world)
        )
          continue;
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
    this.#acceptedValid = false; // a safeguard: renumbering also empties `#colliders`, so the next sweep is not `stable` anyway
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
