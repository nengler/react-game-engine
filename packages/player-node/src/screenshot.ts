import {
  applyInputFrame,
  createPlayer,
  ScriptedInputBackend,
  TSE_IN_HEIGHT,
  TSE_IN_WIDTH,
  type InputFrame,
  type PlayerConfig,
} from "@tsengine/player";

import { createNodeBackend, type Pixels } from "./backend.ts";
import { findNativeLibrary } from "./ffi.ts";

export interface ShotOptions {
  /** Steps to keep (counted from 0 for the first scripted frame). Default: every step. */
  readonly at?: readonly number[];
  /** The path of libtse; default is the headless build (see `findNativeLibrary`). */
  readonly library?: string | null;
  /** Called with a warning the game prints; default collects them in the result. */
  readonly warnings?: string[];
}

export interface Shot {
  /** The step this was captured after: the game as it looks once `frames[step]` has been played. */
  readonly step: number;
  readonly pixels: Pixels;
}

/**
 * Render a scripted run through the software-rendered hidden window and keep the pixels of the chosen steps. The game is
 * built and drawn once before the script starts (the warm-up), as in `runScript`, so `at: [0]` is the picture after
 * the first scripted frame. A run steps the player once per input frame.
 */
export function renderRun(config: PlayerConfig, frames: readonly InputFrame[], options: ShotOptions = {}): Shot[] {
  const backend = createNodeBackend(options.library === undefined ? findNativeLibrary("headless") : options.library);
  const scripted = new ScriptedInputBackend(backend, frames);
  const player = createPlayer(scripted, {
    ...config,
    hidden: true,
    vsync: false,
    warn: (message) => options.warnings?.push(message) ?? console.warn(message),
  });
  const keep = options.at === undefined ? null : new Set(options.at);
  const shots: Shot[] = [];
  try {
    player.step();
    for (let step = 0; step < frames.length; step++) {
      player.step();
      if (keep !== null && !keep.has(step)) continue;
      const pixels = backend.readPixels();
      if (pixels === null)
        throw new Error("The window kept no pixels: renderRun needs the headless build (npm run native:build:headless).");
      shots.push({ step, pixels: { width: pixels.width, height: pixels.height, rgba: new Uint8Array(pixels.rgba) } });
    }
  } finally {
    player.close();
  }
  return shots;
}

/** A scripted backend that lets the caller write each step's input itself, into the buffers the player reads (see `Renderer`). */
class DirectInputBackend extends ScriptedInputBackend {
  input: Float64Array | null = null;
  keys: Uint8Array | null = null;
  /** Draw the frames stepped: off for the steps between two pictures, which nobody sees. */
  drawing = true;

  override frame(
    clearColor: number,
    records: Float64Array,
    length: number,
    texts: readonly string[],
    input: Float64Array,
    keys: Uint8Array
  ): void {
    if (this.drawing) super.frame(clearColor, records, length, texts, input, keys);
    this.input = input;
    this.keys = keys;
  }
}

/**
 * A game drawn through the hidden window a frame of input at a time, kept open between pictures: `tse session` draws its run here,
 * playing only the frames since its last picture, so a picture late in a long run costs what the new frames cost. `renderRun` is
 * the same, for a script played all at once.
 */
export class Renderer {
  readonly #backend: ReturnType<typeof createNodeBackend>;
  readonly #direct: DirectInputBackend;
  readonly #player: ReturnType<typeof createPlayer>;
  #frames = 0;

  constructor(config: PlayerConfig, options: { readonly library?: string | null; readonly warnings?: string[] } = {}) {
    this.#backend = createNodeBackend(options.library === undefined ? findNativeLibrary("headless") : options.library);
    this.#direct = new DirectInputBackend(this.#backend);
    this.#player = createPlayer(this.#direct, {
      ...config,
      hidden: true,
      vsync: false,
      warn: (message) => options.warnings?.push(message) ?? console.warn(message),
    });
    this.#player.step(); // the warm-up, as in renderRun
  }

  /** Frames of input played so far. */
  get frames(): number {
    return this.#frames;
  }

  /** Play frames of input, a step each. Only the last is drawn: the picture is of where they end. */
  play(frames: readonly InputFrame[]): void {
    const direct = this.#direct;
    for (let i = 0; i < frames.length; i++) {
      if (direct.input !== null && direct.keys !== null)
        applyInputFrame(
          frames[i] as InputFrame,
          direct.input,
          direct.keys,
          direct.input[TSE_IN_WIDTH] as number,
          direct.input[TSE_IN_HEIGHT] as number
        );
      direct.drawing = i === frames.length - 1;
      this.#player.step();
      this.#frames++;
    }
    direct.drawing = true;
  }

  /** The picture of the last step played. */
  pixels(): Pixels {
    const pixels = this.#backend.readPixels();
    if (pixels === null)
      throw new Error("The window kept no pixels: the renderer needs the headless build (npm run native:build:headless).");
    return { width: pixels.width, height: pixels.height, rgba: new Uint8Array(pixels.rgba) };
  }

  close(): void {
    this.#player.close();
  }
}
