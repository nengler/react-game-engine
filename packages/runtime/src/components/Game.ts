import { Entity, type EntityProps } from "./Entity.ts";

/** What `state={useGame}` hands over: the game state a `createGameState` made. The player resets its store when the game starts. */
export interface GameStateHandle {
  readonly store: { reset(): void };
}

export interface GameProps extends EntityProps {
  /** The window's title. Default: the player's `title`, else `"react-game-engine"`. */
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
  /** The game's state: `state={useGame}`, the store from `GameState.ts`. It starts from its initial values with the game. */
  state?: GameStateHandle;
}

/**
 * The root of a game, and where its configuration lives: the window (title, size, resizing, vsync, filtering), the
 * background colour, the assets folder, and the game state. Its `width` and `height` are the **window's** size; the
 * game's resolution, the size it is drawn at inside the window, is a `<Screen width height>` (put it inside, as its
 * only child). It is an `Entity` with those extra props, so a component whose root
 * is `<Game …>` extends it. It is optional: a game with any other root gets the default settings (and whatever the player was
 * configured with); a `<Game>` root overrides them, each prop only where it is written.
 *
 * Its settings are read before the tree is built, so they are literals (`width={640}`, never state), and a `<Game>`
 * is only ever a component's root, never a child. A field is `undefined` where its prop was not written.
 */
export class Game<P extends object = {}> extends Entity<P> {
  static override readonly intrinsic = true;

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
  state: GameStateHandle | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: GameProps = {}, props?: P, defaults?: Partial<P>) {
    super(hostProps, props, defaults);
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
    this.state = hostProps.state;
  }
}
