/**
 * A development profiler: where a frame's script time goes, by component and by phase. `rge dev`'s inspector turns it on and shows
 * it as a table (the slowest components first); a test or a tool can use it too. Off by default, and when off the World's loops
 * do not look at the clock at all: one check per step and per flush.
 *
 *   const profiler = startProfiling();
 *   … run some frames …
 *   const report = profiler.take(); // the averages since the last take, then starts a new window
 */
import type { GameObject } from "./GameObject.ts";

/** One component (by its name), averaged per frame over the window. Times are milliseconds. */
export interface ProfileEntry {
  /** The component's name (`Enemy`), or the built-in's (`AnimatedSprite`). */
  readonly name: string;
  /** How many of them ran something, at most, in one frame of the window. */
  readonly instances: number;
  readonly input: number;
  readonly update: number;
  readonly render: number;
  /** `input + update + render`. */
  readonly total: number;
  /** Renders per frame. */
  readonly renders: number;
}

/** What a window of frames cost. */
export interface ProfileReport {
  /** Frames in the window. */
  readonly frames: number;
  /** Each phase's milliseconds per frame (`steps`, `collisions`, `build`, `draw`, as the player names them). */
  readonly phases: Readonly<Record<string, number>>;
  /** The components, the most expensive first. */
  readonly components: readonly ProfileEntry[];
}

/** What a component did: input, update, render (ms), renders, and the instances seen in the current frame and at most in one. */
interface Row {
  input: number;
  update: number;
  render: number;
  renders: number;
  frameInstances: Set<GameObject>;
  maxInstances: number;
}

/** What `Profiler.add` counts: an `onInput`, an `onUpdate` (with the handlers' timers), or a render. */
export const PROFILE_INPUT = 0;
export const PROFILE_UPDATE = 1;
export const PROFILE_RENDER = 2;
export type ProfileKind = typeof PROFILE_INPUT | typeof PROFILE_UPDATE | typeof PROFILE_RENDER;

const now: () => number = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

export class Profiler {
  readonly #rows = new Map<string, Row>();
  readonly #phases = new Map<string, number>();
  #frames = 0;

  /** The clock, in milliseconds. */
  readonly now = now;

  /** Count `ms` of work of one kind by `object`. */
  add(object: GameObject, kind: ProfileKind, ms: number): void {
    const name = object.constructor.name;
    let row = this.#rows.get(name);
    if (row === undefined) {
      row = { input: 0, update: 0, render: 0, renders: 0, frameInstances: new Set(), maxInstances: 0 };
      this.#rows.set(name, row);
    }
    if (kind === PROFILE_INPUT) row.input += ms;
    else if (kind === PROFILE_UPDATE) row.update += ms;
    else {
      row.render += ms;
      row.renders++;
    }
    row.frameInstances.add(object);
  }

  /** Count `ms` of a phase of the frame. */
  phase(name: string, ms: number): void {
    this.#phases.set(name, (this.#phases.get(name) ?? 0) + ms);
  }

  /** A frame ended: what the player calls once per frame. */
  frame(): void {
    this.#frames++;
    for (const row of this.#rows.values()) {
      if (row.frameInstances.size > row.maxInstances) row.maxInstances = row.frameInstances.size;
      row.frameInstances.clear();
    }
  }

  /** The window so far, per frame, without ending it. */
  peek(): ProfileReport {
    const frames = Math.max(1, this.#frames);
    const components = [...this.#rows].map(([name, row]): ProfileEntry => {
      const instances = Math.max(row.maxInstances, row.frameInstances.size);
      return {
        name,
        instances,
        input: row.input / frames,
        update: row.update / frames,
        render: row.render / frames,
        total: (row.input + row.update + row.render) / frames,
        renders: row.renders / frames,
      };
    });
    components.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { frames: this.#frames, phases: Object.fromEntries([...this.#phases].map(([name, ms]) => [name, ms / frames])), components };
  }

  /** The window so far, per frame; then a new window starts. */
  take(): ProfileReport {
    const report = this.peek();
    this.#rows.clear();
    this.#phases.clear();
    this.#frames = 0;
    return report;
  }
}

let active: Profiler | null = null;

/** The running profiler, or null: what the World and the player check before timing anything. */
export function activeProfiler(): Profiler | null {
  return active;
}

/** Start profiling (a new profiler, replacing any running one) and return it. Development only. */
export function startProfiling(): Profiler {
  active = new Profiler();
  return active;
}

/** Stop profiling: the World and the player stop looking at the clock. */
export function stopProfiling(): void {
  active = null;
}
