/**
 * Sequences, for cutscenes: a list of steps run one after another as the game's time passes, written as data in a `.ts` file.
 *
 *     export const intro = (show: (text: string) => void, light: (radius: number) => void) =>
 *       sequence([
 *         tween(1.2, (t) => light(56 * t)),
 *         wait(0.3),
 *         call(() => show("The lantern lights the way.")),
 *         wait(1.5),
 *         call(() => show("")),
 *       ]);
 *
 * A component keeps one in a `useMutable` field and steps it from `useUpdate` (`if (!s.intro.step(dt)) s.intro = null;`), or the
 * game's rules keep it; a test steps it without the engine. It runs on the time it is given, so under the fixed timestep it plays the
 * same every time and replays. A step that ends part-way through a `step(dt)` hands the rest of `dt` to the next one, so a sequence
 * takes exactly as long as its steps add up to, whatever the step size. Where it is (`position`) is plain data a save can keep.
 */

/** One step of a sequence: what `sequence`, `wait`, `call` and the rest make. */
export interface Step {
  /**
   * Advance by `dt` seconds. Returns the time left over once this step is done (0 or more), or -1 while it still runs and has used
   * all of `dt`.
   */
  advance(dt: number): number;
  /** Back to its start, for a sequence that is played again. */
  reset(): void;
  /** Where it is, as plain data (see `Sequence.position`). */
  save(): unknown;
  /** Put it back where `save` said it was. */
  load(saved: unknown): void;
}

/** Wait `seconds` of game time. */
export function wait(seconds: number): Step {
  let elapsed = 0;
  return {
    advance(dt) {
      elapsed += dt;
      return elapsed >= seconds ? elapsed - seconds : -1;
    },
    reset() {
      elapsed = 0;
    },
    save: () => elapsed,
    load(saved) {
      elapsed = typeof saved === "number" ? saved : 0;
    },
  };
}

/** Call `fn` once, taking no time: show a line, play a sound, start a fade. */
export function call(fn: () => void): Step {
  let done = false;
  return {
    advance(dt) {
      if (!done) {
        done = true;
        fn();
      }
      return dt;
    },
    reset() {
      done = false;
    },
    save: () => done,
    load(saved) {
      done = saved === true;
    },
  };
}

/** Wait until `until()` is true (asked each step): the player closing a dialogue, a character reaching a spot. */
export function waitFor(until: () => boolean): Step {
  return {
    advance: (dt) => (until() ? dt : -1),
    reset() {},
    save: () => null,
    load() {},
  };
}

/** How a tween's progress (0 to 1 over its time) is shaped. */
export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;
export const easeIn: Ease = (t) => t * t;
export const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/**
 * Over `seconds`, call `set` each step with the progress, 0 to 1 (shaped by `ease`), ending on exactly 1: move a camera, grow a light,
 * fade a sound. `set(1)` is called once when it ends, even for a `seconds` of 0.
 */
export function tween(seconds: number, set: (t: number) => void, ease: Ease = linear): Step {
  let elapsed = 0;
  return {
    advance(dt) {
      elapsed += dt;
      if (seconds <= 0 || elapsed >= seconds) {
        set(1);
        return seconds <= 0 ? dt : elapsed - seconds;
      }
      set(ease(elapsed / seconds));
      return -1;
    },
    reset() {
      elapsed = 0;
    },
    save: () => elapsed,
    load(saved) {
      elapsed = typeof saved === "number" ? saved : 0;
    },
  };
}

/** Run every step at once; done when the last of them is. What is left over is what the longest left over. */
export function parallel(steps: readonly Step[]): Step {
  const done = steps.map(() => false);
  const left = steps.map(() => 0);
  return {
    advance(dt) {
      let running = false;
      for (let i = 0; i < steps.length; i++) {
        if (done[i]) {
          left[i] = (left[i] as number) + dt;
          continue;
        }
        const rest = (steps[i] as Step).advance(dt);
        if (rest < 0) running = true;
        else {
          done[i] = true;
          left[i] = rest;
        }
      }
      if (running) return -1;
      return Math.min(...left, dt);
    },
    reset() {
      done.fill(false);
      left.fill(0);
      for (const step of steps) step.reset();
    },
    save: () => ({ done: [...done], steps: steps.map((s) => s.save()) }),
    load(saved) {
      const s = saved as { done?: boolean[]; steps?: unknown[] } | null;
      for (let i = 0; i < steps.length; i++) {
        done[i] = s?.done?.[i] === true;
        left[i] = 0;
        (steps[i] as Step).load(s?.steps?.[i]);
      }
    },
  };
}

/** Where a sequence is, as plain data: which step, and where that step is. */
export interface SequencePosition {
  readonly index: number;
  readonly step: unknown;
}

/** A sequence of steps, itself a step (so sequences nest, and `parallel` takes them). */
export interface Sequence extends Step {
  /**
   * Advance by `dt` seconds of game time, running as many steps as that reaches. Returns true while it still has steps to run, false
   * once it is done (and from then on).
   */
  step(dt: number): boolean;
  /** Whether every step has run. */
  readonly done: boolean;
  /** Where it is, for a save: `{ index, step }`. */
  readonly position: SequencePosition;
  /** Carry on from a position a save kept (the same sequence, built again by the same code). */
  restore(position: SequencePosition): void;
}

/** Steps one after another. */
export function sequence(steps: readonly Step[]): Sequence {
  let index = 0;
  const advance = (dt: number): number => {
    let left = dt;
    while (index < steps.length) {
      const rest = (steps[index] as Step).advance(left);
      if (rest < 0) return -1;
      left = rest;
      index++;
    }
    return left;
  };
  const self: Sequence = {
    advance,
    step(dt) {
      if (index >= steps.length) return false;
      return advance(dt >= 0 && Number.isFinite(dt) ? dt : 0) < 0;
    },
    get done() {
      return index >= steps.length;
    },
    get position() {
      return { index, step: index < steps.length ? (steps[index] as Step).save() : null };
    },
    restore(position) {
      self.load(position);
    },
    reset() {
      index = 0;
      for (const step of steps) step.reset();
    },
    save: () => self.position,
    load(saved) {
      const p = saved as SequencePosition | null;
      self.reset();
      index = Math.max(0, Math.min(steps.length, typeof p?.index === "number" ? p.index : 0));
      // The steps before `index` have run: a `call` among them must not run again.
      for (let i = 0; i < index; i++) (steps[i] as Step).load(true);
      if (index < steps.length) (steps[index] as Step).load(p?.step);
    },
  };
  return self;
}
