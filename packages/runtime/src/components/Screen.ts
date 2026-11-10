import { GameObject } from "../GameObject.ts";

/** How a `<Screen>` is scaled into the window. The manifest's `intrinsicLiterals` reads this list, so the compiler cannot drift from it. */
export const SCREEN_FITS = ["integer", "contain", "stretch"] as const;
export type ScreenFit = (typeof SCREEN_FITS)[number];

export interface ScreenProps {
  /** The game's resolution, in game pixels: everything inside is drawn at this size, then scaled to the window. */
  width: number;
  height: number;
  /**
   * How the game is scaled into the window. `"integer"` (the default): the largest whole-number scale that
   * fits, so every game pixel is the same number of window pixels; `"contain"`: the largest scale that fits;
   * `"stretch"`: each axis on its own, filling the window. The leftover space is filled with `border`.
   */
  fit?: ScreenFit;
  /**
   * Draw at the game's resolution and scale the finished frame up (chunky pixels, however things turn), rather
   * than drawing at the window's resolution through a scale. Default true.
   */
  pixelPerfect?: boolean;
  /** A CSS colour for the bars around the game when it does not fill the window. Default black. */
  border?: string;
}

const DEFAULT_SCREEN_FIT: ScreenFit = "integer";
const DEFAULT_SCREEN_BORDER = "black";

/**
 * The game's screen: a fixed resolution (`<Screen width={320} height={180}>`), scaled to fit the window
 * whatever size the window is. It only means this as the root of the game, where the player looks for it;
 * anywhere else it is a plain container. Everything inside is in game pixels: transforms, the camera's view
 * (centred on the screen's middle) and the mouse. The window's own size stays the player's business.
 */
export class Screen<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  fit: ScreenFit;
  pixelPerfect: boolean;
  border: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ScreenProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.fit = hostProps.fit ?? DEFAULT_SCREEN_FIT;
    this.pixelPerfect = hostProps.pixelPerfect ?? true;
    this.border = hostProps.border ?? DEFAULT_SCREEN_BORDER;
  }
}
