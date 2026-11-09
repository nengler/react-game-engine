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
  if (!(width > 0 && height > 0)) return null;
  const w = width * world.scaleX;
  const h = height * world.scaleY;
  const cos = Math.cos(world.rotation);
  const sin = Math.sin(world.rotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    const x = world.x + cx * cos - cy * sin;
    const y = world.y + cx * sin + cy * cos;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))) return null;
  if (!(maxX > minX && maxY > minY)) return null;
  return { minX, minY, maxX, maxY };
}

/** Whether two boxes overlap. Boxes that only share an edge do not: touching is not colliding. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

interface Box {
  readonly collider: Collider;
  readonly bounds: Bounds;
  readonly id: number;
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
  readonly #ids = new WeakMap<Collider, number>();
  #nextId = 0;
  /** `"<lower id>:<higher id>"` of every pair that overlapped in the last frame. */
  #touching = new Set<string>();

  /** Compare this frame's colliders with last frame's contacts and report the new ones. Returns how many were reported. */
  update(world: World, colliders: readonly ColliderEntry[]): number {
    const boxes: { collider: Collider; bounds: Bounds; id: number }[] = [];
    for (const { collider, world: transform } of colliders) {
      const bounds = colliderBounds(collider.width, collider.height, transform);
      if (bounds !== null) boxes.push({ collider, bounds, id: this.#idOf(collider) });
    }

    // Sweep over x: with the boxes sorted by their left edge, a box can only touch the ones after it that start
    // before it ends, so each inner loop stops at the first box that starts past `maxX`. Those boxes overlap in x
    // by construction, so only y is left to test. (Ties in `minX` keep draw order.)
    const order = boxes.map((_, index) => index).sort((p, q) => (boxes[p] as Box).bounds.minX - (boxes[q] as Box).bounds.minX || p - q);
    const now = new Set<string>();
    const started: [number, number][] = [];
    for (let s = 0; s < order.length; s++) {
      const p = order[s] as number;
      const a = boxes[p] as Box;
      for (let t = s + 1; t < order.length; t++) {
        const q = order[t] as number;
        const b = boxes[q] as Box;
        if (b.bounds.minX >= a.bounds.maxX) break;
        if (!(a.bounds.minY < b.bounds.maxY && a.bounds.maxY > b.bounds.minY)) continue;
        if (a.collider.parent === b.collider.parent) continue;
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        now.add(key);
        if (!this.#touching.has(key)) started.push(p < q ? [p, q] : [q, p]);
      }
    }
    this.#touching = now;

    // In draw order (the list's order), earlier collider first, so reports are deterministic whatever the sweep found first.
    started.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (const [p, q] of started) world.reportCollision((boxes[p] as Box).collider, (boxes[q] as Box).collider);
    return started.length;
  }

  #idOf(collider: Collider): number {
    let id = this.#ids.get(collider);
    if (id === undefined) {
      id = this.#nextId++;
      this.#ids.set(collider, id);
    }
    return id;
  }
}
