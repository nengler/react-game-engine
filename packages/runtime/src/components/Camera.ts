import { GameObject } from "../GameObject.ts";
import type { InputState } from "../input.ts";
import { IDENTITY_TRANSFORM, type WorldTransform } from "../Transform.ts";

export interface CameraProps {
  /** Magnification of the view: 2 draws everything twice as large. Must be positive. Default 1. */
  zoom?: number;
  /**
   * Shake the view when this value changes (not when the camera is made): a counter a game bumps on each hit, 1, 2, 3. The
   * shake is `shakeStrength` pixels at first and dies away over `shakeDuration` seconds, in whole pixels, from a fixed random
   * sequence so a run repeats exactly. It is time in `onUpdate`, so it follows the fixed timestep.
   */
  shake?: number;
  /** Pixels the view is thrown by at the start of a shake. Default 2. */
  shakeStrength?: number;
  /** Seconds a shake lasts. Default 0.2. */
  shakeDuration?: number;
  /**
   * The area the view may show, `[x, y, width, height]` in world pixels: the camera never shows outside it, so the view
   * stops at its edge (a view larger than the area is centred on it). Needs the size of the screen, which the player gives it.
   */
  bounds?: readonly number[];
  /**
   * Seconds the view takes to slide when `bounds` change to another area (a room change): it eases from where it was to where
   * the new bounds put it, instead of jumping. Default 0: no slide.
   */
  slide?: number;
}

const DEFAULT_ZOOM = 1;

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
  shake: number | undefined;
  shakeStrength: number;
  shakeDuration: number;
  bounds: readonly number[] | undefined;
  slide: number;
  /** Where the view is now, as a movement away from where the bounds put it: it eases to 0 during a slide. Pixels. */
  slideX = 0;
  slideY = 0;
  #shakeTime = 0;
  #shakeSeen: number | undefined;
  #shakeFrame = 0;
  #lastBounds: readonly number[] | undefined;
  #lastCentre: Point | null = null;
  /** The size of the view in world pixels at zoom 1, set by the player before it asks for the view (the screen's size). */
  viewWidth = 0;
  viewHeight = 0;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: CameraProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.zoom = hostProps.zoom ?? DEFAULT_ZOOM;
    this.shake = hostProps.shake;
    this.#shakeSeen = hostProps.shake;
    this.shakeStrength = hostProps.shakeStrength ?? 2;
    this.shakeDuration = hostProps.shakeDuration ?? 0.2;
    this.bounds = hostProps.bounds;
    this.slide = hostProps.slide ?? 0;
  }

  /** The shake's offset now, in whole pixels: strong at first, dying to 0, from a fixed sequence. */
  get shakeOffset(): Point {
    if (this.#shakeTime <= 0 || !(this.shakeDuration > 0)) return { x: 0, y: 0 };
    const k = this.#shakeTime / this.shakeDuration;
    const f = this.#shakeFrame;
    // A fixed pseudo-random walk over frames: no Math.random, so every run and every engine shakes the same.
    const rx = Math.sin(f * 12.9898 + 78.233) * 43758.5453;
    const ry = Math.sin(f * 39.3468 + 11.135) * 24634.6345;
    return { x: Math.round((rx - Math.floor(rx) - 0.5) * 2 * this.shakeStrength * k), y: Math.round((ry - Math.floor(ry) - 0.5) * 2 * this.shakeStrength * k) };
  }

  /** Advance the shake and the slide. */
  override onUpdate(dt: number, _input?: InputState): void {
    if (this.shake !== this.#shakeSeen) {
      this.#shakeSeen = this.shake;
      if (this.shake !== undefined) this.#shakeTime = this.shakeDuration;
    }
    let changed = false;
    if (this.#shakeTime > 0) {
      this.#shakeTime = Math.max(0, this.#shakeTime - dt);
      this.#shakeFrame++;
      changed = true;
    }
    if ((this.slideX !== 0 || this.slideY !== 0) && dt > 0) {
      // Ease out: a fraction of what is left each step, so the view arrives smoothly and never overshoots, and has come to rest in about the slide time.
      const k = 1 - Math.exp((-7 * dt) / Math.max(this.slide, 1e-3));
      this.slideX = Math.abs(this.slideX) < 0.5 ? 0 : this.slideX * (1 - k);
      this.slideY = Math.abs(this.slideY) < 0.5 ? 0 : this.slideY * (1 - k);
      changed = true;
    }
    if (changed) this.markChanged();
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
    // Bounds: the view stays inside the area (centred on it when the area is smaller than the view). A change of bounds starts a slide.
    const area = this.bounds;
    if (area !== undefined && area.length === 4 && this.viewWidth > 0 && this.viewHeight > 0) {
      const halfW = this.viewWidth / this.zoom / 2;
      const halfH = this.viewHeight / this.zoom / 2;
      const bx = area[0] as number;
      const by = area[1] as number;
      const bw = area[2] as number;
      const bh = area[3] as number;
      x = bw <= halfW * 2 ? bx + bw / 2 : Math.min(Math.max(x, bx + halfW), bx + bw - halfW);
      y = bh <= halfH * 2 ? by + bh / 2 : Math.min(Math.max(y, by + halfH), by + bh - halfH);
      const last = this.#lastBounds;
      if (last !== undefined && (last[0] !== bx || last[1] !== by || last[2] !== bw || last[3] !== bh) && this.slide > 0 && this.#lastCentre !== null) {
        // Start where the view was last shown (slide and all), and ease to where the new bounds put it.
        this.slideX = this.#lastCentre.x + this.slideX - x;
        this.slideY = this.#lastCentre.y + this.slideY - y;
      }
      this.#lastBounds = [bx, by, bw, bh];
    } else this.#lastBounds = undefined;
    this.#lastCentre = { x, y };
    x += this.slideX;
    y += this.slideY;
    const shake = this.shakeOffset;
    x += shake.x;
    y += shake.y;
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
