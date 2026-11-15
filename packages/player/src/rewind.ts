/**
 * Rewind in `tse dev` (DESIGN.md, "Rewind in `tse dev`"): record every frame's input while playing, snapshot the game every second, and go
 * back to any recorded frame by restoring the snapshot before it and playing the recorded input again from there, muted and
 * undrawn, to that frame. While paused there, a hot reload plays the same input again with the new code, so the same moment shows
 * with the fix; resuming plays on with live input and drops the recorded future.
 *
 * It rests on the game being a function of its input step by step (the fixed step, no `Math.random` in the runtime). What a
 * snapshot cannot hold (a built-in's own state, a timer, a `useMount` that changes state again when the tree is rebuilt) can make
 * a replay differ: each frame's state is hashed as it is played, and a replay that does not match names the first frame that
 * differs.
 */
import { captureHotState, type GameStore, type HotState } from "@tsengine/runtime";

import type { Backend } from "./backend.ts";
import { DrawList } from "./draw.ts";
import { FixedDriver } from "./fixed.ts";
import { createPlayer } from "./loop.ts";
import type { Player, PlayerClock, PlayerConfig } from "./loop.ts";
import {
  KEYS,
  KEY_INDEX,
  TSE_IN_DT,
  TSE_IN_HEIGHT,
  TSE_IN_LEN,
  TSE_IN_MOUSE_X,
  TSE_IN_MOUSE_Y,
  TSE_IN_QUIT,
  TSE_IN_WHEEL,
  TSE_IN_WIDTH,
  TSE_KEY_DOWN,
  TSE_KEY_PRESSED,
  TSE_KEY_RELEASED,
} from "./protocol.ts";
import { RecordingBackend } from "./recording.ts";
import type { InputFrame } from "./recording.ts";

export interface RewindOptions {
  /** The game's config now (a hot reload changes it). */
  readonly config: () => PlayerConfig;
  /** The game's states, by name. */
  readonly stores: () => ReadonlyMap<string, GameStore<unknown>>;
  /** Frames between snapshots. Default 60 (a second). */
  readonly snapshotEvery?: number;
  /** Frames of input kept. Default 5 minutes at 60 a second. */
  readonly capacity?: number;
  /** Told what happened: a divergence, a saved moment. */
  readonly log?: (message: string) => void;
  /** Where "save a moment" writes (the dev runner writes a file). */
  readonly saveMoment?: (moment: Moment) => void;
}

/** A snapshot: everything a frame needs to start from. */
interface Snapshot {
  readonly frame: number;
  readonly hot: HotState;
  readonly clock: PlayerClock;
  readonly stores: ReadonlyMap<string, Record<string, unknown>>;
}

/**
 * A moment saved for a test: the game at a frame and the input that followed, which `replayMoment` plays again. The tree's state
 * is by path, as hot reload keeps it.
 */
export interface Moment {
  readonly version: 1;
  /** The frame the moment starts at. */
  readonly frame: number;
  readonly stores: Readonly<Record<string, Record<string, unknown>>>;
  readonly tree: readonly (readonly [string, Record<string, unknown>])[];
  readonly clock: {
    readonly driver: ReturnType<FixedDriver["toJSON"]> | null;
    readonly animationTime: number;
    readonly frozen: number;
    readonly values: readonly number[];
    readonly keys: readonly number[];
    readonly hovered: string | null;
  };
  /** The input of each frame after it, in the format of a recording (`InputFrame`). */
  readonly frames: readonly InputFrame[];
}

/** The keys rewind takes while it is on: these never reach the game while paused. */
const PAUSE_KEY = KEY_INDEX.get("F2") as number;
const SAVE_KEY = KEY_INDEX.get("F4") as number;
const LEFT = KEY_INDEX.get("ArrowLeft") as number;
const RIGHT = KEY_INDEX.get("ArrowRight") as number;
const UP = KEY_INDEX.get("ArrowUp") as number;
const DOWN = KEY_INDEX.get("ArrowDown") as number;

/** A number for a frame's state: the game states' values and the tree's state, walked in order. Equal states hash equal. */
export function hashState(stores: ReadonlyMap<string, GameStore<unknown>>, hot: HotState): number {
  let h = 2166136261;
  const mix = (n: number): void => {
    h = Math.imul(h ^ n, 16777619);
  };
  const text = (s: string): void => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const value = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof v === "number") {
      // Rounded a little, so the hash of a float is the same however it was printed.
      mix(Math.round(v * 1e6) | 0);
      mix(Math.round(v) | 0);
    } else if (typeof v === "string") text(v);
    else if (typeof v === "boolean") mix(v ? 1 : 2);
    else if (v === null || v === undefined) mix(3);
    else if (Array.isArray(v)) {
      mix(v.length);
      for (const item of v) value(item, depth + 1);
    } else if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      for (const [k, item] of Object.entries(v)) {
        text(k);
        value(item, depth + 1);
      }
    } else mix(7);
  };
  for (const [key, store] of stores) {
    text(key);
    value(store.values(), 0);
  }
  for (const [path, saved] of hot) {
    text(path);
    value(saved, 0);
  }
  return h >>> 0;
}

export class Rewind {
  readonly #real: Backend;
  readonly #options: RewindOptions;
  readonly #every: number;
  readonly #capacity: number;
  /** The backend the player is given: the real one, recording each frame's input, or fed recorded input during a replay. */
  readonly backend: Backend;
  #player: Player | null = null;
  /** `inputs[k]` is the input frame k read: what the frame before it wrote. Kept from `base`. */
  #inputs: { readonly values: Float64Array; readonly keys: Uint8Array }[] = [];
  #hashes: number[] = [];
  #snapshots: Snapshot[] = [];
  /** The first frame still kept. */
  #base = 0;
  /** Frames played live so far. */
  #live = 0;
  /** The frame being played now (live): the input its `frame` call writes is the next frame's. */
  #playing = 0;
  #mode: "live" | "feed" = "live";
  /** In a replay: the input the next `frame` call writes, and whether that frame is drawn. */
  #feed: { readonly values: Float64Array; readonly keys: Uint8Array } | null = null;
  #present = false;
  /** The last frame drawn, shown again while paused. */
  #last: { records: Float64Array; length: number; texts: readonly string[]; clear: number } | null = null;
  #paused: number | null = null;
  /** The real input while paused, which rewind reads its keys from. */
  readonly #pausedValues = new Float64Array(TSE_IN_LEN);
  readonly #pausedKeys = new Uint8Array(KEYS.length);
  readonly #bar = new DrawList();
  /** The first frame a replay found different from the recording, if any. */
  divergence: number | null = null;

  constructor(real: Backend, options: RewindOptions) {
    this.#real = real;
    this.#options = options;
    this.#every = Math.max(1, options.snapshotEvery ?? 60);
    this.#capacity = Math.max(this.#every * 2, options.capacity ?? 5 * 60 * 60);
    const self = this;
    const overrides: Partial<Backend> = {
      frame(clear, records, length, texts, values, keys) {
        self.#last = { records, length, texts, clear };
        if (self.#mode === "live") {
          real.frame(clear, records, length, texts, values, keys);
          self.#recordInput(values, keys);
          return;
        }
        if (self.#present) real.frame(clear, records, length, texts, self.#pausedValues, self.#pausedKeys);
        const fed = self.#feed;
        if (fed !== null) {
          values.set(fed.values);
          keys.set(fed.keys);
        } else {
          values.fill(0);
          keys.fill(0);
        }
      },
      playSound(handle, volume) {
        if (self.#mode === "live") real.playSound(handle, volume);
      },
      playMusic(handle, volume, loop) {
        if (self.#mode === "live") real.playMusic?.(handle, volume, loop);
      },
    };
    this.backend = new Proxy(real, {
      get(target, prop, receiver) {
        if (Object.hasOwn(overrides, prop)) return overrides[prop as keyof Backend];
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  /** The player made with `backend`. Takes the first snapshot: the game as it starts. */
  attach(player: Player): void {
    this.#player = player;
    this.#inputs = [{ values: player.snapshotClock().values, keys: player.snapshotClock().keys }];
    this.#hashes = [this.#hash()];
    this.#snapshot(0);
  }

  /** Whether the game is paused for rewind, and at which frame. */
  get paused(): number | null {
    return this.#paused;
  }

  /** The recorded frames: the first kept and the last played. */
  get range(): { readonly from: number; readonly to: number } {
    return { from: this.#base, to: this.#live };
  }

  /** The frames snapshots were taken at. */
  get snapshotFrames(): readonly number[] {
    return this.#snapshots.map((s) => s.frame);
  }

  /** One frame of the dev loop, in place of `player.step()`. Returns false once the window asks to close. */
  step(): boolean {
    const player = this.#require();
    if (this.#paused !== null) return this.#pausedFrame();
    this.#playing = this.#live + 1;
    const open = player.step();
    this.#live = this.#playing;
    this.#hashes[this.#live - this.#base] = this.#hash();
    if (this.#live % this.#every === 0) this.#snapshot(this.#live);
    this.#trim();
    const keys = this.#inputs[this.#live + 1 - this.#base]?.keys;
    if (keys !== undefined && ((keys[PAUSE_KEY] as number) & TSE_KEY_PRESSED) !== 0) this.pause();
    return open;
  }

  /** Stop at the frame just played. */
  pause(): void {
    this.#paused = this.#live;
    this.#options.log?.(`rewind: paused at frame ${this.#live} (← → a frame, ↑ ↓ a second, F4 saves the moment, F2 plays on)`);
  }

  /** Go to a recorded frame: restore the snapshot before it and play the recorded input to it. Pauses there. */
  seek(target: number): void {
    const to = Math.max(this.#base + 1, Math.min(this.#live, Math.round(target)));
    const snapshot = [...this.#snapshots].reverse().find((s) => s.frame < to) ?? this.#snapshots[0];
    if (snapshot === undefined) return;
    this.#replay(snapshot, to);
    this.#paused = to;
  }

  /** Play on from the paused frame with live input: the recorded future is dropped. */
  resume(): void {
    const at = this.#paused;
    if (at === null) return;
    this.#paused = null;
    this.#live = at;
    this.#inputs.length = at + 1 - this.#base + 1;
    this.#hashes.length = at + 1 - this.#base;
    this.#snapshots = this.#snapshots.filter((s) => s.frame <= at);
    this.#mode = "live";
    this.#options.log?.(`rewind: playing on from frame ${at}`);
  }

  /** After a hot reload: while paused, play the same input again with the new code, to the same frame. */
  reloaded(): void {
    if (this.#paused !== null) {
      const at = this.#paused;
      this.seek(at);
      this.#options.log?.(
        `rewind: frame ${at} again, with the new code${this.divergence !== null ? ` (it plays differently from frame ${this.divergence})` : ""}`
      );
    }
  }

  /** The moment from the snapshot before the paused frame (or the last one) to it, for a test. */
  moment(): Moment {
    const at = this.#paused ?? this.#live;
    const snapshot = [...this.#snapshots].reverse().find((s) => s.frame < at) ?? this.#snapshots[0]!;
    const frames: InputFrame[] = [];
    for (let k = snapshot.frame + 1; k <= at; k++) {
      const input = this.#inputs[k - this.#base];
      if (input !== undefined) frames.push(inputFrame(input.values, input.keys));
    }
    return {
      version: 1,
      frame: snapshot.frame,
      stores: Object.fromEntries(snapshot.stores),
      tree: [...snapshot.hot].map(([path, saved]) => [path, { ...saved }] as const),
      clock: {
        driver: snapshot.clock.driver?.toJSON() ?? null,
        animationTime: snapshot.clock.animationTime,
        frozen: snapshot.clock.frozen,
        values: [...snapshot.clock.values],
        keys: [...snapshot.clock.keys],
        hovered: snapshot.clock.hovered,
      },
      frames,
    };
  }

  #require(): Player {
    if (this.#player === null) throw new Error("Rewind.attach(player) first.");
    return this.#player;
  }

  #recordInput(values: Float64Array, keys: Uint8Array): void {
    // Written at the end of the frame being played: the input of the next one.
    this.#inputs[this.#playing + 1 - this.#base] = { values: values.slice(), keys: keys.slice() };
  }

  #hash(): number {
    const player = this.#require();
    const root = player.world.root.children[0];
    return hashState(this.#options.stores(), root === undefined ? new Map() : captureHotState(root));
  }

  #snapshot(frame: number): void {
    const player = this.#require();
    const root = player.world.root.children[0];
    const stores = new Map<string, Record<string, unknown>>();
    for (const [key, store] of this.#options.stores()) stores.set(key, structuredClone(store.values()));
    // A copy, not the live values: a state may be an object that changes in place (a body moves itself).
    const hot = new Map<string, Record<string, unknown>>();
    if (root !== undefined) for (const [path, saved] of captureHotState(root)) hot.set(path, copyState(saved));
    this.#snapshots.push({ frame, hot, clock: player.snapshotClock(), stores });
  }

  /** Forget what is older than the capacity, keeping a snapshot to start from. */
  #trim(): void {
    const keepFrom = this.#live - this.#capacity;
    if (keepFrom <= this.#base) return;
    const first = this.#snapshots.findIndex((s) => s.frame >= keepFrom);
    if (first <= 0) return;
    const from = (this.#snapshots[first] as Snapshot).frame;
    this.#snapshots = this.#snapshots.slice(first);
    this.#inputs = this.#inputs.slice(from - this.#base);
    this.#hashes = this.#hashes.slice(from - this.#base);
    this.#base = from;
  }

  /** Restore `snapshot` and play the recorded input from it to frame `to`, muted, drawing only the last; checking each frame's state. */
  #replay(snapshot: Snapshot, to: number): void {
    const player = this.#require();
    for (const [key, store] of this.#options.stores()) {
      const values = snapshot.stores.get(key);
      if (values !== undefined) store.restore(structuredClone(values));
    }
    if (!player.restoreTo(this.#options.config(), snapshot.hot, snapshot.clock)) return;
    this.#mode = "feed";
    this.divergence = null;
    for (let k = snapshot.frame + 1; k <= to; k++) {
      this.#feed = this.#inputs[k + 1 - this.#base] ?? null;
      this.#present = k === to;
      player.step();
      const recorded = this.#hashes[k - this.#base];
      if (this.divergence === null && recorded !== undefined && recorded !== this.#hash()) {
        this.divergence = k;
        this.#options.log?.(
          `rewind: frame ${k} plays differently from when it was recorded. Something it depends on is not a function of the input: Math.random or Date.now in the game's code, a timer, or a useMount that changes state when the tree is rebuilt.`
        );
      }
    }
    this.#feed = null;
    this.#present = false;
  }

  /** A paused frame: the last frame drawn again with the timeline over it, and rewind's keys. */
  #pausedFrame(): boolean {
    const last = this.#last;
    const list = this.#bar;
    list.reset();
    if (last !== null) {
      list.appendFrom(last.records, 0, last.length, 0, false);
      list.texts.push(...last.texts);
    }
    const width = this.#width();
    const { from, to } = this.range;
    const at = this.#paused ?? to;
    const W = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    list.view({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    list.rect({ ...W, x: 8, y: 6 }, width - 16, 6, 0x000000aa);
    const span = Math.max(1, to - from);
    for (const frame of this.snapshotFrames) list.rect({ ...W, x: 8 + ((width - 16) * (frame - from)) / span, y: 6 }, 1, 6, 0xffffff55);
    list.rect({ ...W, x: 8 + ((width - 16) * (at - from)) / span - 1, y: 4 }, 3, 10, 0xffd54fff);
    const label = `REWIND  frame ${at} of ${from}–${to}${this.divergence !== null ? `   differs from frame ${this.divergence}` : ""}   ← → frame  ↑ ↓ second  F4 save  F2 play`;
    list.rect({ ...W, x: 8, y: 16 }, label.length * 6 + 6, 12, 0x000000cc);
    list.text({ ...W, x: 11, y: 17 }, label, 10, this.divergence !== null ? 0xff8a65ff : 0xffffffff);
    this.#real.frame(last?.clear ?? 0, list.records, list.length, list.texts, this.#pausedValues, this.#pausedKeys);
    const keys = this.#pausedKeys;
    const pressed = (key: number): boolean => ((keys[key] as number) & TSE_KEY_PRESSED) !== 0;
    if (pressed(PAUSE_KEY)) this.resume();
    else if (pressed(LEFT)) this.seek(at - 1);
    else if (pressed(RIGHT)) this.seek(at + 1);
    else if (pressed(UP)) this.seek(at - this.#every);
    else if (pressed(DOWN)) this.seek(at + this.#every);
    else if (pressed(SAVE_KEY)) {
      const moment = this.moment();
      this.#options.saveMoment?.(moment);
      this.#options.log?.(`rewind: saved the moment from frame ${moment.frame} to ${at} (${moment.frames.length} frames)`);
    }
    return this.#pausedValues[TSE_IN_QUIT] === 0;
  }

  #width(): number {
    const w = this.#pausedValues[TSE_IN_WIDTH] as number;
    return w > 0 ? w : 640;
  }
}

/** A deep copy of a component's saved state; a value that cannot be copied (a function) is kept as it is. */
function copyState(saved: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(saved)) {
    try {
      out[key] = structuredClone(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** A recorded frame's input as an `InputFrame` (what `RecordingBackend.queueInput` and a moment take). */
function inputFrame(values: Float64Array, keys: Uint8Array): InputFrame {
  const pressed: string[] = [];
  const down: string[] = [];
  const released: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const flags = keys[i] as number;
    if (flags === 0) continue;
    const name = KEYS[i] as string;
    if ((flags & TSE_KEY_PRESSED) !== 0) pressed.push(name);
    else if ((flags & TSE_KEY_DOWN) !== 0) down.push(name);
    if ((flags & TSE_KEY_RELEASED) !== 0) released.push(name);
  }
  return {
    dt: values[TSE_IN_DT] as number,
    width: values[TSE_IN_WIDTH] as number,
    height: values[TSE_IN_HEIGHT] as number,
    mouse: { x: values[TSE_IN_MOUSE_X] as number, y: values[TSE_IN_MOUSE_Y] as number },
    ...(values[TSE_IN_WHEEL] !== 0 ? { wheel: values[TSE_IN_WHEEL] as number } : {}),
    ...(pressed.length > 0 ? { pressed } : {}),
    ...(down.length > 0 ? { down } : {}),
    ...(released.length > 0 ? { released } : {}),
  };
}

/**
 * Play a saved moment again, as a test does: the game is built, given the moment's state (its game states matched to `stores` by
 * export name, its tree by path), and stepped through the moment's input on a recording backend. `observe` is called after each
 * frame. This is how a moment saved in `tse dev` (F4 while paused) becomes a replay test.
 */
export function replayMoment<T>(
  config: PlayerConfig,
  moment: Moment,
  options: { readonly stores?: Readonly<Record<string, GameStore<unknown>>>; readonly observe: (player: Player) => T }
): T[] {
  const backend = new RecordingBackend();
  const player = createPlayer(backend, { ...config, warn: () => {} });
  try {
    for (const [key, values] of Object.entries(moment.stores)) {
      const name = key.slice(key.lastIndexOf("#") + 1);
      options.stores?.[name]?.restore(structuredClone(values));
    }
    const clock: PlayerClock = {
      driver: moment.clock.driver === null ? null : FixedDriver.fromJSON(moment.clock.driver),
      animationTime: moment.clock.animationTime,
      frozen: moment.clock.frozen,
      values: Float64Array.from(moment.clock.values),
      keys: Uint8Array.from(moment.clock.keys),
      hovered: moment.clock.hovered,
    };
    if (!player.restoreTo(config, new Map(moment.tree.map(([path, saved]) => [path, { ...saved }])), clock))
      throw player.failure?.error ?? new Error("The moment's game did not build.");
    // The first frame's input is the restored clock's; each frame then writes the next one's, as the recording did.
    for (const frame of moment.frames.slice(1)) backend.queueInput(frame);
    const states: T[] = [];
    for (let i = 0; i < moment.frames.length; i++) {
      player.step();
      states.push(options.observe(player));
    }
    return states;
  } finally {
    player.close();
  }
}
