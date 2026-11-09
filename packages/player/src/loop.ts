import { World, getSoundSink, setSoundSink, type GameObject, type Pointer, type SoundSink } from "@rge/runtime";
import type { Backend, WindowConfig } from "./backend.ts";
import { MAGENTA, parseColor } from "./color.ts";
import { CollisionTracker } from "./collide.ts";
import { FrameBuilder } from "./draw.ts";
import { PlayerInput } from "./input.ts";
import { onScreen, type ScreenPlacement } from "./screen.ts";
import { RGE_IN_DT, RGE_IN_HEIGHT, RGE_IN_QUIT, RGE_IN_WIDTH, RGE_KEY_PRESSED, KEY_INDEX } from "./protocol.ts";
import { Warner } from "./warn.ts";

export interface PlayerConfig extends WindowConfig {
  /** Builds the root object. Called once the window is open and sounds are wired, so sounds created here preload. */
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
  const assets = config.assets ?? "assets";
  const background = resolveBackground(config.background ?? "black", warner);

  backend.open({
    width: config.width,
    height: config.height,
    title: config.title,
    resizable: config.resizable,
    vsync: config.vsync,
    hidden: config.hidden,
    smooth: config.smooth,
  });

  const input = new PlayerInput(warner);
  input.values[RGE_IN_WIDTH] = config.width;
  input.values[RGE_IN_HEIGHT] = config.height;
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
  let screen: ScreenPlacement | null = null;
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (getSoundSink() === sink) setSoundSink(null);
    backend.close();
  };

  setSoundSink(sink);
  try {
    world.mount(config.root());
  } catch (error) {
    close();
    throw error;
  }

  const dispatchPress = (): void => {
    if (((input.keys[LEFT_BUTTON] as number) & RGE_KEY_PRESSED) === 0) return;
    if (screen !== null && !onScreen(screen, input.screenX, input.screenY)) return;
    const at = input.worldPoint(input.screenX, input.screenY);
    // The last pointer drawn is on top, so it gets the press; one press, one pointer.
    for (let i = pointers.length - 1; i >= 0; i--) if (world.reportPress(pointers[i] as Pointer, at.x, at.y)) return;
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
