import { createPlayer, ScriptedInputBackend, type InputFrame, type PlayerConfig } from "@rge/player";
import { createNodeBackend, type Pixels } from "./backend.ts";
import { findNativeLibrary } from "./ffi.ts";

export interface ShotOptions {
  /** Steps to keep (counted from 0 for the first scripted frame). Default: every step. */
  readonly at?: readonly number[];
  /** The path of librge; default is the headless build (see `findNativeLibrary`). */
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
  const player = createPlayer(scripted, { ...config, hidden: true, vsync: false, warn: (message) => options.warnings?.push(message) ?? console.warn(message) });
  const keep = options.at === undefined ? null : new Set(options.at);
  const shots: Shot[] = [];
  try {
    player.step();
    for (let step = 0; step < frames.length; step++) {
      player.step();
      if (keep !== null && !keep.has(step)) continue;
      const pixels = backend.readPixels();
      if (pixels === null) throw new Error("The window kept no pixels: renderRun needs the headless build (npm run native:build:headless).");
      shots.push({ step, pixels: { width: pixels.width, height: pixels.height, rgba: new Uint8Array(pixels.rgba) } });
    }
  } finally {
    player.close();
  }
  return shots;
}
