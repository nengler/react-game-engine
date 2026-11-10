import { Game, World, getSoundSink, setSoundSink, resetGameState, type GameObject, type Pointer, type SoundSink, type ViewTransform } from "@rge/runtime";
import type { Backend, WindowConfig } from "./backend.ts";
import { MAGENTA, parseColor } from "./color.ts";
import { CollisionTracker } from "./collide.ts";
import { FrameBuilder } from "./draw.ts";
import { PlayerInput } from "./input.ts";
import { onScreen, type ScreenPlacement } from "./screen.ts";
import { RGE_IN_DT, RGE_IN_HEIGHT, RGE_IN_QUIT, RGE_IN_WIDTH, RGE_KEY_PRESSED, KEY_INDEX } from "./protocol.ts";
import { Warner } from "./warn.ts";

/** The window a game gets when neither its `<Game>` root nor the player's config say otherwise. */
export const DEFAULT_WINDOW = { width: 640, height: 360, title: "react-game-engine" } as const;

/**
 * What the player is configured with. Everything but `root` is optional, and is the fallback for what the root's own
 * `<Game>` leaves unset: a setting is the `<Game>` prop if it is written, else this, else the default.
 */
export interface PlayerConfig extends Partial<WindowConfig> {
  /**
   * Builds the root object. It is built **before** the window opens, because a root that is a `<Game>` says what window to
   * open; sounds it creates are recorded and preloaded as soon as the window is open.
   */
  readonly root: () => GameObject;
  /** A CSS colour. Default `"black"`. */
  readonly background?: string;
  /** Folder that image and sound names are relative to. Default `"assets"`. */
  readonly assets?: string;
  /** Where warnings go. Default `console.warn`. */
  readonly warn?: (message: string) => void;
}

export interface Player {
  readonly world: World;
  /** Run one frame. Returns false once the window has asked to close (that frame is still drawn). */
  step(): boolean;
  /** Close the window and detach from the runtime. Safe to call twice. */
  close(): void;
}

/** The longest step a frame may simulate: a stall (a breakpoint, a dragged window) must not teleport things. */
export const MAX_DT = 0.1;

const LEFT_BUTTON = KEY_INDEX.get("MouseLeft") as number;

/**
 * Open the window and build the game. Each `step()` is one frame, in a fixed order:
 *
 * 1. a left press goes to the topmost `Pointer` drawn under the mouse last frame (`world.reportPress`), unless it
 *    landed on the bars around a root `<Screen>`;
 * 2. `world.tick(dt, input)`: `useInput`, `useUpdate`, renders, structure;
 * 3. the tree is walked into draw records (and the camera's view is taken);
 * 4. colliders that started touching are reported (`world.reportCollision`; see `CollisionTracker`), so what
 *    their callbacks change is rendered by the next tick;
 * 5. the backend draws and presents the frame, then writes the next frame's input.
 *
 * The press uses last frame's pointers because that is what the player was looking at when they
 * clicked, and the input it carries is the state polled at the end of last frame.
 */
export function createPlayer(backend: Backend, config: PlayerConfig): Player {
  const warner = new Warner(config.warn);

  // Build the root first: if it is a `<Game>`, its props say what window to open. Sounds it creates only record their
  // paths for now; they are loaded below, once the window is open. Each game starts from the game state's initial
  // values, whatever an earlier player in this process left behind.
  const preload: string[] = [];
  const collector: SoundSink = { load: (name) => void preload.push(name), play: () => {} };
  setSoundSink(collector);
  resetGameState();
  let root: GameObject;
  try {
    root = config.root();
  } catch (error) {
    if (getSoundSink() === collector) setSoundSink(null);
    throw error;
  }
  const game = root instanceof Game ? root : null;
  // Each setting: the `<Game>` prop where it is written, else the player's config, else the default.
  const width = game?.width ?? config.width ?? DEFAULT_WINDOW.width;
  const height = game?.height ?? config.height ?? DEFAULT_WINDOW.height;
  const assets = game?.assets ?? config.assets ?? "assets";
  const background = resolveBackground(game?.background ?? config.background ?? "black", warner);

  backend.open({
    width,
    height,
    title: game?.title ?? config.title ?? DEFAULT_WINDOW.title,
    resizable: game?.resizable ?? config.resizable,
    vsync: game?.vsync ?? config.vsync,
    hidden: config.hidden,
    smooth: game?.smooth ?? config.smooth,
  });

  const input = new PlayerInput(warner);
  input.values[RGE_IN_WIDTH] = width;
  input.values[RGE_IN_HEIGHT] = height;
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    measureText: backend.measureText ? (text, size) => backend.measureText!(text, size) : undefined,
    textureSize: backend.textureSize ? (handle) => backend.textureSize!(handle) : undefined,
    assets,
    warn: config.warn,
  });
  const sink = createSoundSink(backend, assets, warner);
  const world = new World();
  const collisions = new CollisionTracker();
  let pointers: readonly Pointer[] = [];
  let hudPointersFrom = 0;
  let hudView: ViewTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let screen: ScreenPlacement | null = null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (getSoundSink() === sink) setSoundSink(null);
    backend.close();
  };

  setSoundSink(sink);
  for (const name of preload) sink.load(name);
  try {
    world.mount(root);
  } catch (error) {
    close();
    throw error;
  }

  const dispatchPress = (): void => {
    if (((input.keys[LEFT_BUTTON] as number) & RGE_KEY_PRESSED) === 0) return;
    if (screen !== null && !onScreen(screen, input.screenX, input.screenY)) return;
    const at = input.worldPoint(input.screenX, input.screenY);
    const hudAt = input.pointThrough(hudView, input.screenX, input.screenY);
    // The last pointer drawn is on top, so it gets the press; one press, one pointer. A HUD is drawn after the world, so its pointers come last.
    for (let i = pointers.length - 1; i >= 0; i--) {
      const point = i >= hudPointersFrom ? hudAt : at;
      if (world.reportPress(pointers[i] as Pointer, point.x, point.y)) return;
    }
  };

  return {
    world,
    step(): boolean {
      if (closed) throw new Error("The player is closed.");
      dispatchPress();
      const dt = input.values[RGE_IN_DT] as number;
      world.tick(dt > 0 ? Math.min(dt, MAX_DT) : 0, input);
      const built = builder.build(world.root, input.width, input.height);
      pointers = built.pointers;
      hudPointersFrom = built.hudPointersFrom;
      hudView = built.hudView;
      screen = built.screen;
      input.view = built.view;
      collisions.update(world, built.colliders);
      backend.frame(background, built.list.records, built.list.length, built.list.texts, input.values, input.keys);
      return input.values[RGE_IN_QUIT] === 0;
    },
    close,
  };
}

/** Open the window, step until it is closed, then clean up (also when the game throws). */
export function run(backend: Backend, config: PlayerConfig): void {
  const player = createPlayer(backend, config);
  try {
    while (player.step());
  } finally {
    player.close();
  }
}

function resolveBackground(css: string, warner: Warner): number {
  const color = parseColor(css);
  if (color !== null) return color;
  warner.once(`background:${css}`, `Cannot read the background colour '${css}': using magenta.`);
  return MAGENTA;
}

/** Sounds load through the backend once per path (a failed load is remembered too) and play by handle. */
function createSoundSink(backend: Backend, assets: string, warner: Warner): SoundSink {
  const handles = new Map<string, number>();
  const handleFor = (name: string): number => {
    const path = `${assets}/${name}`;
    let handle = handles.get(path);
    if (handle === undefined) {
      handle = backend.loadSound(path);
      handles.set(path, handle);
      if (handle < 0) warner.once(`sound:${path}`, `Could not load the sound '${path}': it will not play.`);
    }
    return handle;
  };
  return {
    load: (name) => void handleFor(name),
    play: (name) => {
      const handle = handleFor(name);
      if (handle >= 0) backend.playSound(handle);
    },
  };
}
