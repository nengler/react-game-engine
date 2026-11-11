import { GameObject } from "../GameObject.ts";
import type { World } from "../World.ts";

/**
 * Anything a press can land on: a `<Pointer>`, or a `<Flex>` with an `onPress`. The player collects these in draw
 * order and gives a press to the topmost one under the mouse (`World.reportPress`).
 */
export interface Pressable {
  readonly world: World | null;
  onPress: (() => void) | undefined;
  /** The mouse came over it: it is now the topmost pressable under the mouse (see `World.reportHover`). */
  onPointerEnter?: (() => void) | undefined;
  /** The mouse left it, or something else came over it. */
  onPointerLeave?: (() => void) | undefined;
  /** Whether the world-space point (the HUD's, for one inside a `<Hud>`) is on it as it is drawn. */
  contains(x: number, y: number): boolean;
  /** A key or an action (`"wave"`) whose press calls `onPress`, like the DOM's `accessKey` (see `World.tick`). */
  pressKey?: string | undefined;
  /** It takes the focus: the arrow keys move between focusable things, and the confirm key presses the focused one. */
  focusable?: boolean;
  /** Take the focus when it is mounted, if nothing has it. */
  autoFocus?: boolean;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** Its middle, in its layer's coordinates: where the arrow keys measure from. */
  focusPoint?(): { readonly x: number; readonly y: number };
}

/** Props every pressable takes, `<Pointer>`'s and `<Flex>`'s alike. */
export interface PressableProps {
  /** Called when a press lands on it (see `World.reportPress`), when its `pressKey` is pressed, or when it has the focus and the confirm key is pressed. */
  onPress?: () => void;
  /** Called when the mouse comes over it (it is the topmost pressable under the mouse), as the DOM's `pointerenter`. */
  onPointerEnter?: () => void;
  /** Called when the mouse leaves it, or something drawn over it takes the mouse. */
  onPointerLeave?: () => void;
  /**
   * A key (`"Space"`) or an action of the game's controls (`"wave"`) that presses it, as a click would, while it is mounted and not
   * inert: a button that owns its shortcut, as the DOM's `accessKey`. Every mounted pressable with that key is pressed.
   */
  pressKey?: string;
  /**
   * It can take the focus (as a DOM button can): the actions `left` `right` `up` `down` (or, when the controls have none, the arrow keys
   * and the d-pad) move the focus to the nearest focusable in that direction, and `confirm` (or Enter and PadA) presses it. A click on
   * it focuses it too.
   */
  focusable?: boolean;
  /** Take the focus when mounted, if nothing has it (React's `autoFocus`). */
  autoFocus?: boolean;
  /** Called when it takes the focus. */
  onFocus?: () => void;
  /** Called when it loses the focus to another. */
  onBlur?: () => void;
}

export interface PointerProps extends PressableProps {
  width: number;
  height: number;
  /** Where the area's origin is, from its top-left corner, as a `Sprite`'s: `originX={5} originY={5}` centres a 10 × 10 area on its position. Default 0. */
  originX?: number;
  originY?: number;
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
  onPointerEnter: (() => void) | undefined;
  onPointerLeave: (() => void) | undefined;
  originX: number;
  originY: number;
  pressKey: string | undefined;
  focusable: boolean;
  autoFocus: boolean;
  onFocus: (() => void) | undefined;
  onBlur: (() => void) | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: PointerProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.onPress = hostProps.onPress;
    this.onPointerEnter = hostProps.onPointerEnter;
    this.onPointerLeave = hostProps.onPointerLeave;
    this.originX = hostProps.originX ?? 0;
    this.originY = hostProps.originY ?? 0;
    this.pressKey = hostProps.pressKey;
    this.focusable = hostProps.focusable ?? false;
    this.autoFocus = hostProps.autoFocus ?? false;
    this.onFocus = hostProps.onFocus;
    this.onBlur = hostProps.onBlur;
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
    const localX = (dx * cos + dy * sin) / t.scaleX + this.originX;
    const localY = (dy * cos - dx * sin) / t.scaleY + this.originY;
    return localX >= 0 && localX <= this.width && localY >= 0 && localY <= this.height;
  }

  /** The middle of the area, in its layer's coordinates (scale and rotation ignored). */
  focusPoint(): { x: number; y: number } {
    const t = this.worldTransform();
    return { x: t.x + this.width / 2 - this.originX, y: t.y + this.height / 2 - this.originY };
  }
}
