import { GameObject } from "../GameObject.ts";

/** Where a `<Text>` sits inside its `width`. The manifest's `intrinsicLiterals` reads this list. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/**
 * Fonts built into the engine, named like an asset but with the `tse:` prefix: `<Text font="tse:small">` or `<Game font="tse:small">`.
 * `tse:small` is 3×5 glyphs in 4×6 cells (a 64×36 sheet), so text is 6 pixels a line: for 320×180 and smaller screens.
 */
export const BUILTIN_FONTS = ["tse:small"] as const;
export type BuiltinFont = (typeof BUILTIN_FONTS)[number];

/** Whether a font or image name is an engine built-in's (`tse:…`), whether or not one by that name exists. */
export function isBuiltinName(name: string): boolean {
  return name.startsWith("tse:");
}

export interface TextProps {
  text: string;
  /** Pixels. Default: the game's `<Game textSize>`, else 16. */
  size?: number;
  /** A CSS color. Default: the game's `<Game textColor>`, else white. */
  color?: string;
  /**
   * The width in pixels of the box the text sits in, for layout and for `align`. Without it the box is the text's own
   * width, which `align` cannot move within. A text wider than its box overflows it.
   */
  width?: number;
  /**
   * Wrap the text to lines no wider than this many pixels: it breaks at spaces, and inside a word only when the word alone is too wide.
   * A `\n` always breaks. With no `maxWidth` the text is one line (and `\n` still breaks). Each line is drawn on its own; `align` applies
   * to each, inside `width`, else inside `maxWidth`.
   */
  maxWidth?: number;
  /** Extra pixels between wrapped lines, on top of a line's own height. Default 0. */
  lineGap?: number;
  /**
   * Draw only the first `reveal` characters (a dialogue box typing its page out), but lay out the whole text, so the box does not
   * grow or rewrap as it appears. The game's rules count it up; the engine has no timer for it. Default: all of it.
   */
  reveal?: number;
  /** Where the text sits inside `width`: `"left"` (the default), `"center"` or `"right"`. */
  align?: TextAlign;
  /**
   * A bitmap font: the name of an image holding the glyphs of the ASCII characters 32 to 127 in a grid of 16 columns and 6 rows,
   * left to right, then down. Each glyph cell is the image's width ÷ 16 by its height ÷ 6, and the text is drawn from them with
   * no smoothing, so it stays crisp. `size` is then the height in pixels of a glyph cell: a whole multiple of the cell's height
   * keeps pixels square. `"tse:small"` is a font built into the engine (no file): 3×5 glyphs in 4×6 cells, for small screens.
   * Without `font` the text uses the default font.
   */
  font?: string;
  /**
   * A CSS colour for a shadow: the text drawn again under itself, `shadowX` and `shadowY` pixels away, in this colour. Default none.
   * It does not take room in a layout, so leave padding for it.
   */
  shadow?: string;
  /** Where the shadow falls, in pixels right and down from the text (negative goes left and up). Default 1 and 1. */
  shadowX?: number;
  shadowY?: number;
  /**
   * A CSS colour for an outline: the text drawn again under itself in this colour at every pixel within `outlineWidth` of where it
   * is, so each letter has an edge of that colour. Default none. Use an opaque colour: a see-through one shows through where the
   * copies overlap. A shadow falls from the outlined shape. Like a shadow it takes no room in a layout.
   */
  outline?: string;
  /** How many pixels thick the outline is: 1 to 3 (more is drawn as 3, as each pixel of thickness is more copies of the text). Default 1. */
  outlineWidth?: number;
}

const DEFAULT_TEXT_SIZE = 16;
const DEFAULT_TEXT_COLOR = "white";

/** The game's text defaults (`<Game textSize textColor>`): what a `<Text>` without its own `size` or `color` uses. */
let defaults: { size: number | undefined; color: string | undefined } = { size: undefined, color: undefined };

/**
 * Set the game's text defaults: the player does, from its root `<Game textSize textColor>`, before the tree is built and on each
 * reload. Written once at the root, as `font` is: not inherited from containers.
 */
export function setTextDefaults(next: { readonly size?: number | undefined; readonly color?: string | undefined }): void {
  defaults = { size: next.size, color: next.color };
}

/**
 * A line of text for HUDs, labels and menus. The mock draws nothing: a
 * renderer reads `text`, `size`, `color` and `worldTransform()`. In JSX the
 * content is the element's children (`<Text>Score: {score}</Text>`), which
 * the compiler sets as this `text` field, updated in place.
 */
export class Text<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  text: string;
  width: number | undefined;
  align: TextAlign;
  font: string | undefined;
  shadow: string | undefined;
  shadowX: number;
  shadowY: number;
  outline: string | undefined;
  outlineWidth: number;
  maxWidth: number | undefined;
  lineGap: number;
  reveal: number | undefined;

  #size: number | undefined = undefined;
  #color: string | undefined = undefined;

  /**
   * The height of a line in pixels. Without one given: the game's `textSize`, else 16, or for a bitmap font its cell's height
   * (see `sized`).
   */
  get size(): number {
    return this.#size ?? defaults.size ?? DEFAULT_TEXT_SIZE;
  }

  /** `undefined` (an optional prop passed on unset) goes back to no size given. */
  set size(value: number | undefined) {
    this.#size = value;
  }

  /**
   * Whether a size was given, by the text or by the game's `textSize`. Text in a bitmap font without one is drawn at the font's
   * own cell height, one pixel per pixel.
   */
  get sized(): boolean {
    return this.#size !== undefined || defaults.size !== undefined;
  }

  /** A CSS colour. Without one given: the game's `textColor`, else white. */
  get color(): string {
    return this.#color ?? defaults.color ?? DEFAULT_TEXT_COLOR;
  }

  /** `undefined` (an optional prop passed on unset) goes back to no colour given. */
  set color(value: string | undefined) {
    this.#color = value;
  }

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TextProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.text = hostProps.text;
    if (hostProps.size !== undefined) this.size = hostProps.size;
    this.color = hostProps.color;
    this.width = hostProps.width;
    this.align = hostProps.align ?? "left";
    this.font = hostProps.font;
    this.shadow = hostProps.shadow;
    this.shadowX = hostProps.shadowX ?? 1;
    this.shadowY = hostProps.shadowY ?? 1;
    this.outline = hostProps.outline;
    this.outlineWidth = hostProps.outlineWidth ?? 1;
    this.maxWidth = hostProps.maxWidth;
    this.lineGap = hostProps.lineGap ?? 0;
    this.reveal = hostProps.reveal;
  }
}
