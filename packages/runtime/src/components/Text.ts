import { GameObject } from "../GameObject.ts";

/** Where a `<Text>` sits inside its `width`. The manifest's `intrinsicLiterals` reads this list. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export interface TextProps {
  text: string;
  /** Pixels. Default 16. */
  size?: number;
  /** A CSS color. Default white. */
  color?: string;
  /**
   * The width in pixels of the box the text sits in, for layout and for `align`. Without it the box is the text's own
   * width, which `align` cannot move within. A text wider than its box overflows it.
   */
  width?: number;
  /** Where the text sits inside `width`: `"left"` (the default), `"center"` or `"right"`. */
  align?: TextAlign;
}

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TEXT_COLOR = "white";

/**
 * A line of text for HUDs, labels and menus. The mock draws nothing: a
 * renderer reads `text`, `size`, `color` and `worldTransform()`. In JSX the
 * content is the element's text (`<Text>Score: {score}</Text>`) or its `text`
 * prop; either way it is this `text` field, updated in place.
 */
export class Text<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  text: string;
  size: number;
  color: string;
  width: number | undefined;
  align: TextAlign;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TextProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.text = hostProps.text;
    this.size = hostProps.size ?? DEFAULT_TEXT_SIZE;
    this.color = hostProps.color ?? DEFAULT_TEXT_COLOR;
    this.width = hostProps.width;
    this.align = hostProps.align ?? "left";
  }
}
