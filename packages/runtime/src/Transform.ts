/**
 * Where a game object is: position in pixels (y points down), rotation in
 * radians (positive turns clockwise on a y-down screen), and scale. Every
 * GameObject has one; components set it with a built-in's `x`, `y`, … props,
 * usually from state.
 *
 * A transform is relative to the parent: a child at `{ x: 10 }` inside a
 * parent at `{ x: 100 }` is at 110 in the world, and it turns and scales with
 * its parent. `global: true` opts out: the transform is then in world space,
 * whatever its ancestors do. A renderer reads `GameObject.worldTransform()`.
 *
 * `z` is draw order, not a position: what is drawn with a higher `z` is drawn
 * later, so on top (0 is the default, and negative is behind). Like x and y it
 * adds to the parent's, so a subtree can be raised as one; `global` ignores the
 * parent's. Objects with equal `z` keep tree order. It is not part of
 * `WorldTransform`: only the player's draw pass reads it.
 */
/**
 * What the numeric fields of a `Transform` are first set to, before the constructor sets the real defaults: a number that is not a
 * small integer. V8 picks a field's representation from the first value stored in it. A field that starts as a small integer (0, 1)
 * and later holds a fraction (a position moved by `speed * dt`, a blended position) changes the shape of every transform, and a frame
 * walk that composes thousands of them kept deoptimising: 2,000 objects moving by fractions under a fixed step took 2.7 ms a frame
 * to build instead of 0.6. Starting as a double keeps one shape from the first object on.
 */
const DOUBLE = 0.5;

export class Transform {
  x = DOUBLE;
  y = DOUBLE;
  /** Draw order; see the class comment. */
  z = 0;
  rotation = DOUBLE;
  scaleX = DOUBLE;
  scaleY = DOUBLE;
  /** World space: ignores the parent (and, for `transform`, the placement), so this is where the object is. */
  global = false;
  /**
   * How opaque this object and everything under it are, 0 to 1: multiplied down the tree (a child at 0.5 under a parent at 0.5
   * is at 0.25), and applied to each thing drawn on its own, so where two overlap the one below shows through. Not part of
   * `WorldTransform`: only the player's draw pass reads it. Default 1.
   */
  opacity = 1;

  constructor() {
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.scaleX = 1;
    this.scaleY = 1;
  }
}

/** A resolved, world-space transform. */
export interface WorldTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export const IDENTITY_TRANSFORM: WorldTransform = Object.freeze({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });

/**
 * `parent` moved by a layout offset (see `GameObject.layoutX`): the offset is in the parent's space, so it is
 * scaled and turned with it, like a child's position. With no offset this is `parent` itself.
 */
export function offsetTransform(parent: WorldTransform, x: number, y: number): WorldTransform {
  if (x === 0 && y === 0) return parent;
  return composeTransforms(parent, { x, y, rotation: 0, scaleX: 1, scaleY: 1 });
}

/**
 * `local` placed inside `parent`: the local position is scaled, then rotated,
 * by the parent and added to the parent's position; rotations add and scales
 * multiply. (Non-uniform parent scale combined with a rotated child would
 * shear in a full affine model; this keeps scale per axis, which is what 2D
 * games almost always want.) A global `local` ignores `parent`. The result
 * may be `parent` itself (when `local` is the identity), so treat it as read-only.
 */
export function composeTransforms(parent: WorldTransform, local: Transform | WorldTransform): WorldTransform {
  if ("global" in local && local.global) {
    return { x: local.x, y: local.y, rotation: local.rotation, scaleX: local.scaleX, scaleY: local.scaleY };
  }
  // Fast paths (a renderer composes twice per object per frame, and most placements are identity and most
  // parents are upright). For finite numbers both give what the general case gives, up to the sign of a zero.
  if (local.x === 0 && local.y === 0 && local.rotation === 0 && local.scaleX === 1 && local.scaleY === 1) return parent;
  const sx = local.x * parent.scaleX;
  const sy = local.y * parent.scaleY;
  if (parent.rotation === 0) {
    return {
      x: parent.x + sx,
      y: parent.y + sy,
      rotation: parent.rotation + local.rotation,
      scaleX: parent.scaleX * local.scaleX,
      scaleY: parent.scaleY * local.scaleY,
    };
  }
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
