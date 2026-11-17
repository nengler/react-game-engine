/**
 * A game you drive a step at a time, without a window: what `tse session` and `tse mcp` serve, and what a tool or a test can use
 * directly. Unlike `runScript`, which plays a whole script and returns, a session stays open: step, look, decide, step again,
 * keep a snapshot and go back to it.
 *
 *     const session = new Session(gameConfig, { bindings });
 *     session.input("right*30, jump");
 *     session.step({ until: { text: "ROOM 2" }, maxSteps: 600 });
 *     console.log(session.sceneText({ only: "components" }));
 *     session.snapshot("before-boss");
 *
 * It runs on a recording backend, so it draws nothing; every frame of input it has played is kept (`history`), so the same run
 * can be drawn to PNGs afterwards (`tse screenshot --frames-file`) or played again with new code (`replay`).
 */
import {
  captureHotState,
  componentState,
  describeScene,
  findComponents,
  liveGameStores,
  sceneMap,
  sceneText,
  Text,
  type DescribeOptions,
  type MapOptions,
  type GameObject,
  type GameStore,
  type HotState,
  type SceneNode,
} from "@tsengine/runtime";

import { createPlayer, type Player, type PlayerClock, type PlayerConfig } from "./loop.ts";
import { applyInputFrame, RecordingBackend, type InputFrame } from "./recording.ts";
import { hashState } from "./rewind.ts";
import { onScreen } from "./screen.ts";
import { parseInputScript, type InputBindings, type ScriptOptions } from "./script.ts";

export interface SessionOptions {
  /** Action names an input script may use (`jump`, `right`), as the game's `game.ts` exports them. */
  readonly bindings?: InputBindings;
  /** How the game's canvas sits in the window, for `click@x,y` (see `ScriptOptions.screen`). */
  readonly screen?: ScriptOptions["screen"];
  /** Names for the game states, by store (a game state's export name, `useGame`). Unnamed ones are `state0`, `state1`, … */
  readonly storeNames?: ReadonlyMap<GameStore<unknown>, string>;
  /** Saved data the backend starts with (name to text), as `RecordingOptions.storage`. */
  readonly storage?: Readonly<Record<string, string>>;
}

/**
 * When `step` stops early. Every field given must hold. A `path` is dotted (`s.hp`, `enemies.length`, `towers.0.level`): into the
 * component's state with `component`, else into the game state (`useGame.wave`, or just `wave` when the game has one state).
 */
export interface Until {
  /** A `<Text>` on screen contains this. */
  readonly text?: string;
  /** No `<Text>` on screen contains this. */
  readonly gone?: string;
  /** A component (by name or class name) is in the tree; with `path`, the first one's state is read. */
  readonly component?: string;
  /** With `component`, the component is not in the tree (or, with `path`, no longer passes). */
  readonly absent?: boolean;
  readonly path?: string;
  readonly equals?: unknown;
  readonly not?: unknown;
  readonly above?: number;
  readonly below?: number;
}

export interface StepOptions {
  /** Steps to run with nothing pressed. Default 1, or `maxSteps` with `until`. */
  readonly count?: number;
  /** Stop as soon as this holds (it is checked before the first step, and after each). */
  readonly until?: Until;
  /** With `until`: the most steps to run. Default 3600 (a minute). */
  readonly maxSteps?: number;
}

export interface StepResult {
  /** Steps run. */
  readonly steps: number;
  /** With `until`: whether it came true (false: `maxSteps` ran out first). */
  readonly reached?: boolean;
}

/** A snapshot kept by name: everything the next step needs to start from, and the input that led there. */
interface SessionSnapshot {
  readonly frame: number;
  readonly hot: HotState;
  readonly clock: PlayerClock;
  readonly stores: ReadonlyMap<GameStore<unknown>, Record<string, unknown>>;
  readonly history: readonly InputFrame[];
  readonly mouse: { readonly x: number; readonly y: number } | undefined;
}

/** A recording backend that keeps only the latest frame, and lets the session write each step's input itself. */
class SessionBackend extends RecordingBackend {
  input: Float64Array | null = null;
  keys: Uint8Array | null = null;
  typedNow = "";

  override frame(
    clearColor: number,
    records: Float64Array,
    length: number,
    texts: readonly string[],
    input: Float64Array,
    keys: Uint8Array
  ): void {
    super.frame(clearColor, records, length, texts, input, keys);
    this.input = input;
    this.keys = keys;
  }

  override typed(): string {
    return this.typedNow;
  }
}

export class Session {
  readonly #config: PlayerConfig;
  readonly #options: SessionOptions;
  #backend: SessionBackend;
  #player: Player;
  #frame = 0;
  #history: InputFrame[] = [];
  #mouse: { x: number; y: number } | undefined;
  #warnings: string[] = [];
  readonly #snapshots = new Map<string, SessionSnapshot>();

  constructor(config: PlayerConfig, options: SessionOptions = {}) {
    this.#config = config;
    this.#options = options;
    const started = this.#start();
    this.#backend = started.backend;
    this.#player = started.player;
  }

  /** Build the game afresh and run the warm-up step, which mounts and settles the tree (as `runScript` does). */
  #start(): { backend: SessionBackend; player: Player } {
    const backend = new SessionBackend({ keepFrames: 1, ...(this.#options.storage ? { storage: this.#options.storage } : {}) });
    const player = createPlayer(backend, { ...this.#config, hidden: true, warn: (message) => this.#warnings.push(message) });
    player.step();
    return { backend, player };
  }

  /** Steps played since the game started (the warm-up not counted). */
  get frame(): number {
    return this.#frame;
  }

  /** The input of every step played, in order: what `tse screenshot --frames-file` and `replay` play again. */
  get history(): readonly InputFrame[] {
    return this.#history;
  }

  get player(): Player {
    return this.#player;
  }

  /** The game's window size, as it opened. */
  get window(): { readonly width: number; readonly height: number } {
    return { width: this.#backend.config?.width ?? 0, height: this.#backend.config?.height ?? 0 };
  }

  /** Warnings the game printed since the last call. */
  takeWarnings(): string[] {
    const out = this.#warnings;
    this.#warnings = [];
    return out;
  }

  /** The action names input scripts may use. */
  get actions(): readonly string[] {
    return Object.keys(this.#options.bindings ?? {});
  }

  /**
   * Play one frame of input: written into the player's buffers, so the step reads exactly it. Typed text is the exception: the
   * player asks for it at the end of the step before the one that sees it, so `typedNext` is what the next frame types.
   */
  #play(frame: InputFrame, typedNext = ""): void {
    const backend = this.#backend;
    if (frame.mouse !== undefined) this.#mouse = { x: frame.mouse.x, y: frame.mouse.y };
    const played: InputFrame = frame.mouse === undefined && this.#mouse !== undefined ? { ...frame, mouse: this.#mouse } : frame;
    if (backend.input !== null && backend.keys !== null)
      applyInputFrame(played, backend.input, backend.keys, backend.config?.width ?? 0, backend.config?.height ?? 0);
    backend.typedNow = typedNext;
    this.#history.push(played);
    this.#frame++;
    this.#player.step();
    const failure = this.#player.failure;
    if (failure !== null) throw failure.error;
  }

  /** Run steps with nothing pressed: `count` of them, or until `until` holds. */
  step(options: StepOptions = {}): StepResult {
    const until = options.until;
    if (until === undefined) {
      const count = Math.max(0, Math.floor(options.count ?? 1));
      for (let i = 0; i < count; i++) this.#play({});
      return { steps: count };
    }
    const max = Math.max(0, Math.floor(options.maxSteps ?? options.count ?? 3600));
    for (let steps = 0; ; steps++) {
      if (this.holds(until)) return { steps, reached: true };
      if (steps >= max) return { steps, reached: false };
      this.#play({});
    }
  }

  /** Play an input script (`"right*30, jump, _"`, see `parseInputScript`), one step a frame. Returns how many steps it ran. */
  input(script: string): number {
    const frames = parseInputScript(script, {
      ...(this.#options.bindings ? { bindings: this.#options.bindings } : {}),
      ...(this.#options.screen ? { screen: this.#options.screen } : {}),
    });
    for (const frame of frames) this.#play(frame);
    return frames.length;
  }

  /** Play recorded frames of input as they are (`InputFrame`s, as `history` keeps them). */
  play(frames: readonly InputFrame[]): number {
    for (let i = 0; i < frames.length; i++) this.#play(frames[i] as InputFrame, frames[i + 1]?.typed ?? "");
    return frames.length;
  }

  /**
   * Type text into whatever reads typed characters (a `<TextInput>`; `"\b"` is Backspace). Two steps: the game sees the text in
   * the second.
   */
  type(text: string): number {
    this.#play({}, text);
    this.#play({ typed: text });
    return 2;
  }

  #root(): GameObject | null {
    return this.#player.world.root.children[0] ?? null;
  }

  /** The tree as data (see `describeScene`). */
  scene(options: DescribeOptions = {}): SceneNode {
    return describeScene(this.#root(), options);
  }

  /** The tree as indented lines (see `sceneText`). */
  sceneText(options: DescribeOptions = {}): string {
    return sceneText(this.scene(options));
  }

  /** The level as text: its tilemaps a character a tile, with the game's things marked by letter (see `sceneMap`). */
  map(options: MapOptions = {}): string {
    return sceneMap(this.#root(), options);
  }

  /** The words of every `<Text>` in the tree, in tree order. */
  texts(): string[] {
    const root = this.#root();
    return root === null ? [] : findComponents(Text, root).map((t) => t.text);
  }

  /** Every object matching `query`: a name or class name, with a list key as `Pad[key=7]`. */
  #findAll(query: string): GameObject[] {
    const root = this.#root();
    if (root === null) return [];
    const keyed = /^(.+)\[key=(.*)\]$/.exec(query);
    if (keyed === null) return findComponents(query, root);
    return findComponents(keyed[1] as string, root).filter((object) => String(object.hotKey) === keyed[2]);
  }

  /**
   * Click something by name, as a player would: the mouse goes to its middle as last frame drew it (through the camera, or the
   * HUD's view for something in a `<Hud>`), and the left button is pressed for a step and let go the next. The click is input like
   * any other, so `history`, `replay` and a screenshot have it. `query` is a name, a class name or `Pad[key=7]`; the thing or the
   * first pressable inside it (a `<Pointer>`, `<Button>`, a `<Flex onPress>`) takes the click. Returns where the mouse went, in
   * window pixels.
   */
  press(query: string): { readonly x: number; readonly y: number } {
    const target = this.#findAll(query)[0];
    if (target === undefined) throw new Error(`press: nothing called '${query}' is in the tree.`);
    const { view, hudView, screen, pointers, hudPointersFrom } = this.#player.views;
    const inside = (object: GameObject): boolean => {
      for (let up: GameObject | null = object; up !== null; up = up.parent) if (up === target) return true;
      return false;
    };
    const index = pointers.findIndex((p) => inside(p as unknown as GameObject));
    if (index === -1) {
      const named = [...new Set(pointers.map((p) => nameOf(p as unknown as GameObject)))].slice(0, 20);
      throw new Error(
        `press: '${query}' has nothing pressable drawn in it (a <Pointer>, a <Button>, a <Flex onPress>).${named.length > 0 ? ` Pressable now: ${named.join(", ")}.` : ""}`
      );
    }
    const pressable = pointers[index] as unknown as GameObject & { contains(x: number, y: number): boolean };
    const layer = index >= hudPointersFrom ? hudView : view;
    const at = middleOf(pressable);
    const x = layer.a * at.x + layer.c * at.y + layer.e;
    const y = layer.b * at.x + layer.d * at.y + layer.f;
    if (screen !== null && !onScreen(screen, x, y))
      throw new Error(`press: '${query}' is off the screen (at ${Math.round(x)}, ${Math.round(y)} in the window).`);
    const mouse = { x, y };
    this.#play({ mouse, pressed: ["MouseLeft"], down: ["MouseLeft"] });
    this.#play({ mouse, released: ["MouseLeft"] });
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }

  /** The part of the world on screen as last frame drew it, in world pixels (the camera's view; the whole game without one). */
  view(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
    const { view, screen } = this.#player.views;
    const window =
      screen === null
        ? { left: 0, top: 0, width: this.window.width, height: this.window.height }
        : {
            left: screen.left,
            top: screen.top,
            width: screen.width * screen.scaleX,
            height: screen.height * screen.scaleY,
          };
    const det = view.a * view.d - view.b * view.c;
    const back = (wx: number, wy: number): { x: number; y: number } => {
      const dx = wx - view.e;
      const dy = wy - view.f;
      return { x: (view.d * dx - view.c * dy) / det, y: (view.a * dy - view.b * dx) / det };
    };
    const corners = [
      back(window.left, window.top),
      back(window.left + window.width, window.top),
      back(window.left, window.top + window.height),
      back(window.left + window.width, window.top + window.height),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const r = (n: number): number => Math.round(n * 10) / 10;
    return {
      x: r(Math.min(...xs)),
      y: r(Math.min(...ys)),
      width: r(Math.max(...xs) - Math.min(...xs)),
      height: r(Math.max(...ys) - Math.min(...ys)),
    };
  }

  /** Every component (or built-in) matching `query` (a name, a class name or `Pad[key=7]`), with where it is and its state. */
  find(query: string): { name: string; key?: string | number; x: number; y: number; state: Record<string, unknown> }[] {
    return this.#findAll(query).map((object) => {
      const at = object.worldTransform();
      return {
        name: object.constructor.name,
        ...(object.hotKey !== undefined ? { key: object.hotKey } : {}),
        x: Math.round(at.x * 10) / 10,
        y: Math.round(at.y * 10) / 10,
        state: componentState(object),
      };
    });
  }

  /** The game's states by name (see `SessionOptions.storeNames`): their values, without actions. */
  gameState(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, store] of this.#stores()) out[name] = store.values();
    return out;
  }

  /**
   * The game states by name: the named ones when the session was given names (a reload leaves the older build's stores behind,
   * and only the names say which are this build's), else every live one.
   */
  #stores(): Map<string, GameStore<unknown>> {
    const names = this.#options.storeNames;
    const out = new Map<string, GameStore<unknown>>();
    if (names !== undefined && names.size > 0) for (const [store, name] of names) out.set(name, store);
    else liveGameStores().forEach((store, i) => out.set(`state${i}`, store));
    return out;
  }

  /** Whether `until` holds now. */
  holds(until: Until): boolean {
    if (until.text !== undefined && !this.texts().some((t) => t.includes(until.text as string))) return false;
    if (until.gone !== undefined && this.texts().some((t) => t.includes(until.gone as string))) return false;
    const compares = until.equals !== undefined || until.not !== undefined || until.above !== undefined || until.below !== undefined;
    if (until.component !== undefined) {
      const root = this.#root();
      const found = root === null ? undefined : this.#findAll(until.component)[0];
      let ok: boolean;
      if (found === undefined) ok = false;
      else if (until.path === undefined) ok = true;
      else ok = passes(valueAt(componentState(found), until.path), until, compares);
      return until.absent === true ? !ok : ok;
    }
    if (until.path !== undefined) {
      const state = this.gameState();
      const names = Object.keys(state);
      const value =
        names.length === 1 && !until.path.startsWith(`${names[0]}.`)
          ? valueAt(state[names[0] as string], until.path)
          : valueAt(state, until.path);
      if (!passes(value, until, compares)) return false;
    }
    return true;
  }

  /** A number for the game's state now (the game states and every component's state): equal states hash equal. */
  hash(): number {
    const root = this.#root();
    return hashState(this.#stores(), root === null ? new Map() : captureHotState(root));
  }

  /** Keep the game as it is now under `name`, to `restore` later. */
  snapshot(name: string): void {
    const root = this.#root();
    const hot = new Map<string, Record<string, unknown>>();
    if (root !== null) for (const [path, saved] of captureHotState(root)) hot.set(path, copyState(saved));
    const stores = new Map<GameStore<unknown>, Record<string, unknown>>();
    for (const store of this.#stores().values()) stores.set(store, structuredClone(store.values()));
    this.#snapshots.set(name, {
      frame: this.#frame,
      hot,
      clock: this.#player.snapshotClock(),
      stores,
      history: [...this.#history],
      mouse: this.#mouse,
    });
  }

  /** The snapshots kept, by name, with the frame each was taken at. */
  snapshots(): { name: string; frame: number }[] {
    return [...this.#snapshots].map(([name, s]) => ({ name, frame: s.frame }));
  }

  /**
   * Go back to a snapshot: the game states and every component's state are put back and the tree is built again from them, as
   * `tse dev`'s rewind does. What a snapshot cannot hold (a built-in's own state, a timer, particles in flight) starts afresh;
   * `replay` plays the same input from the start instead, which is exact.
   */
  restore(name: string): void {
    const snapshot = this.#snapshots.get(name);
    if (snapshot === undefined)
      throw new Error(
        `No snapshot called '${name}'${this.#snapshots.size > 0 ? ` (there are: ${[...this.#snapshots.keys()].join(", ")})` : ""}.`
      );
    for (const [store, values] of snapshot.stores) store.restore(structuredClone(values));
    const hot = new Map<string, Record<string, unknown>>();
    for (const [path, saved] of snapshot.hot) hot.set(path, copyState(saved));
    if (!this.#player.restoreTo(this.#config, hot, snapshot.clock))
      throw this.#player.failure?.error ?? new Error("The game did not build again from the snapshot.");
    this.#frame = snapshot.frame;
    this.#history = [...snapshot.history];
    this.#mouse = snapshot.mouse;
  }

  /** Start the game again from nothing (snapshots are kept, but refer to the old run's states and stay restorable). */
  reset(): void {
    this.#player.close();
    const started = this.#start();
    this.#backend = started.backend;
    this.#player = started.player;
    this.#frame = 0;
    this.#history = [];
    this.#mouse = undefined;
  }

  /** Start again and play `frames` (default: this run's own history), the exact way back to the same moment. */
  replay(frames: readonly InputFrame[] = this.#history): number {
    const again = [...frames];
    this.reset();
    return this.play(again);
  }

  close(): void {
    this.#player.close();
  }
}

/** An object's name for a message: its class's, with its list key. */
function nameOf(object: GameObject): string {
  // A built-in is named by what holds it: the nearest component or named <Entity> (a component's name is its own).
  const nameOfOne = (o: GameObject): string => {
    const name = (o as { name?: unknown }).name;
    return typeof name === "string" && name !== "" ? name : "";
  };
  let named: GameObject = object;
  while (named.parent !== null && nameOfOne(named) === "") named = named.parent;
  const name = nameOfOne(named) || named.constructor.name;
  return named.hotKey !== undefined ? `${name}[key=${String(named.hotKey)}]` : name;
}

/** The middle of a pressable as it is drawn, in its layer's coordinates (its world position when its size is not known). */
function middleOf(object: GameObject & { contains(x: number, y: number): boolean }): { x: number; y: number } {
  const t = object.worldTransform();
  const fields = object as unknown as {
    width?: unknown;
    height?: unknown;
    originX?: unknown;
    originY?: unknown;
    box?: { size: ArrayLike<number> };
  };
  const width = fields.box !== undefined ? (fields.box.size[0] as number) : typeof fields.width === "number" ? fields.width : 0;
  const height = fields.box !== undefined ? (fields.box.size[1] as number) : typeof fields.height === "number" ? fields.height : 0;
  const ox = typeof fields.originX === "number" ? fields.originX : 0;
  const oy = typeof fields.originY === "number" ? fields.originY : 0;
  const middle = { x: t.x + (width / 2 - ox) * t.scaleX, y: t.y + (height / 2 - oy) * t.scaleY };
  return object.contains(middle.x, middle.y) ? middle : { x: t.x, y: t.y };
}

/** The value at a dotted path: `s.hp`, `enemies.length`, `towers.0.level`. */
export function valueAt(value: unknown, path: string): unknown {
  let at: unknown = value;
  for (const key of path.split(".")) {
    if (at === null || at === undefined) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

function passes(value: unknown, until: Until, compares: boolean): boolean {
  if (!compares) return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
  if (until.equals !== undefined && !sameData(value, until.equals)) return false;
  if (until.not !== undefined && sameData(value, until.not)) return false;
  if (until.above !== undefined && !(typeof value === "number" && value > until.above)) return false;
  if (until.below !== undefined && !(typeof value === "number" && value < until.below)) return false;
  return true;
}

function sameData(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
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
