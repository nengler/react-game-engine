import { GameObject } from "../GameObject.ts";

/** The main axis of a `<Flex>`. The manifest's `intrinsicLiterals` reads these lists, so the compiler cannot drift from them. */
export const FLEX_DIRECTIONS = ["row", "column"] as const;
export type FlexDirection = (typeof FLEX_DIRECTIONS)[number];

/** Where children sit across the main axis. `"stretch"` makes a `<Flex>` child with a `"fit"` cross size take the whole cross size. */
export const FLEX_ALIGN_ITEMS = ["start", "center", "end", "stretch"] as const;
export type FlexAlignItems = (typeof FLEX_ALIGN_ITEMS)[number];

/** How children and the free space share the main axis. */
export const FLEX_JUSTIFY_CONTENT = ["start", "center", "end", "space-between", "space-around", "space-evenly"] as const;
export type FlexJustifyContent = (typeof FLEX_JUSTIFY_CONTENT)[number];

/**
 * How big a `<Flex>` is along one axis: `"fit"` (its children plus padding and gaps), `"grow"` (its fit size plus a
 * share of its parent's free space), a number of pixels, or a percentage of its parent's inner size (`"50%"`).
 */
export type FlexSizing = number | "fit" | "grow" | `${number}%`;

export interface FlexProps {
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
  /** A CSS colour: draw a filled rectangle behind the children, the size of the box. Default none. */
  background?: string;
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
  }
}
