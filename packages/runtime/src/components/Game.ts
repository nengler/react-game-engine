import { Entity, type EntityProps } from "./Entity.ts";

/** What `state={useGame}` hands over: the game state a `createGameState` made. The player resets its store when the game starts. */
export interface GameStateHandle {
  readonly store: { reset(): void };
}

export interface GameProps extends EntityProps {
  /** The window's title. Default: the player's `title`, else `"react-game-engine"`. */
  title?: string;
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
  /** The game's state: `state={useGame}`, the store from `GameState.ts`. It starts from its initial values with the game. */
  state?: GameStateHandle;
}

/**
 * The root of a game, and where its configuration lives: the window (title, resizing, vsync, filtering), the
 * background colour, the assets folder, and the game state. It has no size: the game's resolution is a `<Screen
 * width height>` (put it inside, as its only child), and the window's size is the player's. It is an `Entity` with those extra props, so a component whose root
 * is `<Game …>` extends it. It is optional: a game with any other root gets the default settings (and whatever the player was
 * configured with); a `<Game>` root overrides them, each prop only where it is written.
 *
 * Its settings are read before the tree is built, so they are literals (`title="x"`, never state), and a `<Game>`
 * is only ever a component's root, never a child. A field is `undefined` where its prop was not written.
 */
export class Game<P extends object = {}> extends Entity<P> {
  static override readonly intrinsic = true;

  title: string | undefined;
  background: string | undefined;
  assets: string | undefined;
  resizable: boolean | undefined;
  vsync: boolean | undefined;
  smooth: boolean | undefined;
  state: GameStateHandle | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: GameProps = {}, props?: P, defaults?: Partial<P>) {
    super(hostProps, props, defaults);
    this.title = hostProps.title;
    this.background = hostProps.background;
    this.assets = hostProps.assets;
    this.resizable = hostProps.resizable;
    this.vsync = hostProps.vsync;
    this.smooth = hostProps.smooth;
    this.state = hostProps.state;
  }
}
