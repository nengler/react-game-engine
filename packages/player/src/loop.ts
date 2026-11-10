import { Game, World, getSoundSink, setSoundSink, resetGameState, type GameObject, type Pressable, type SoundSink, type ViewTransform } from "@rge/runtime";
import type { Backend, WindowConfig } from "./backend.ts";
import { MAGENTA, parseColor } from "./color.ts";
import { CollisionTracker } from "./collide.ts";
import { FrameBuilder, rootScreen } from "./draw.ts";
import { PlayerInput } from "./input.ts";
import { onScreen, type ScreenPlacement } from "./screen.ts";
import { KEYS, RGE_IN_DT, RGE_IN_HEIGHT, RGE_IN_QUIT, RGE_IN_WIDTH, RGE_KEY_DOWN, RGE_KEY_PRESSED, RGE_KEY_RELEASED, KEY_INDEX } from "./protocol.ts";
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
  /** The key that toggles full screen, as the `<Game>` prop of the same name; `false` turns it off. Default `"F11"` (Alt + Enter always works). */
  readonly fullscreenKey?: string | false;
  /** Steps per second for `useUpdate`, as the `<Game>` prop `fixedStep`; unset runs one update per frame. */
  readonly fixedStep?: number;
  /** The gamepad stick's dead zone, as the `<Game>` prop `gamepadDeadzone`. */
  readonly gamepadDeadzone?: number;
  /** How a pixel-perfect screen is scaled up at a scale that is not a whole number, as the `<Game>` prop `upscale`. */
  readonly upscale?: "nearest" | "sharp";
  /** The frame-rate counter, as the `<Game>` props `showFps` and `fpsKey`. */
  readonly showFps?: boolean;
  readonly fpsKey?: string | false;
  /** A CSS colour. Default `"black"`. */
  readonly background?: string;
  /** Folder that image and sound names are relative to. Default `"assets"`. */
  readonly assets?: string;
  /** Where warnings go. Default `console.warn`. */
  readonly warn?: (message: string) => void;
  /** Reuse last frame's draw records for what has not changed; `"check"` also rebuilds each frame and throws on a difference. See `FrameBuilderOptions.retain`. Default `true`. */
  readonly retain?: boolean | "check";
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

/** The most fixed steps one frame may run: a stall must not be followed by a burst that stalls again. The rest of the time is dropped. */
export const MAX_STEPS_PER_FRAME = 8;

/** How many times larger than a root `<Screen>` the window opens when nothing sets its size. */
export const DEFAULT_SCREEN_SCALE = 3;

const LEFT_BUTTON = KEY_INDEX.get("MouseLeft") as number;
const ENTER_KEY = KEY_INDEX.get("Enter") as number;
const ALT_KEY = KEY_INDEX.get("Alt") as number;

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
  const preloadMusic: string[] = [];
  const collector: SoundSink = { load: (name) => void preload.push(name), play: () => {}, loadMusic: (name) => void preloadMusic.push(name) };
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
  // With nothing set, a game with a `<Screen>` opens at 3 × its resolution, so each game pixel is 3 × 3 window pixels.
  const screen0 = rootScreen(root);
  const fromScreen = screen0 !== null && screen0.width > 0 && screen0.height > 0 && Number.isFinite(screen0.width) && Number.isFinite(screen0.height);
  const width = game?.width ?? config.width ?? (fromScreen ? Math.round(screen0.width * DEFAULT_SCREEN_SCALE) : DEFAULT_WINDOW.width);
  const height = game?.height ?? config.height ?? (fromScreen ? Math.round(screen0.height * DEFAULT_SCREEN_SCALE) : DEFAULT_WINDOW.height);
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
    sharp: (game?.upscale ?? config.upscale) === "sharp" ? true : undefined,
  });

  const deadzone = game?.gamepadDeadzone ?? config.gamepadDeadzone;
  if (deadzone !== undefined) backend.setGamepadDeadzone?.(deadzone);
  const stepHz = game?.fixedStep ?? config.fixedStep;
  const fixedDt = stepHz === undefined ? 0 : 1 / stepHz;
  if (stepHz !== undefined && !(stepHz > 0 && Number.isFinite(stepHz))) throw new RangeError(`fixedStep must be a positive number of steps per second, not ${stepHz}.`);
  const input = new PlayerInput(warner);
  // With a fixed timestep a handler sees a copy of the key flags per step: edges (pressed, released) gathered since the last step
  // go to the next step only, so a press between steps is never lost and never seen twice.
  const edges = new Uint8Array(KEYS.length);
  const stepKeys = new Uint8Array(KEYS.length);
  let accumulator = 0;
  if (stepHz !== undefined) input.handlerKeys = stepKeys;
  input.values[RGE_IN_WIDTH] = width;
  input.values[RGE_IN_HEIGHT] = height;
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    measureText: backend.measureText ? (text, size) => backend.measureText!(text, size) : undefined,
    textureSize: backend.textureSize ? (handle) => backend.textureSize!(handle) : undefined,
    assets,
    warn: config.warn,
    retain: config.retain,
  });
  const sink = createSoundSink(backend, assets, warner);
  const world = new World();
  // The host's broad phase when it has one; the tracker sweeps in script otherwise.
  const collisions = new CollisionTracker(undefined, true, true, backend.overlaps ? (boxes, count, order, pairs) => backend.overlaps!(boxes, count, order, pairs) : undefined);
  let pointers: readonly Pressable[] = [];
  let hudPointersFrom = 0;
  let hudView: ViewTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let screen: ScreenPlacement | null = null;
  let closed = false;
  let fullscreen = false;
  const fullscreenSetting = game?.fullscreenKey ?? config.fullscreenKey ?? "F11";
  const fullscreenKey = fullscreenSetting === false ? undefined : KEY_INDEX.get(fullscreenSetting);
  if (typeof fullscreenSetting === "string" && fullscreenKey === undefined) {
    warner.once(`fullscreenKey:${fullscreenSetting}`, `Unknown fullscreenKey '${fullscreenSetting}': only Alt + Enter toggles full screen.`);
  }

  /** The full-screen key (or Alt + Enter) was pressed last frame: switch, and keep the switch only if the window did. */
  const toggleFullscreen = (): void => {
    if (!backend.setFullscreen) return;
    const pressed = (index: number | undefined): boolean => index !== undefined && ((input.keys[index] as number) & RGE_KEY_PRESSED) !== 0;
    const altEnter = pressed(ENTER_KEY) && ((input.keys[ALT_KEY] as number) & RGE_KEY_DOWN) !== 0;
    if (!pressed(fullscreenKey) && !altEnter) return;
    if (backend.setFullscreen(!fullscreen)) fullscreen = !fullscreen;
  };

  // The frame-rate counter: the frame rate from the time the backend measures between frames, and what the script cost (the step, without the backend's draw and wait), each smoothed.
  let showFps = game?.showFps ?? config.showFps ?? false;
  const fpsSetting = game?.fpsKey ?? config.fpsKey ?? "F3";
  const fpsKey = fpsSetting === false ? undefined : KEY_INDEX.get(fpsSetting);
  let smoothDt = 0;
  let smoothMs = 0;
  const clock = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (getSoundSink() === sink) setSoundSink(null);
    backend.close();
  };

  setSoundSink(sink);
  for (const name of preload) sink.load(name);
  for (const name of preloadMusic) sink.loadMusic?.(name);
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
      if (world.reportPress(pointers[i] as Pressable, point.x, point.y)) return;
    }
  };

  return {
    world,
    step(): boolean {
      if (closed) throw new Error("The player is closed.");
      const started = clock();
      toggleFullscreen();
      if (fpsKey !== undefined && ((input.keys[fpsKey] as number) & RGE_KEY_PRESSED) !== 0) showFps = !showFps;
      const realDt = input.values[RGE_IN_DT] as number;
      if (realDt > 0) smoothDt = smoothDt === 0 ? realDt : smoothDt * 0.9 + realDt * 0.1;
      dispatchPress();
      const dt = input.values[RGE_IN_DT] as number;
      if (stepHz === undefined) world.tick(dt > 0 ? Math.min(dt, MAX_DT) : 0, input);
      else {
        for (let i = 0; i < edges.length; i++) edges[i] = (edges[i] as number) | ((input.keys[i] as number) & (RGE_KEY_PRESSED | RGE_KEY_RELEASED));
        accumulator += dt > 0 ? Math.min(dt, MAX_DT) : 0;
        let steps = 0;
        // The epsilon keeps sixty frames of 1/60 s from running 59 steps: a sum of 1/60s is a hair short of a step now and then.
        while (accumulator >= fixedDt - 1e-9 && steps < MAX_STEPS_PER_FRAME) {
          accumulator -= fixedDt;
          for (let i = 0; i < stepKeys.length; i++) {
            const raw = input.keys[i] as number;
            const e = edges[i] as number;
            // Down if held now, or if it went down since the last step (a tap that is over by now still counts for one step).
            stepKeys[i] = (raw & RGE_KEY_DOWN) | (e & RGE_KEY_PRESSED ? RGE_KEY_DOWN : 0) | e;
            edges[i] = 0;
          }
          world.tick(fixedDt, input);
          steps++;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        else if (accumulator < 0) accumulator = 0;
        // With no step this frame nothing ticked: still settle what the hooks of the last one set.
        if (steps === 0) world.flush();
      }
      const built = builder.build(world.root, input.width, input.height);
      pointers = built.pointers;
      hudPointersFrom = built.hudPointersFrom;
      hudView = built.hudView;
      screen = built.screen;
      input.view = built.view;
      collisions.update(world, built.colliders);
      if (showFps) {
        const ms = clock() - started;
        smoothMs = smoothMs === 0 ? ms : smoothMs * 0.9 + ms * 0.1;
        const shown = built.list;
        shown.view({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        shown.text({ x: 3, y: 3, rotation: 0, scaleX: 1, scaleY: 1 }, `${smoothDt > 0 ? Math.round(1 / smoothDt) : 0} fps  ${smoothMs.toFixed(1)} ms`, 8, 0xffe14dff);
      }
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

/**
 * Sounds and music load through the backend once per path (a failed load is remembered too) and play by handle. A sound plays
 * at a volume and over itself (the backend has four voices per sound); music streams, and a backend without music support
 * leaves it silent, with one warning.
 */
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
  const musics = new Map<string, number>();
  const musicFor = (name: string): number => {
    const path = `${assets}/${name}`;
    let handle = musics.get(path);
    if (handle === undefined) {
      if (backend.loadMusic === undefined) {
        warner.once("music-unsupported", "This backend cannot play music: <Music> is silent.");
        handle = -1;
      } else {
        handle = backend.loadMusic(path);
        if (handle < 0) warner.once(`music:${path}`, `Could not load the music '${path}': it will not play.`);
      }
      musics.set(path, handle);
    }
    return handle;
  };
  return {
    load: (name) => void handleFor(name),
    play: (name, volume) => {
      const handle = handleFor(name);
      if (handle >= 0) backend.playSound(handle, volume);
    },
    loadMusic: (name) => void musicFor(name),
    playMusic: (name, volume, loop) => {
      const handle = musicFor(name);
      if (handle >= 0) backend.playMusic?.(handle, volume, loop);
    },
    setMusicVolume: (name, volume) => {
      const handle = musicFor(name);
      if (handle >= 0) backend.setMusicVolume?.(handle, volume);
    },
    stopMusic: (name) => {
      const handle = musicFor(name);
      if (handle >= 0) backend.stopMusic?.(handle);
    },
  };
}
