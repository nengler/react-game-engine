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
 * Finds the moment two colliders start touching and reports it with `world.reportCollision(a, b)`: the
 * collider's own `onCollisionEnter` is called with the other collider, on both sides. It is *enter* only: a
 * pair that keeps overlapping is not reported again, and a pair that separates and touches again is.
 *
 * Call `update` once per frame with the colliders the frame's tree walk found (`BuiltFrame.colliders`); the
 * player does. A pair is forgotten as soon as it is not overlapping in a frame, which includes a collider
 * leaving the world (it is no longer in the list), so one that comes back already touching is a new contact.
 *
 * **Colliders with the same parent never collide with each other**, so a component with several colliders (a
 * hitbox and a shield) does not hit itself. Everything else does.
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
  // Reused between frames: this frame's boxes (minX, minY, maxX, maxY each), their colliders and ids.
  #bounds = new Float64Array(256);
  #colliders: Collider[] = [];
  #boxIds: number[] = [];
  #order: number[] = [];

  /** `compactAt` is for tests: renumber ids once they reach it (default 2^15, the most that make int32 pair keys). */
  constructor(compactAt: number = SMALL_ID) {
    this.#compactAt = Math.min(compactAt, SMALL_ID);
  }

  /** Compare this frame's colliders with last frame's contacts and report the new ones. Returns how many were reported. */
  update(world: World, colliders: readonly ColliderEntry[]): number {
    // Keep ids small, so pair keys stay int32. Only when it pays: not every frame when there are simply that many colliders.
    if (this.#nextId + colliders.length > this.#compactAt && this.#nextId > 2 * colliders.length) this.#renumber(colliders);

    if (this.#bounds.length < colliders.length * 4) this.#bounds = new Float64Array(colliders.length * 8);
    const bounds = this.#bounds;
    const boxColliders = this.#colliders;
    const ids = this.#boxIds;
    let count = 0;
    for (const { collider, world: transform } of colliders) {
      if (!writeBounds(collider.width, collider.height, transform, bounds, count * 4)) continue;
      boxColliders[count] = collider;
      ids[count] = this.#id(collider);
      count++;
    }
    boxColliders.length = count;
    ids.length = count;

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
    for (let s = 0; s < count; s++) {
      const p = order[s] as number;
      const minY = bounds[p * 4 + 1] as number;
      const maxX = bounds[p * 4 + 2] as number;
      const maxY = bounds[p * 4 + 3] as number;
      const parent = (boxColliders[p] as Collider).parent;
      const idP = ids[p] as number;
      for (let t = s + 1; t < count; t++) {
        const q = order[t] as number;
        if ((bounds[q * 4] as number) >= maxX) break;
        if (!(minY < (bounds[q * 4 + 3] as number) && maxY > (bounds[q * 4 + 1] as number))) continue;
        if (parent === (boxColliders[q] as Collider).parent) continue;
        const idQ = ids[q] as number;
        const key = idP < idQ ? pairKey(idP, idQ) : pairKey(idQ, idP);
        now.add(key);
        if (!touching.has(key)) started.push(p < q ? [p, q] : [q, p]);
      }
    }
    this.#now = touching;
    this.#touching = now;

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
   * over. Contacts with a collider that is not in this frame are dropped, as `update` would drop them.
   */
  #renumber(colliders: readonly ColliderEntry[]): void {
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
    const touching = new Set<number | string>();
    for (const key of this.#touching) {
      const [oldLow, oldHigh] = pairOf(key);
      const low = renamed.get(oldLow);
      const high = renamed.get(oldHigh);
      if (low !== undefined && high !== undefined) touching.add(low < high ? pairKey(low, high) : pairKey(high, low));
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
