import { GameObject } from "../GameObject.ts";
import { IDENTITY_TRANSFORM, type WorldTransform } from "../Transform.ts";

export interface CameraProps {
  /** Magnification of the view: 2 draws everything twice as large. Must be positive. Default 1. */
  zoom?: number;
}

export const DEFAULT_ZOOM = 1;

/**
 * A 2D affine map from world space to view space, in the order a canvas takes
 * it: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 */
export interface ViewTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The viewport. A camera's own transform is the view: a renderer draws the
 * world through its inverse, so moving the camera pans the view, turning it
 * turns the view the other way, and scaling it up shows more of the world.
 * `zoom` then magnifies. The point the camera is at lands on the centre of the
 * viewport; the renderer knows the viewport's size, the camera does not.
 *
 * Moving a camera never changes any object's `worldTransform()`: the view is
 * applied on top of the world, not into it.
 *
 * **A camera follows its children**: `<Camera><Player /></Camera>` keeps the view
 * on the player as it moves. With several children it centres on the middle of
 * their positions. The camera is transparent to its children's transforms (see
 * `childSpace`): they are placed in the camera's parent's space, as if the
 * camera were not there, which is what lets it follow them without moving them.
 * Its own `transform` is then an offset from the followed point; with no
 * children it is where the camera is.
 */
export class Camera<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  zoom: number;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: CameraProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.zoom = hostProps.zoom ?? DEFAULT_ZOOM;
  }

  /**
   * A camera does not move its children: they are placed in its parent's space
   * (or the world's), as if it were not there. Otherwise following them would be
   * circular, since a child's position would depend on a camera that depends on it.
   */
  override childSpace(): WorldTransform {
    return this.parent === null ? IDENTITY_TRANSFORM : this.parent.childSpace();
  }

  /** The middle of the children's world positions, or null with no children. */
  #childrenCentre(): Point | null {
    if (this.children.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const child of this.children) {
      const at = child.worldTransform();
      x += at.x;
      y += at.y;
    }
    return { x: x / this.children.length, y: y / this.children.length };
  }

  /**
   * The world → view map: the inverse of the camera's world transform, then
   * `zoom`. It recomputes from the tree each call, so it is always current; a
   * renderer drawing many things should fetch it once per frame and apply it to
   * all of them, rather than call `worldToView` per point.
   */
  viewTransform(): ViewTransform {
    if (!(this.zoom > 0) || !Number.isFinite(this.zoom)) throw new RangeError(`Camera zoom must be a positive number, not ${this.zoom}.`);
    const world = this.worldTransform();
    if (world.scaleX === 0 || world.scaleY === 0) throw new RangeError("A camera cannot have a scale of 0: it would see nothing.");
    let x = world.x;
    let y = world.y;
    const target = this.#childrenCentre();
    if (target !== null) {
      // Move the camera's anchor (its parent's position, or the origin when it has none or is `global`) to the
      // children's centre. The camera keeps its own offset from the anchor, transformed as usual by its parent,
      // so the offset means the same thing with or without children.
      const anchor = this.transform.global || this.parent === null ? { x: 0, y: 0 } : this.parent.childSpace();
      x += target.x - anchor.x;
      y += target.y - anchor.y;
    }
    for (const [name, value] of Object.entries({ x, y, rotation: world.rotation, scaleX: world.scaleX, scaleY: world.scaleY })) {
      if (!Number.isFinite(value)) throw new RangeError(`A camera's ${name} must be a finite number, not ${value}.`);
    }
    // view(p) = zoom · S⁻¹ · R(−θ) · (p − position): undo the camera's translation, rotation, then scale.
    const cos = Math.cos(world.rotation);
    const sin = Math.sin(world.rotation);
    const kx = this.zoom / world.scaleX;
    const ky = this.zoom / world.scaleY;
    const a = kx * cos;
    const c = kx * sin;
    const b = 0 - ky * sin; // `0 -`, not unary minus: no negative zeros in the result
    const d = ky * cos;
    return { a, b, c, d, e: 0 - (a * x + c * y), f: 0 - (b * x + d * y) };
  }

  /** Where a world-space point lands in view space (the viewport's centre is the origin). One point; for many, use `viewTransform()` once. */
  worldToView(x: number, y: number): Point {
    const v = this.viewTransform();
    return { x: v.a * x + v.c * y + v.e, y: v.b * x + v.d * y + v.f };
  }

  /** The world-space point under a view-space point (for turning a click into a world position). */
  viewToWorld(x: number, y: number): Point {
    const v = this.viewTransform();
    const det = v.a * v.d - v.b * v.c;
    const dx = x - v.e;
    const dy = y - v.f;
    return { x: (v.d * dx - v.c * dy) / det, y: (-v.b * dx + v.a * dy) / det };
  }
}
