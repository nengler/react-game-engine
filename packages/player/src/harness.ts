import type { Backend } from "./backend.ts";
import { createPlayer, type Player, type PlayerConfig } from "./loop.ts";
import { TSE_IN_HEIGHT, TSE_IN_WIDTH } from "./protocol.ts";
import { applyInputFrame, RecordingBackend, type InputFrame, type RecordingOptions } from "./recording.ts";

/**
 * A backend that draws with another one and takes its input from a script instead of devices. Each frame is drawn by
 * `inner`, then the next scripted frame is written over whatever `inner` polled (an empty queue is an idle frame). With a
 * native hidden window this renders a scripted run, which is what the screenshot tool does.
 */
export class ScriptedInputBackend implements Backend {
  readonly #inner: Backend;
  readonly #queue: InputFrame[];
  readonly measureText: Backend["measureText"];
  readonly textureSize: Backend["textureSize"];
  readonly overlaps: Backend["overlaps"];
  readonly setFullscreen: Backend["setFullscreen"];
  readonly loadMusic: Backend["loadMusic"];
  readonly playMusic: Backend["playMusic"];
  readonly setMusicVolume: Backend["setMusicVolume"];
  readonly stopMusic: Backend["stopMusic"];
  readonly setGamepadDeadzone: Backend["setGamepadDeadzone"];
  readonly storage: Backend["storage"];

  constructor(inner: Backend, frames: readonly InputFrame[] = []) {
    this.#inner = inner;
    this.#queue = [...frames];
    this.measureText = inner.measureText?.bind(inner);
    this.textureSize = inner.textureSize?.bind(inner);
    this.overlaps = inner.overlaps?.bind(inner);
    this.setFullscreen = inner.setFullscreen?.bind(inner);
    this.loadMusic = inner.loadMusic?.bind(inner);
    this.playMusic = inner.playMusic?.bind(inner);
    this.setMusicVolume = inner.setMusicVolume?.bind(inner);
    this.stopMusic = inner.stopMusic?.bind(inner);
    this.setGamepadDeadzone = inner.setGamepadDeadzone?.bind(inner);
    this.storage = inner.storage;
  }

  queueInput(frame: InputFrame): void {
    this.#queue.push(frame);
  }

  open: Backend["open"] = (config) => this.#inner.open(config);
  close: Backend["close"] = () => this.#inner.close();
  loadTexture: Backend["loadTexture"] = (path) => this.#inner.loadTexture(path);
  loadSound: Backend["loadSound"] = (path) => this.#inner.loadSound(path);
  loadShader: NonNullable<Backend["loadShader"]> = (path) => this.#inner.loadShader?.(path) ?? -2;
  playSound: Backend["playSound"] = (handle, volume) => this.#inner.playSound(handle, volume);

  frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void {
    this.#inner.frame(clearColor, records, length, texts, input, keys);
    applyInputFrame(this.#queue.shift() ?? {}, input, keys, input[TSE_IN_WIDTH] as number, input[TSE_IN_HEIGHT] as number);
  }
}

export interface RunResult<T> {
  /** What `observe` returned after each scripted frame: `states[i]` is the game after the step that read `frames[i]`. */
  readonly states: T[];
  readonly backend: RecordingBackend;
  readonly warnings: string[];
}

export type RunOptions = RecordingOptions;

/**
 * The headless harness. Builds the game against a recording backend (no window), runs one warm-up step so the tree is
 * mounted and settled, then steps the player once for each input frame, in order, and records what `observe` returns
 * after each step. `frames[i]` is the input the game sees in step i, as in a replay.
 *
 * Observe the game through its own state (the game store, or whatever the game's rules keep) and assert on behaviour:
 * where the player is, which room, how many deaths. Draw records are in `result.backend` for the rare test that needs
 * them. The harness steps exactly one `player.step()` per frame, and that is one fixed step when the game turns the
 * fixed timestep on and its frames report `dt` of 1/60 (what `parseInputScript` gives), so a run is repeatable.
 */
export function runScript<T>(
  config: PlayerConfig,
  frames: readonly InputFrame[],
  observe: (player: Player) => T,
  options: RunOptions = {}
): RunResult<T> {
  const backend = new RecordingBackend(options);
  const warnings: string[] = [];
  for (const frame of frames) backend.queueInput(frame);
  const player = createPlayer(backend, { ...config, warn: (message) => warnings.push(message) });
  const states: T[] = [];
  try {
    player.step(); // warm-up: its input is the empty first frame; the first scripted frame is read by the next step
    for (let i = 0; i < frames.length; i++) {
      player.step();
      states.push(observe(player));
    }
  } finally {
    player.close();
  }
  return { states, backend, warnings };
}
