import { Game, World, captureHotState, getSoundSink, restoreHotState, setSoundSink, resetGameState, type Controls, type GameObject, type HotState, type Pressable, type SoundSink, type ViewTransform } from "@rge/runtime";
import type { Backend, WindowConfig } from "./backend.ts";
import { MAGENTA, parseColor } from "./color.ts";
import { CollisionTracker } from "./collide.ts";
import { DrawList, estimateTextWidth, FrameBuilder, rootScreen } from "./draw.ts";
import { HOST_RUN_KEY } from "./host.ts";
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
  /** The game's actions, as the `<Game>` prop `controls`. */
  readonly controls?: Controls;
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
  /**
   * What happens when the game throws (building its root, mounting it, or in a step). `true`: the window stays open and shows the
   * error and its stack until it is closed (see `Player.failure`). `false`: the error is thrown out of `createPlayer` or `step`.
   * Default `false` for `createPlayer`, so tests and tools see the error; `run` turns it on for a visible window.
   */
  readonly showErrors?: boolean;
  /** The last line of the error screen. Default "Close the window to quit." A host that reloads says how to. */
  readonly errorNote?: string;
}

export interface Player {
  readonly world: World;
  /** Run one frame. Returns false once the window has asked to close (that frame is still drawn). */
  step(): boolean;
  /**
   * The error the game stopped with, while the window shows it (see `PlayerConfig.showErrors`); null while the game runs. The
   * world is left as the error found it and is not stepped, so a `reload` can still take its state.
   */
  readonly failure: { readonly error: unknown } | null;
  /** Stop the game and show `error` in the window instead (a host's compile error, say), with `note` as the last line. */
  showError(error: unknown, note?: string): void;
  /**
   * Hot reload: build `config.root` again (from a newer build of the game's classes), put it in place of the current root in the
   * same window and world, and give each component the state its counterpart had (see `captureHotState`). The window's
   * settings stay as they were opened; the controls are taken from the new root. Returns false, and shows the error, if the
   * new root cannot be built or mounted; the state of the last good tree is kept for the next try. Clears an earlier failure.
   */
  reload(config: PlayerConfig): boolean;
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
  const showErrors = config.showErrors ?? false;
  let failure: { error: unknown; note: string } | null = null;
  const defaultNote = config.errorNote ?? "Close the window to quit.";
  let root: GameObject | null = null;
  try {
    root = config.root();
  } catch (error) {
    if (getSoundSink() === collector) setSoundSink(null);
    if (!showErrors) throw error;
    // Open a window anyway, from the config alone, to say what went wrong.
    failure = { error, note: defaultNote };
  }
  const game = root instanceof Game ? root : null;
  // Each setting: the `<Game>` prop where it is written, else the player's config, else the default.
  // With nothing set, a game with a `<Screen>` opens at 3 × its resolution, so each game pixel is 3 × 3 window pixels.
  const screen0 = root === null ? null : rootScreen(root);
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
  input.controls = game?.controls ?? config.controls;
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
  /** The root in the world, or null when building or mounting the last one failed. */
  let current: GameObject | null = null;
  /** The state of the last tree that was in the world, for the next reload when there is no tree to take it from. */
  let lastState: HotState = new Map();
  if (root !== null) {
    try {
      world.mount(root);
      current = root;
    } catch (error) {
      if (!showErrors) {
        close();
        throw error;
      }
      failure = { error, note: defaultNote };
    }
  }

  // The error screen: the error's lines, wrapped to the window, drawn in window pixels over a dark red background.
  const errorList = new DrawList();
  let errorLayout: { readonly key: string; readonly lines: readonly ErrorLine[] } | null = null;
  const measure = (text: string, size: number): number => (backend.measureText ? backend.measureText(text, size).width : estimateTextWidth(text, size));
  const drawError = (shown: { error: unknown; note: string }): void => {
    const width = input.width;
    const height = input.height;
    const key = `${width}x${height}`;
    if (errorLayout === null || errorLayout.key !== key) errorLayout = { key, lines: layoutError(shown.error, shown.note, width, height, measure) };
    errorList.reset();
    errorList.view({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    for (const line of errorLayout.lines) errorList.text({ x: line.x, y: line.y, rotation: 0, scaleX: 1, scaleY: 1 }, line.text, line.size, line.color);
    backend.frame(ERROR_BACKGROUND, errorList.records, errorList.length, errorList.texts, input.values, input.keys);
  };
  const fail = (error: unknown, note: string = defaultNote): { error: unknown; note: string } => {
    errorLayout = null;
    return (failure = { error, note });
  };

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
    get failure() {
      return failure === null ? null : { error: failure.error };
    },
    showError(error: unknown, note?: string): void {
      fail(error, note);
    },
    reload(next: PlayerConfig): boolean {
      if (closed) throw new Error("The player is closed.");
      try {
        if (current !== null) lastState = captureHotState(current);
      } catch {
        // A tree the error left half-built may not say what it holds: keep the last state that could be read.
      }
      let fresh: GameObject;
      try {
        fresh = next.root();
      } catch (error) {
        fail(error);
        return false;
      }
      try {
        if (current !== null) {
          const old = current;
          current = null;
          world.root.removeChild(old);
        }
        world.mount(fresh);
        current = fresh;
        restoreHotState(world, fresh, lastState);
      } catch (error) {
        fail(error);
        return false;
      }
      const nextGame = fresh instanceof Game ? fresh : null;
      input.controls = nextGame?.controls ?? next.controls ?? input.controls;
      failure = null;
      return true;
    },
    step(): boolean {
      if (closed) throw new Error("The player is closed.");
      if (failure !== null) {
        drawError(failure);
        return input.values[RGE_IN_QUIT] === 0;
      }
      if (!showErrors) return stepGame();
      try {
        return stepGame();
      } catch (error) {
        drawError(fail(error));
        return input.values[RGE_IN_QUIT] === 0;
      }
    },
    close,
  };

  function stepGame(): boolean {
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
  }
}

/**
 * Open the window, step until it is closed, then clean up (also when the game throws). In a visible window an error is shown
 * there until the window is closed (`showErrors` defaults to on unless the window is `hidden`), and then thrown, so the host
 * still prints it and exits with status 1.
 *
 * A host that drives the loop itself (the Node launcher, which hot reloads) installs a function at `globalThis[HOST_RUN_KEY]`;
 * `run` then hands it the backend and config and returns at once.
 */
export function run(backend: Backend, config: PlayerConfig): void {
  const hostRun = (globalThis as Record<string, unknown>)[HOST_RUN_KEY];
  if (typeof hostRun === "function") {
    (hostRun as (backend: Backend, config: PlayerConfig) => void)(backend, config);
    return;
  }
  const player = createPlayer(backend, { ...config, showErrors: config.showErrors ?? !(config.hidden ?? false) });
  try {
    while (player.step());
  } finally {
    player.close();
  }
  const failure = player.failure;
  if (failure !== null) throw failure.error;
}

/** The error screen's background: a dark red, so it is not mistaken for the game. */
const ERROR_BACKGROUND = 0x3a0d12ff;
const ERROR_TITLE = 0xffd0d0ff;
const ERROR_TEXT = 0xf2f2f2ff;
const ERROR_DIM = 0xc89aa0ff;

/** One line of the error screen, in window pixels. */
export interface ErrorLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
}

/** The title and the stack of an error, as lines of text. A stack that starts with the title (V8's) does not repeat it. */
export function describeError(error: unknown): { readonly title: string; readonly details: readonly string[] } {
  if (error instanceof Error) {
    const title = `${error.name}: ${error.message}`;
    let stack = typeof error.stack === "string" ? error.stack : "";
    if (stack.startsWith(title)) stack = stack.slice(title.length);
    const details = stack
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "")
      .map((line) => line.replace(/^\s+/, "  ").replaceAll("file://", ""));
    return { title, details };
  }
  const text = String(error);
  const [first = "", ...rest] = text.split("\n");
  return { title: first, details: rest };
}

/**
 * Where each line of the error screen goes: a heading, the error's title, its stack (dimmer), and `note` at the bottom. Text
 * is sized to the window and long lines are wrapped; what does not fit is cut, with a line that says so.
 */
export function layoutError(error: unknown, note: string, width: number, height: number, measure: (text: string, size: number) => number): ErrorLine[] {
  // Whole multiples of 10: the hosts draw text with raylib's built-in 10-pixel font, scaled without smoothing, and at other
  // sizes its one-pixel strokes (an "i", a ".") can vanish.
  const size = height >= 360 && width >= 480 ? 20 : 10;
  const margin = Math.max(8, Math.round(size * 1.2));
  const lineHeight = Math.round(size * 1.35);
  const room = Math.max(size * 4, width - margin * 2);
  const wrap = (text: string, textSize: number): string[] => {
    const out: string[] = [];
    let rest = text;
    while (rest.length > 0 && measure(rest, textSize) > room) {
      // The longest head that fits, broken at a space or a path separator where there is one near the end.
      let fit = 1;
      while (fit < rest.length && measure(rest.slice(0, fit + 1), textSize) <= room) fit++;
      const head = rest.slice(0, fit);
      const at = Math.max(head.lastIndexOf(" "), head.lastIndexOf("/"), head.lastIndexOf("("));
      const cut = at > fit * 0.5 ? at + 1 : fit;
      out.push(rest.slice(0, cut).trimEnd());
      rest = "    " + rest.slice(cut).trimStart();
      if (rest.trim() === "") rest = "";
    }
    if (rest.length > 0) out.push(rest);
    return out;
  };
  const { title, details } = describeError(error);
  const lines: ErrorLine[] = [];
  let y = margin;
  const bottom = height - margin - lineHeight * 2;
  let cut = false;
  const add = (text: string, textSize: number, color: number): void => {
    for (const piece of wrap(text, textSize)) {
      if (y > bottom) {
        cut = true;
        return;
      }
      lines.push({ text: piece, x: margin, y, size: textSize, color });
      y += Math.round(textSize * 1.35);
    }
  };
  add("The game stopped with an error", size, ERROR_DIM);
  y += Math.round(lineHeight / 2);
  for (const line of title.split("\n")) add(line, size, ERROR_TITLE);
  y += Math.round(lineHeight / 2);
  const small = width >= 1400 ? size : 10;
  for (const line of details) add(line, small, ERROR_TEXT);
  if (cut) lines.push({ text: "(the rest does not fit)", x: margin, y: Math.min(y, bottom + lineHeight), size: small, color: ERROR_DIM });
  lines.push({ text: note, x: margin, y: height - margin - size, size, color: ERROR_DIM });
  return lines;
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
