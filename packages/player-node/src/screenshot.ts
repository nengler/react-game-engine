import { createPlayer, memoryStorage, ScriptedInputBackend, type InputFrame, type Player, type PlayerConfig } from "@tsengine/player";

import { createNodeBackend, type Pixels } from "./backend.ts";
import { findNativeLibrary } from "./ffi.ts";

export interface ShotOptions {
  /** Steps to keep (counted from 0 for the first scripted frame). Default: every step. */
  readonly at?: readonly number[];
  /** The path of libtse; default is the headless build (see `findNativeLibrary`). */
  readonly library?: string | null;
  /** Called with a warning the game prints; default collects them in the result. */
  readonly warnings?: string[];
  /**
   * Whether the run reads and writes the player's own saved data (`createSave`, `createSettings`). Default false: it starts
   * with none and what it saves is kept in memory and gone when it ends, so a shot is the same whatever was played before
   * and leaves the player's saves alone.
   */
  readonly saves?: boolean;
  /**
   * Called before each scripted step, with the step about to be played (0 first; the game has been built and drawn once by
   * then): to put the game where a shot needs it (a later level, a full jar) without playing there. What it changes shows in
   * that step's picture.
   */
  readonly beforeStep?: (player: Player, step: number) => void;
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
  const scripted = new ScriptedInputBackend(backend, frames, options.saves === true ? {} : { storage: memoryStorage() });
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
      options.beforeStep?.(player, step);
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
