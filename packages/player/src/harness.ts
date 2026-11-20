import type { Backend, StorageBackend } from "./backend.ts";
import { createPlayer, type Player, type PlayerConfig } from "./loop.ts";
import { TSE_IN_HEIGHT, TSE_IN_WIDTH } from "./protocol.ts";
import { aimFrame, applyInputFrame, RecordingBackend, type AimState, type InputFrame, type RecordingOptions } from "./recording.ts";
import { parseInputScript, type InputBindings } from "./script.ts";

/**
 * A backend that draws with another one and takes its input from a script instead of devices. Each frame is drawn by
 * `inner`, then the next scripted frame is written over whatever `inner` polled (an empty queue is an idle frame). With a
 * native hidden window this renders a scripted run, which is what the screenshot tool does.
 */
export class ScriptedInputBackend implements Backend {
  readonly #inner: Backend;
  readonly #queue: InputFrame[];
  /** How a frame's `aim` (a label, `click@Play`) is found: whoever makes the player sets `aim.lookup` to its `pointOf`. */
  readonly aim: AimState = { lookup: undefined, last: undefined };
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

  /** `storage` replaces the inner backend's saved data: `memoryStorage()` keeps a run away from the player's own saves. */
  constructor(inner: Backend, frames: readonly InputFrame[] = [], options: { readonly storage?: StorageBackend } = {}) {
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
    this.storage = options.storage ?? inner.storage;
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
    applyInputFrame(
      aimFrame(this.#queue.shift() ?? {}, this.aim),
      input,
      keys,
      input[TSE_IN_WIDTH] as number,
      input[TSE_IN_HEIGHT] as number
    );
  }
}

/** Saved data kept in memory and gone with the run: for a run that must not read or change the player's own saves. */
export function memoryStorage(initial: Readonly<Record<string, string>> = {}): StorageBackend {
  const stored = new Map(Object.entries(initial));
  return {
    open: () => true,
    read: (name) => stored.get(name) ?? null,
    write: (name, text) => (stored.set(name, text), true),
    remove: (name) => void stored.delete(name),
  };
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
  backend.aim.lookup = (label) => player.pointOf(label);
  backend.aim.labels = () => player.labels();
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

export interface PlayOptions extends RecordingOptions {
  /** The game's actions and their keys, so a script can say `jump`: `controls.toJSON()`, or what the game's `game.ts` exports. */
  readonly bindings?: InputBindings;
}

export interface UntilOptions {
  /** The most steps to run. Default 3600: a minute at 60 steps a second. */
  readonly maxSteps?: number;
  /** false: return `maxSteps` when not done by then, instead of throwing. Default true. */
  readonly throws?: boolean;
}

/** A game being played by a test, a step at a time: see `playGame`. */
export interface GamePlay {
  readonly player: Player;
  readonly backend: RecordingBackend;
  /** What the game warned of so far. */
  readonly warnings: string[];
  /** How many steps have run, the warm-up one not counted. */
  readonly steps: number;
  /** Run the steps of an input script (`"right*30, jump, _"`, `"click@120,64"`), one step a frame. */
  input(script: string): GamePlay;
  /**
   * Run steps with nothing pressed (the mouse left where the last script put it) until `done()` is true: it is asked before the
   * first step and after each. Returns how many steps it ran. Not done after `maxSteps`: it throws, or with `throws: false` returns
   * `maxSteps`. A test that waits for the game ("until the jar has settled") says so, where a count of frames (`_*330`) breaks
   * the day the game takes a little longer.
   */
  stepUntil(done: () => boolean, options?: UntilOptions): number;
  close(): void;
}

/**
 * A game played by a test without a window, as `runScript` plays one, but a piece at a time: press some keys, wait for
 * something to be true, look, press more. The warm-up step has run, so the tree is mounted.
 *
 *     const game = playGame(gameConfig, { bindings });
 *     game.input("_*2, Enter, _*5, Space");
 *     game.stepUntil(() => run().phase === "pick");
 *     game.input("click@320,150");
 *     game.close();
 *
 * As in `runScript`, a step sees the input of the frame before it, so a press shows in the game one step after its frame.
 */
export function playGame(config: PlayerConfig, options: PlayOptions = {}): GamePlay {
  const backend = new RecordingBackend(options);
  const warnings: string[] = [];
  const player = createPlayer(backend, { ...config, warn: (message) => warnings.push(message) });
  backend.aim.lookup = (label) => player.pointOf(label);
  backend.aim.labels = () => player.labels();
  player.step();
  let steps = 0;
  let mouse: InputFrame["mouse"];
  let aim: InputFrame["aim"];
  const step = (frame: InputFrame): void => {
    backend.queueInput(frame);
    player.step();
    steps++;
  };
  const play: GamePlay = {
    player,
    backend,
    warnings,
    get steps() {
      return steps;
    },
    input(script) {
      for (const frame of parseInputScript(script, options.bindings === undefined ? {} : { bindings: options.bindings })) {
        if (frame.mouse !== undefined) mouse = frame.mouse;
        aim = frame.aim === undefined ? undefined : { label: frame.aim.label, fresh: false };
        step(frame);
      }
      return play;
    },
    stepUntil(done, until = {}) {
      const maxSteps = until.maxSteps ?? 3600;
      for (let ran = 0; ; ran++) {
        if (done()) return ran;
        if (ran >= maxSteps) {
          if (until.throws === false) return ran;
          throw new Error(`stepUntil: not done after ${maxSteps} steps`);
        }
        step(aim !== undefined ? { aim } : mouse === undefined ? {} : { mouse });
      }
    },
    close: () => player.close(),
  };
  return play;
}
