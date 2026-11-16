import { TSE_KEY_DOWN, TSE_KEY_PRESSED, TSE_KEY_RELEASED } from "./protocol.ts";

/** Most steps one frame runs: a stall longer than this many steps is dropped, not caught up. */
export const MAX_STEPS_PER_FRAME = 8;

/** The edges of a key: pressed and released. They are seen by exactly one step, or by the first one after a freeze. */
const EDGES = TSE_KEY_PRESSED | TSE_KEY_RELEASED;

/**
 * Runs one step of the game: `input` is what `onInput` sees (this step's key flags), `update` what `onUpdate` sees (the same,
 * plus the edges of any frozen steps before it). Returns whether the step was frozen, that is, whether `onUpdate` was skipped.
 */
export type StepRunner = (input: Uint8Array, update: Uint8Array, dt: number) => boolean;

/**
 * The fixed-step driver, the one place that says when a step runs and what keys it sees. `createPlayer` drives the world with
 * it, and a test or a solver that has no player drives its own rules with it, so nobody models it twice:
 *
 * - **Timing.** Frame time goes into an accumulator and a frame runs as many whole steps as it holds. A stall is capped at
 *   `MAX_STEPS_PER_FRAME` and the rest forgotten.
 * - **Edges.** A press (or release) is seen by exactly one step, even when the frame has two steps or none, and a tap that is over
 *   by the time the step runs still counts for it.
 * - **Freezes.** A frozen step skips `onUpdate`, so the edges it saw are kept for the first step after the freeze: a press made
 *   during the freeze is not lost. `onInput` still sees each edge once.
 *
 * Whether a step is frozen is the caller's to say (it is the runner's return value): the world counts freezes, the rules' replay
 * counts its own.
 */
export class FixedDriver {
  /** Seconds in a step. */
  readonly dt: number;
  readonly #keys: number;
  #accumulator = 0;
  /** Edges gathered since the last step. */
  #edges: Uint8Array;
  /** Edges of frozen steps, owed to the first step that is not. */
  #carried: Uint8Array;
  readonly #input: Uint8Array;
  readonly #update: Uint8Array;

  /** `hz` steps per second, over `keys` keys. */
  constructor(hz: number, keys: number) {
    if (!(hz > 0 && Number.isFinite(hz))) throw new RangeError(`fixedStep must be a positive number of steps per second, not ${hz}.`);
    this.dt = 1 / hz;
    this.#keys = keys;
    this.#edges = new Uint8Array(keys);
    this.#carried = new Uint8Array(keys);
    this.#input = new Uint8Array(keys);
    this.#update = new Uint8Array(keys);
  }

  /**
   * How far the time left over after the last `advance` is into the next step, 0 to just under 1: where a frame drawn now falls between
   * the last step and the next one.
   */
  get alpha(): number {
    const alpha = this.#accumulator / this.dt;
    return alpha > 0 ? (alpha < 1 ? alpha : 1) : 0;
  }

  /** The driver's state as plain data (a saved rewind moment), and back. */
  toJSON(): { readonly hz: number; readonly accumulator: number; readonly edges: readonly number[]; readonly carried: readonly number[] } {
    return { hz: 1 / this.dt, accumulator: this.#accumulator, edges: [...this.#edges], carried: [...this.#carried] };
  }

  static fromJSON(state: {
    readonly hz: number;
    readonly accumulator: number;
    readonly edges: readonly number[];
    readonly carried: readonly number[];
  }): FixedDriver {
    const driver = new FixedDriver(state.hz, state.edges.length);
    driver.#accumulator = state.accumulator;
    driver.#edges.set(state.edges);
    driver.#carried.set(state.carried);
    return driver;
  }

  /** Take another driver's state (one `clone` made earlier): what development rewind puts back. */
  copyFrom(other: FixedDriver): void {
    this.#accumulator = other.#accumulator;
    this.#edges.set(other.#edges);
    this.#carried.set(other.#carried);
  }

  /** A driver in the same state, for a replay that branches. */
  clone(): FixedDriver {
    const copy = new FixedDriver(1 / this.dt, this.#keys);
    copy.#accumulator = this.#accumulator;
    copy.#edges.set(this.#edges);
    copy.#carried.set(this.#carried);
    return copy;
  }

  /**
   * Take a frame of `frameDt` seconds, whose raw key flags are `keys` (down now, and the edges since the last frame), and run
   * the steps it holds. With no step this frame the edges wait for the next. Returns how many steps ran.
   */
  advance(frameDt: number, keys: Uint8Array, run: StepRunner): number {
    for (let i = 0; i < this.#keys; i++) this.#edges[i] = (this.#edges[i] as number) | ((keys[i] as number) & EDGES);
    this.#accumulator += frameDt > 0 ? frameDt : 0;
    let steps = 0;
    // The epsilon keeps sixty frames of 1/60 s from running 59 steps: a sum of 1/60s is a hair short of a step now and then.
    while (this.#accumulator >= this.dt - 1e-9 && steps < MAX_STEPS_PER_FRAME) {
      this.#accumulator -= this.dt;
      for (let i = 0; i < this.#keys; i++) {
        const edges = this.#edges[i] as number;
        // Down if held now, or if it went down since the last step (a tap that is over by now still counts for one step).
        const input = ((keys[i] as number) & TSE_KEY_DOWN) | (edges & TSE_KEY_PRESSED ? TSE_KEY_DOWN : 0) | edges;
        this.#input[i] = input;
        this.#update[i] = input | (this.#carried[i] as number);
        this.#edges[i] = 0;
      }
      if (run(this.#input, this.#update, this.dt)) {
        for (let i = 0; i < this.#keys; i++) this.#carried[i] = (this.#carried[i] as number) | ((this.#input[i] as number) & EDGES);
      } else this.#carried.fill(0);
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.#accumulator = 0;
    else if (this.#accumulator < 0) this.#accumulator = 0;
    return steps;
  }
}
