import { GameObject } from "../GameObject.ts";

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
 * To follow something, make the camera its child (`<Entity><Camera /></Entity>`):
 * transforms nest, so the view moves with it. Code that is not compiled
 * (a game loop, a scene loader) can instead set `follow`.
 */
export class Camera<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  zoom: number;
  /**
   * An object the camera tracks, set from code (it cannot be written in JSX:
   * nothing in a component names another object). While set, the camera is at
   * the target's world position plus the camera's own `transform.x` and `.y`,
   * which become an offset; its rotation and scale are its own.
   */
  follow: GameObject | null = null;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: CameraProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.zoom = hostProps.zoom ?? DEFAULT_ZOOM;
  }

  /** The world → view map: the inverse of the camera's world transform, then `zoom`. */
  viewTransform(): ViewTransform {
    if (!(this.zoom > 0) || !Number.isFinite(this.zoom)) throw new RangeError(`Camera zoom must be a positive number, not ${this.zoom}.`);
    const world = this.worldTransform();
    if (world.scaleX === 0 || world.scaleY === 0) throw new RangeError("A camera cannot have a scale of 0: it would see nothing.");
    let x = world.x;
    let y = world.y;
    if (this.follow !== null) {
      const target = this.follow.worldTransform();
      x = target.x + this.transform.x;
      y = target.y + this.transform.y;
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

  /** Where a world-space point lands in view space (the viewport's centre is the origin). */
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
