import { GameObject } from "../GameObject.ts";

export interface PointerProps {
  width: number;
  height: number;
  /** Called when a press lands inside the area (see `World.reportPress`). */
  onPress?: () => void;
}

/**
 * A clickable or tappable hit area, placed with `transform` like anything else.
 * The origin is the top-left corner, as for a `Sprite` and a `Shape`. It draws
 * nothing; pair it with a `Sprite` or `Shape` for a button.
 */
export class Pointer<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  onPress: (() => void) | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: PointerProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.onPress = hostProps.onPress;
  }

  /**
   * Whether the world-space point is inside the area as it is drawn: the point
   * is taken back through the pointer's position, rotation and scale, so a moved,
   * turned or scaled pointer is hit where it appears. An area with no size (zero,
   * negative or not a number), or a zero scale, is never hit.
   */
  contains(x: number, y: number): boolean {
    const t = this.worldTransform();
    if (!(this.width > 0 && this.height > 0) || t.scaleX === 0 || t.scaleY === 0) return false;
    const dx = x - t.x;
    const dy = y - t.y;
    const cos = Math.cos(t.rotation);
    const sin = Math.sin(t.rotation);
    const localX = (dx * cos + dy * sin) / t.scaleX;
    const localY = (dy * cos - dx * sin) / t.scaleY;
    return localX >= 0 && localX <= this.width && localY >= 0 && localY <= this.height;
  }
}
