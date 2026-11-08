/**
 * Where a game object is: position in pixels (y points down), rotation in
 * radians (positive turns clockwise on a y-down screen), and scale. Every
 * GameObject has one; components set it with the `transform={{ x, y }}`
 * attribute, usually from state.
 *
 * A transform is relative to the parent: a child at `{ x: 10 }` inside a
 * parent at `{ x: 100 }` is at 110 in the world, and it turns and scales with
 * its parent. `global: true` opts out: the transform is then in world space,
 * whatever its ancestors do. A renderer reads `GameObject.worldTransform()`.
 */
export class Transform {
  x = 0;
  y = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
  /** World space instead of relative to the nearest ancestor Entity. */
  global = false;
}

/** A resolved, world-space transform. */
export interface WorldTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export const IDENTITY_TRANSFORM: WorldTransform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/**
 * `local` placed inside `parent`: the local position is scaled, then rotated,
 * by the parent and added to the parent's position; rotations add and scales
 * multiply. (Non-uniform parent scale combined with a rotated child would
 * shear in a full affine model; this keeps scale per axis, which is what 2D
 * games almost always want.) A global `local` ignores `parent`.
 */
export function composeTransforms(parent: WorldTransform, local: Transform | WorldTransform): WorldTransform {
  if ("global" in local && local.global) {
    return { x: local.x, y: local.y, rotation: local.rotation, scaleX: local.scaleX, scaleY: local.scaleY };
  }
  const sx = local.x * parent.scaleX;
  const sy = local.y * parent.scaleY;
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  return {
    x: parent.x + sx * cos - sy * sin,
    y: parent.y + sx * sin + sy * cos,
    rotation: parent.rotation + local.rotation,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
  };
}
