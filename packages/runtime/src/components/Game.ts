import type { Controls } from "../input.ts";
import { Entity, type EntityProps } from "./Entity.ts";

export interface GameProps extends EntityProps {
  /**
   * The game's id, a literal of 1 to 64 letters, digits, `_` and `-` (`id="bramble"`): it names the folder where its save and settings are
   * kept. Without it nothing is saved.
   */
  id?: string;
  /** The window's title. Default: the player's `title`, else `"tse"`. */
  title?: string;
  /** The window's width in pixels. Not the game's resolution: that is a `<Screen width height>` inside it. Default: the player's, else 640. */
  width?: number;
  /** The window's height in pixels. Default: the player's, else 360. */
  height?: number;
  /** A CSS colour. Default `"black"`. */
  background?: string;
  /** The folder image and sound names are relative to. Default `"assets"`. */
  assets?: string;
  /** Default true. */
  resizable?: boolean;
  /** Default true. */
  vsync?: boolean;
  /** Bilinear texture filtering. Default false, which keeps pixel art sharp. */
  smooth?: boolean;
  /**
   * The key that toggles full screen (a borderless window at the desktop's size), by the name `useInput` uses.
   * Default `"F11"`; `false` turns the key off. Alt + Enter always works too.
   */
  fullscreenKey?: string | false;
  /**
   * How a pixel-perfect `<Screen>` is scaled up when its scale is not a whole number (`fit="contain"` or a window of any size): `"nearest"`
   * (the default) makes some game pixels one window pixel wider than others, which shimmers when things move slowly; `"sharp"` scales up by
   * the next whole number first and then down with a bilinear filter, so edges stay crisp and every game pixel looks the same size.
   */
  upscale?: "nearest" | "sharp";
  /** Show the frame rate and the script time of a frame in the top left corner, over everything: a debugging aid. Default false; the key `fpsKey` turns it on and off while playing. */
  showFps?: boolean;
  /** The key that toggles the frame-rate counter, by the name `useInput` uses. Default `"F3"`; `false` turns the key off. */
  fpsKey?: string | false;
  /**
   * The bitmap font every `<Text>` without its own `font` uses (an image in the assets folder, as `<Text font>` takes). Default
   * none: such text uses the built-in font.
   */
  font?: string;
  /**
   * How far the gamepad's left stick must be pushed, 0 to 1, before `"PadLeft"`, `"PadRight"`, `"PadUp"` and `"PadDown"` count as
   * held. Default 0.35. (The buttons are `"PadA"`, `"PadB"`, `"PadX"`, `"PadY"`, `"PadLB"`, `"PadRB"`, `"PadBack"` and `"PadStart"`,
   * and the d-pad counts as the same four directions; use them in `useInput` as any key.)
   */
  gamepadDeadzone?: number;
  /**
   * Run `useUpdate` at a fixed rate, in steps per second (`fixedStep={60}`), from an accumulator: a frame runs as many whole steps as
   * the time since the last frame holds (none on a fast monitor, two on a slow frame), each with the same `dt`, and drawing stays once
   * per frame. A press that lands between steps is seen by the next step, never lost. Default: off, one update per frame with the
   * frame's own time. See "Fixed timestep" in DESIGN.md.
   */
  fixedStep?: number;
  /**
   * The game's actions (`controls={controls}`, a `createControls({ jump: ["Z", "PadA"], … })` kept in a module): every
   * `input.pressed("jump")` then means any of the action's keys.
   */
  controls?: Controls;
  /**
   * How fast game time runs: with a fixed step, `2` runs two steps a frame (each the same `dt`, so the game plays exactly as at
   * `1`, only faster: a fast-forward button). Read every frame, so it may be state (`timeScale={speed}`). Default 1.
   */
  timeScale?: number;
  /**
   * The key that turns the development layout overlay on and off, under `tse dev` (outlines of every `<Flex>`, collider and
   * pointer). Default `"F1"`; `false` turns the key off. A packaged game never has the overlay.
   */
  overlayKey?: string | false;
  /** The size of every `<Text>` that does not set its own (`<Text size>`), as `font` is its font. Default: 16. */
  textSize?: number;
  /** The colour of every `<Text>` that does not set its own (`<Text color>`). Default: white. */
  textColor?: string;
  /**
   * While true, no `useUpdate` runs: the game stands still. `useInput`, presses and the focus still work, so a pause menu can
   * unpause it. Read every frame, so it may be state (`paused={paused}`). Default false.
   */
  paused?: boolean;
}

/**
 * The root of a game, and where its configuration lives: the window (title, size, resizing, vsync, filtering), the
 * background colour, the assets folder and the controls. Its `width` and `height` are the **window's** size; the
 * game's resolution, the size it is drawn at inside the window, is a `<Screen width height>` (put it inside, as its
 * only child). It is an `Entity` with those extra props, so a component whose root
 * is `<Game …>` extends it. It is optional: a game with any other root gets the default settings (and whatever the player was
 * configured with); a `<Game>` root overrides them, each prop only where it is written.
 *
 * Its settings are read before the tree is built, so they are literals (`width={640}`, never state), except `timeScale` and
 * `paused`, which are read every frame; a `<Game>`
 * is only ever a component's root, never a child. A field is `undefined` where its prop was not written.
 */
export class Game<P extends object = {}> extends Entity<P> {
  static override readonly intrinsic = true;

  id: string | undefined;
  title: string | undefined;
  width: number | undefined;
  height: number | undefined;
  background: string | undefined;
  assets: string | undefined;
  resizable: boolean | undefined;
  vsync: boolean | undefined;
  smooth: boolean | undefined;
  fullscreenKey: string | false | undefined;
  fixedStep: number | undefined;
  gamepadDeadzone: number | undefined;
  upscale: "nearest" | "sharp" | undefined;
  showFps: boolean | undefined;
  fpsKey: string | false | undefined;
  font: string | undefined;
  controls: Controls | undefined;
  timeScale: number | undefined;
  paused: boolean | undefined;
  textSize: number | undefined;
  textColor: string | undefined;
  overlayKey: string | false | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: GameProps = {}, props?: P, defaults?: Partial<P>) {
    super(hostProps, props, defaults);
    this.id = hostProps.id;
    this.title = hostProps.title;
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.background = hostProps.background;
    this.assets = hostProps.assets;
    this.resizable = hostProps.resizable;
    this.vsync = hostProps.vsync;
    this.smooth = hostProps.smooth;
    this.fullscreenKey = hostProps.fullscreenKey;
    this.fixedStep = hostProps.fixedStep;
    this.gamepadDeadzone = hostProps.gamepadDeadzone;
    this.upscale = hostProps.upscale;
    this.showFps = hostProps.showFps;
    this.fpsKey = hostProps.fpsKey;
    this.font = hostProps.font;
    this.controls = hostProps.controls;
    this.timeScale = hostProps.timeScale;
    this.paused = hostProps.paused;
    this.textSize = hostProps.textSize;
    this.textColor = hostProps.textColor;
    this.overlayKey = hostProps.overlayKey;
  }
}
