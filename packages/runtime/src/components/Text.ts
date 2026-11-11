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
  /**
   * A bitmap font: the name of an image holding the glyphs of the ASCII characters 32 to 127 in a grid of 16 columns and 6 rows,
   * left to right, then down. Each glyph cell is the image's width ÷ 16 by its height ÷ 6, and the text is drawn from them with
   * no smoothing, so it stays crisp. `size` is then the height in pixels of a glyph cell: a whole multiple of the cell's height
   * keeps pixels square. Without `font` the text uses the built-in font.
   */
  font?: string;
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
  color: string;
  width: number | undefined;
  align: TextAlign;
  font: string | undefined;

  #size = DEFAULT_TEXT_SIZE;
  #sized = false;

  /** The height of a line in pixels. Without one given: 16, or for a bitmap font its cell's height (see `sized`). */
  get size(): number {
    return this.#size;
  }

  set size(value: number) {
    this.#size = value;
    this.#sized = true;
  }

  /** Whether a size was given. Text in a bitmap font without one is drawn at the font's own cell height, one pixel per pixel. */
  get sized(): boolean {
    return this.#sized;
  }

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TextProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.text = hostProps.text;
    if (hostProps.size !== undefined) this.size = hostProps.size;
    this.color = hostProps.color ?? DEFAULT_TEXT_COLOR;
    this.width = hostProps.width;
    this.align = hostProps.align ?? "left";
    this.font = hostProps.font;
  }
}
