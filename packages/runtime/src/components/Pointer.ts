import { GameObject } from "../GameObject.ts";
import type { WorldTransform } from "../Transform.ts";
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
  /**
   * `contains`, for a caller that already holds the `childSpace()` of its parent: the player asks every pressable under the mouse each
   * frame, and neighbours with one parent (the tiles of a grid) then share one walk up the tree.
   */
  containsIn?(parentSpace: WorldTransform, x: number, y: number): boolean;
  /** A key or an action (`"wave"`) whose press calls `onPress`, like the DOM's `accessKey` (see `World.tick`). */
  pressKey?: string | undefined;
  /** It takes the focus: the arrow keys move between focusable things, and the confirm key presses the focused one. */
  focusable?: boolean;
  /** Take the focus when it is mounted, if nothing has it. */
  autoFocus?: boolean;
  /** Switched off: a press on it is swallowed without calling `onPress`, and it takes no focus, key or confirm press (see `PressableProps.disabled`). */
  disabled?: boolean;
  /** A press landed on it at this point (the layer's coordinates, as `contains` takes), just before `onPress`: for what needs to know where, such as a slider. */
  onPressAt?(x: number, y: number): void;
  /** The button that pressed it is still held and the mouse is at this point, each step, wherever the mouse has gone: what a slider's thumb follows. */
  onHeldAt?(x: number, y: number): void;
  /** A press landed on it at this point: a drag may begin (see `PressableProps.onDragStart`). */
  onDragStart?: ((x: number, y: number) => void) | undefined;
  /** The press that began on it is still held and the mouse has moved to this point. */
  onDrag?: ((x: number, y: number) => void) | undefined;
  /** The press that began on it was let go at this point. */
  onDragEnd?: ((x: number, y: number) => void) | undefined;
  /** A direction (`dx`, `dy` each -1, 0 or 1) was pressed while it has the focus: true if it used it, and the focus then stays where it is. */
  onNavigate?(dx: number, dy: number): boolean;
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
   * Dragging, with a mouse or a finger alike. `onDragStart` is called when a press lands on it, with where (in its layer's coordinates:
   * the world's, or the HUD's inside a `<Hud>`; with no camera these are `input.pointerX` and `pointerY`). While that press is held,
   * `onDrag` is called each time the pointer has moved, wherever it has gone, off the box included; `onDragEnd` when it is let go,
   * with where. A press let go where it began is a tap: `onDragStart` then `onDragEnd`, with no `onDrag` between. `onPress` is still
   * called, before `onDragStart`. One that leaves the tree while it is held hears no more of the drag.
   */
  onDragStart?: (x: number, y: number) => void;
  onDrag?: (x: number, y: number) => void;
  onDragEnd?: (x: number, y: number) => void;
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
  /**
   * Switched off, as a DOM button's `disabled`: its `onPress` is not called by a click, its `pressKey` or the confirm key, and it cannot take
   * the focus. A click on it is still swallowed, not passed on to what is under it. The pointer callbacks (`onPointerEnter` and `onPointerLeave`)
   * still run, so a disabled button can explain itself. A `<Flex>` shows its `disabledBackground` and `disabledBorderColor` in place of every other state.
   */
  disabled?: boolean;
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
  onDragStart: ((x: number, y: number) => void) | undefined;
  onDrag: ((x: number, y: number) => void) | undefined;
  onDragEnd: ((x: number, y: number) => void) | undefined;
  originX: number;
  originY: number;
  pressKey: string | undefined;
  focusable: boolean;
  autoFocus: boolean;
  disabled: boolean;
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
    this.onDragStart = hostProps.onDragStart;
    this.onDrag = hostProps.onDrag;
    this.onDragEnd = hostProps.onDragEnd;
    this.originX = hostProps.originX ?? 0;
    this.originY = hostProps.originY ?? 0;
    this.pressKey = hostProps.pressKey;
    this.focusable = hostProps.focusable ?? false;
    this.autoFocus = hostProps.autoFocus ?? false;
    this.disabled = hostProps.disabled ?? false;
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
    return pointerContains(this, this.worldTransform(), x, y);
  }

  containsIn(parentSpace: WorldTransform, x: number, y: number): boolean {
    return pointerContains(this, this.worldTransformIn(parentSpace), x, y);
  }

  /** The middle of the area, in its layer's coordinates (scale and rotation ignored). */
  focusPoint(): { x: number; y: number } {
    const t = this.worldTransform();
    return { x: t.x + this.width / 2 - this.originX, y: t.y + this.height / 2 - this.originY };
  }
}

/**
 * Whether the point is in `pointer`'s area, with the pointer at `t` in the world. (A function, not a private method: QuickJS makes a
 * private-method call slow, and hover asks every pointer each frame.)
 */
function pointerContains(pointer: Pointer, t: WorldTransform, x: number, y: number): boolean {
  if (!(pointer.width > 0 && pointer.height > 0) || t.scaleX === 0 || t.scaleY === 0) return false;
  const dx = x - t.x;
  const dy = y - t.y;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const localX = (dx * cos + dy * sin) / t.scaleX + pointer.originX;
  const localY = (dy * cos - dx * sin) / t.scaleY + pointer.originY;
  return localX >= 0 && localX <= pointer.width && localY >= 0 && localY <= pointer.height;
}
