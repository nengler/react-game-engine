/**
 * The shapes a `<Collider>` can have (`shape`), and whether two of them overlap. A collider is found by its box first (the broad
 * phase, in the player and in `World`'s queries); a pair in which either is not a plain box is then tested exactly here. Shapes are
 * convex: a box (turned with its object, exactly), a circle, or a convex polygon. Touching edges do not overlap, as with boxes.
 */
import type { WorldTransform } from "./Transform.ts";

/** What a collider is shaped like inside its `width` × `height` box. */
export type ColliderShape = "box" | "circle" | "polygon";

/** Every collider shape, for the compiler's check of a literal. */
export const COLLIDER_SHAPES: readonly ColliderShape[] = ["box", "circle", "polygon"];

/** A shape in world space: a circle, or a convex polygon by its corners in order (either way round). */
export type Geometry =
  | { readonly kind: "circle"; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly kind: "polygon"; readonly xs: readonly number[]; readonly ys: readonly number[] };

/** What `geometryOf` reads of a collider. */
export interface ShapedCollider {
  readonly shape: ColliderShape;
  readonly width: number;
  readonly height: number;
  /** A polygon's corners, `[x0, y0, x1, y1, …]`, in the collider's own pixels (its box's top left is 0, 0). */
  readonly points: readonly number[];
}

/**
 * The collider's shape where it is in the world, or null when it has none (no area, fewer than three corners, a number that is not
 * one). A box is its four corners, turned and scaled with its object; a circle is the one inside its box, centred there, its radius
 * half the shorter side (scaled by the average of the two scales); a polygon is its points, turned and scaled the same way.
 */
export function geometryOf(collider: ShapedCollider, world: WorldTransform): Geometry | null {
  const { width, height } = collider;
  if (!(width > 0 && height > 0)) return null;
  const cos = world.rotation === 0 ? 1 : Math.cos(world.rotation);
  const sin = world.rotation === 0 ? 0 : Math.sin(world.rotation);
  const sx = world.scaleX;
  const sy = world.scaleY;
  const toX = (x: number, y: number): number => world.x + x * sx * cos - y * sy * sin;
  const toY = (x: number, y: number): number => world.y + x * sx * sin + y * sy * cos;
  if (collider.shape === "circle") {
    const radius = (Math.min(width, height) / 2) * ((Math.abs(sx) + Math.abs(sy)) / 2);
    const x = toX(width / 2, height / 2);
    const y = toY(width / 2, height / 2);
    return radius > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius) ? { kind: "circle", x, y, radius } : null;
  }
  const local = collider.shape === "polygon" ? collider.points : [0, 0, width, 0, width, height, 0, height];
  const count = Math.floor(local.length / 2);
  if (count < 3) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = toX(local[i * 2] as number, local[i * 2 + 1] as number);
    const y = toY(local[i * 2] as number, local[i * 2 + 1] as number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    xs.push(x);
    ys.push(y);
  }
  return { kind: "polygon", xs, ys };
}

/** The interval a polygon covers along the axis (ax, ay). */
function project(xs: readonly number[], ys: readonly number[], ax: number, ay: number, out: number[]): void {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = (xs[i] as number) * ax + (ys[i] as number) * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  out[0] = min;
  out[1] = max;
}

const A = [0, 0];
const B = [0, 0];

/** Whether some edge normal of `p` separates `p` from the polygon or circle `other` (the separating axis test, one side's axes). */
function separatedByEdgesOf(p: Extract<Geometry, { kind: "polygon" }>, other: Geometry): boolean {
  const n = p.xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = -((p.ys[j] as number) - (p.ys[i] as number));
    const ay = (p.xs[j] as number) - (p.xs[i] as number);
    if (ax === 0 && ay === 0) continue;
    project(p.xs, p.ys, ax, ay, A);
    if (other.kind === "polygon") project(other.xs, other.ys, ax, ay, B);
    else {
      const length = Math.hypot(ax, ay);
      const c = other.x * ax + other.y * ay;
      B[0] = c - other.radius * length;
      B[1] = c + other.radius * length;
    }
    if ((A[1] as number) <= (B[0] as number) || (B[1] as number) <= (A[0] as number)) return true;
  }
  return false;
}

/** Whether two shapes overlap (sharing only an edge or a point is not overlapping). */
export function geometriesOverlap(a: Geometry, b: Geometry): boolean {
  if (a.kind === "circle" && b.kind === "circle") {
    const r = a.radius + b.radius;
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < r * r;
  }
  if (a.kind === "circle") return geometriesOverlap(b, a);
  if (separatedByEdgesOf(a, b)) return false;
  if (b.kind === "polygon") return !separatedByEdgesOf(b, a);
  // A circle against a polygon: besides the polygon's edge normals, the axis from the circle's middle to the polygon's nearest corner.
  let best = Infinity;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < a.xs.length; i++) {
    const d = ((a.xs[i] as number) - b.x) ** 2 + ((a.ys[i] as number) - b.y) ** 2;
    if (d < best) {
      best = d;
      cx = a.xs[i] as number;
      cy = a.ys[i] as number;
    }
  }
  const ax = cx - b.x;
  const ay = cy - b.y;
  if (ax === 0 && ay === 0) return true;
  project(a.xs, a.ys, ax, ay, A);
  const length = Math.hypot(ax, ay);
  const c = b.x * ax + b.y * ay;
  return !((A[1] as number) <= c - b.radius * length || c + b.radius * length <= (A[0] as number));
}

/** Whether a collider's shape overlaps an upright box (a body's): what `World`'s queries ask of a shaped collider. */
export function geometryOverlapsBox(g: Geometry, x: number, y: number, width: number, height: number): boolean {
  return geometriesOverlap(g, { kind: "polygon", xs: [x, x + width, x + width, x], ys: [y, y, y + height, y + height] });
}
