import { GameObject } from "../GameObject.ts";
import type { PressableProps } from "./Pointer.ts";

/** The main axis of a `<Flex>`. The manifest's `intrinsicLiterals` reads these lists, so the compiler cannot drift from them. */
export const FLEX_DIRECTIONS = ["row", "column"] as const;
export type FlexDirection = (typeof FLEX_DIRECTIONS)[number];

/** Where children sit across the main axis. `"stretch"` makes a `<Flex>` child with a `"fit"` cross size take the whole cross size. */
export const FLEX_ALIGN_ITEMS = ["start", "center", "end", "stretch"] as const;
export type FlexAlignItems = (typeof FLEX_ALIGN_ITEMS)[number];

/** How children and the free space share the main axis. */
export const FLEX_JUSTIFY_CONTENT = ["start", "center", "end", "space-between", "space-around", "space-evenly"] as const;
export type FlexJustifyContent = (typeof FLEX_JUSTIFY_CONTENT)[number];

/** The nine points of a box that a floating `<Flex>` is attached by (`anchor`) and to (`to`). */
export const FLEX_ANCHORS = ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right"] as const;
export type FlexAnchor = (typeof FLEX_ANCHORS)[number];

/**
 * How big a `<Flex>` is along one axis: `"fit"` (its children plus padding and gaps), `"grow"` (its fit size plus a
 * share of its parent's free space), a number of pixels, or a percentage of its parent's inner size (`"50%"`).
 */
export type FlexSizing = number | "fit" | "grow" | `${number}%`;

export interface FlexProps extends Omit<PressableProps, "onPress"> {
  /** The main axis: children go left to right (`"row"`, the default) or top to bottom. */
  direction?: FlexDirection;
  /** Where children sit across the main axis. Default `"stretch"`. */
  alignItems?: FlexAlignItems;
  /** How children and free space share the main axis. Default `"start"`. */
  justifyContent?: FlexJustifyContent;
  /** Pixels between neighbouring children. Default 0. */
  gap?: number;
  /** Pixels inside the edge, on all four sides. Default 0. */
  padding?: number;
  /** Left and right padding; overrides `padding`. */
  paddingX?: number;
  /** Top and bottom padding; overrides `padding`. */
  paddingY?: number;
  /** One side's padding; overrides `paddingX` / `paddingY` / `padding`. */
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Default `"fit"`. */
  width?: FlexSizing;
  height?: FlexSizing;
  /** Bounds in pixels for a `"fit"` or `"grow"` size. */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  /**
   * Take the box out of its parent's flow: it takes no space and moves no sibling, and is attached to a point of its
   * parent instead (`anchor`, `to`, `offsetX`, `offsetY`). It is still sized like any `<Flex>`, and a `"grow"` or
   * percentage size is of its parent's inner size. Draw it above its neighbours with `z`. Under a `<Hud>` or any
   * parent that is not a `<Flex>`, the parent's box is the game's area (the `<Screen>`, or the window).
   */
  float?: boolean;
  /** Which point of this box is attached. Default `"top-left"`. */
  anchor?: FlexAnchor;
  /** Which point of the parent it is attached to. Default `"top-left"`. */
  to?: FlexAnchor;
  /** Pixels to move it right / down from where the two points meet (negative moves it left / up). Default 0. */
  offsetX?: number;
  offsetY?: number;
  /** A CSS colour: draw a filled rectangle behind the children, the size of the box. Default none. */
  background?: string;
  /**
   * Pixels of border, drawn inside the edge of the box in `borderColor`. The border takes room: it counts as padding on every
   * side, so the children never sit on it. Default 0: none.
   */
  borderWidth?: number;
  /** A CSS colour for the border. Default none: a box with no border colour (plain, hovered or focused) has no border, whatever `borderWidth` says. */
  borderColor?: string;
  /** Pixels of rounding on all four corners of the background and the border, at most half the shorter side. Default 0: square. */
  borderRadius?: number;
  /** `background` while the mouse is over the box (see `World.hovered`). Only what a prop says changes; the rest stays. A box with a hover prop takes the mouse, and lets a press through unless it has an `onPress`. */
  hoverBackground?: string;
  /** `borderColor` while the mouse is over the box. */
  hoverBorderColor?: string;
  /** `background` while the box has the focus (`focusable`). Under a hover prop: when both apply, the hover colour wins. */
  focusBackground?: string;
  /** `borderColor` while the box has the focus. */
  focusBorderColor?: string;
  /** `background` while the mouse button is held down on the box (a press that began on it, and the mouse still over it). Over the hover and focus colours. */
  pressedBackground?: string;
  /** `borderColor` while the box is pressed. */
  pressedBorderColor?: string;
  /** `background` while the box is `disabled`. Over every other state. */
  disabledBackground?: string;
  /** `borderColor` while the box is `disabled`. */
  disabledBorderColor?: string;
  /** Called when a press lands on the laid-out box (see `World.reportPress`), or as `PressableProps` says. The box is the size it was laid out at, last frame. */
  onPress?: () => void;
}

/**
 * What layout works out for a `<Flex>` and keeps between frames, so that laying out allocates nothing per box. Written
 * by the player's layout pass and nothing else; every number is per axis (index 0 is x, 1 is y).
 */
export class FlexBox {
  /** The size the box ended up with. */
  readonly size = new Float64Array(2);
  /** Its preferred size from its content (fit), and the smallest it can be. */
  readonly preferred = new Float64Array(2);
  readonly minimum = new Float64Array(2);
  /** Scratch for the children, one entry each; grown when a box gets more children. */
  childSize: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  childMinimum: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  /** Where a leaf child's own drawing starts relative to its origin (a sprite drawn centred, say), per axis. */
  childOrigin: Float64Array[] = [new Float64Array(8), new Float64Array(8)];
  /**
   * The children layout places, in order: `children` itself, or (when one is `layoutContents`, see `GameObject`) `flat`, the
   * children with each such child replaced by its own.
   */
  kids: readonly GameObject[] = [];
  readonly flat: GameObject[] = [];
  /** 0 a leaf, 1 a `<Flex>`. */
  childKind = new Uint8Array(8);
  /** Indices of the children still taking part in sharing out space. */
  active = new Int32Array(8);
  /** The raw size props last parsed, and what they parsed to, per axis: a string such as "50%" is read once. */
  readonly rawSizing: unknown[] = [undefined, undefined];
  readonly sizingMode = new Uint8Array(2);
  readonly sizingValue = new Float64Array(2);

  ensure(count: number): void {
    if (count <= this.childKind.length) return;
    const capacity = Math.max(count, this.childKind.length * 2);
    const grow = (old: Float64Array): Float64Array => {
      const next = new Float64Array(capacity);
      next.set(old);
      return next;
    };
    this.childSize = [grow(this.childSize[0] as Float64Array), grow(this.childSize[1] as Float64Array)];
    this.childMinimum = [grow(this.childMinimum[0] as Float64Array), grow(this.childMinimum[1] as Float64Array)];
    this.childOrigin = [grow(this.childOrigin[0] as Float64Array), grow(this.childOrigin[1] as Float64Array)];
    const kinds = new Uint8Array(capacity);
    kinds.set(this.childKind);
    this.childKind = kinds;
    this.active = new Int32Array(capacity);
  }
}

/**
 * A container that places its children in a row or a column, with the props of CSS flexbox and the sizing of Clay
 * (see docs/UI_PLAN.md). The player lays it out every frame, before drawing: each child's `layoutX` / `layoutY`
 * is written, so a child's own `transform` still moves it within its slot. A `Shape`, `Sprite` or `Text` keeps its
 * own size; only a `<Flex>` is resized by layout.
 */
export class Flex<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  direction: FlexDirection;
  alignItems: FlexAlignItems;
  justifyContent: FlexJustifyContent;
  gap: number;
  padding: number | undefined;
  paddingX: number | undefined;
  paddingY: number | undefined;
  paddingTop: number | undefined;
  paddingRight: number | undefined;
  paddingBottom: number | undefined;
  paddingLeft: number | undefined;
  width: FlexSizing;
  height: FlexSizing;
  minWidth: number | undefined;
  maxWidth: number | undefined;
  minHeight: number | undefined;
  maxHeight: number | undefined;
  background: string | undefined;
  borderWidth: number;
  borderColor: string | undefined;
  borderRadius: number;
  hoverBackground: string | undefined;
  hoverBorderColor: string | undefined;
  focusBackground: string | undefined;
  focusBorderColor: string | undefined;
  pressedBackground: string | undefined;
  pressedBorderColor: string | undefined;
  disabledBackground: string | undefined;
  disabledBorderColor: string | undefined;
  disabled: boolean;
  float: boolean;
  anchor: FlexAnchor;
  to: FlexAnchor;
  offsetX: number;
  offsetY: number;
  onPress: (() => void) | undefined;
  onPointerEnter: (() => void) | undefined;
  onPointerLeave: (() => void) | undefined;
  pressKey: string | undefined;
  focusable: boolean;
  autoFocus: boolean;
  onFocus: (() => void) | undefined;
  onBlur: (() => void) | undefined;
  /** Layout's working numbers (see `FlexBox`); `box.size` is the size the box was laid out at, last frame. */
  readonly box = new FlexBox();

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: FlexProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.direction = hostProps.direction ?? "row";
    this.alignItems = hostProps.alignItems ?? "stretch";
    this.justifyContent = hostProps.justifyContent ?? "start";
    this.gap = hostProps.gap ?? 0;
    this.padding = hostProps.padding;
    this.paddingX = hostProps.paddingX;
    this.paddingY = hostProps.paddingY;
    this.paddingTop = hostProps.paddingTop;
    this.paddingRight = hostProps.paddingRight;
    this.paddingBottom = hostProps.paddingBottom;
    this.paddingLeft = hostProps.paddingLeft;
    this.width = hostProps.width ?? "fit";
    this.height = hostProps.height ?? "fit";
    this.minWidth = hostProps.minWidth;
    this.maxWidth = hostProps.maxWidth;
    this.minHeight = hostProps.minHeight;
    this.maxHeight = hostProps.maxHeight;
    this.background = hostProps.background;
    this.borderWidth = hostProps.borderWidth ?? 0;
    this.borderColor = hostProps.borderColor;
    this.borderRadius = hostProps.borderRadius ?? 0;
    this.hoverBackground = hostProps.hoverBackground;
    this.hoverBorderColor = hostProps.hoverBorderColor;
    this.focusBackground = hostProps.focusBackground;
    this.focusBorderColor = hostProps.focusBorderColor;
    this.pressedBackground = hostProps.pressedBackground;
    this.pressedBorderColor = hostProps.pressedBorderColor;
    this.disabledBackground = hostProps.disabledBackground;
    this.disabledBorderColor = hostProps.disabledBorderColor;
    this.disabled = hostProps.disabled ?? false;
    this.float = hostProps.float ?? false;
    this.anchor = hostProps.anchor ?? "top-left";
    this.to = hostProps.to ?? "top-left";
    this.offsetX = hostProps.offsetX ?? 0;
    this.offsetY = hostProps.offsetY ?? 0;
    this.onPress = hostProps.onPress;
    this.onPointerEnter = hostProps.onPointerEnter;
    this.onPointerLeave = hostProps.onPointerLeave;
    this.pressKey = hostProps.pressKey;
    this.focusable = hostProps.focusable ?? false;
    this.autoFocus = hostProps.autoFocus ?? false;
    this.onFocus = hostProps.onFocus;
    this.onBlur = hostProps.onBlur;
  }

  /**
   * Whether the world-space point is on the box as it was laid out and drawn: taken back through the box's position,
   * rotation and scale, like `Pointer.contains`. A box with no size, or a zero scale, is never hit.
   */
  contains(x: number, y: number): boolean {
    const width = this.box.size[0] as number;
    const height = this.box.size[1] as number;
    const t = this.worldTransform();
    if (!(width > 0 && height > 0) || t.scaleX === 0 || t.scaleY === 0) return false;
    const dx = x - t.x;
    const dy = y - t.y;
    const cos = Math.cos(t.rotation);
    const sin = Math.sin(t.rotation);
    const localX = (dx * cos + dy * sin) / t.scaleX;
    const localY = (dy * cos - dx * sin) / t.scaleY;
    return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
  }

  /** The middle of the laid-out box, in its layer's coordinates (scale and rotation ignored). */
  focusPoint(): { x: number; y: number } {
    const t = this.worldTransform();
    return { x: t.x + (this.box.size[0] as number) / 2, y: t.y + (this.box.size[1] as number) / 2 };
  }
}
