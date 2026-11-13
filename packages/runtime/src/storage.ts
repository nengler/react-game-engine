/**
 * Saved data: a save of the game and the player's settings, kept between runs. The runtime has no disk of its own: a player
 * installs a `StorageSink` with `setStorage` (the way it installs a sound sink), over the host's saved-data folder, and the stores
 * below write through it. With no sink installed (the tests, a game that is not running in a player) nothing is kept; tests
 * install `createMemoryStorage()`.
 *
 * What is stored is text: JSON as `{ "version": n, "data": … }`. Calls are synchronous (the entries are small and the host's calls
 * block), so they are made from game-state actions, as `sfx.play` is.
 */
import { captureGameTree, queueTreeRestore } from "./gameTree.ts";
import type { Controls } from "./input.ts";
import { setVolume } from "./Sound.ts";

export interface StorageSink {
  /** The entry's text, or null when there is none. */
  read(name: string): string | null;
  /** True when it was written. */
  write(name: string, text: string): boolean;
  remove(name: string): void;
  /** Full screen on or off; false when the window cannot. Optional: the `fullscreen` setting does nothing without it. */
  setFullscreen?(on: boolean): boolean;
}

let sink: StorageSink | null = null;
const settingsStores = new Set<{ reload(): void }>();

/** Install the sink saves and settings go through, or `null` to remove it. Settings already made read their file again and apply it. */
export function setStorage(next: StorageSink | null): void {
  sink = next;
  // Removing the sink (a player closing) leaves the settings as they are; installing one reads them from it.
  if (next !== null) for (const store of settingsStores) store.reload();
}

export function getStorage(): StorageSink | null {
  return sink;
}

/** A sink that keeps its entries in memory: for tests, and for a recording backend that starts from given entries. */
export function createMemoryStorage(initial: Readonly<Record<string, string>> = {}): StorageSink & { readonly entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    read: (name) => entries.get(name) ?? null,
    write: (name, text) => (entries.set(name, text), true),
    remove: (name) => void entries.delete(name),
  };
}

const defaultWarn = (message: string): void => {
  (globalThis as { console?: { warn?: (m: string) => void } }).console?.warn?.(message);
};

/** Parse an entry's `{ version, data }` (and a save's `tree`, when it kept one), or say why not. */
function parseEntry(text: string): { version: number; data: unknown; tree?: Record<string, Record<string, unknown>> } | null {
  try {
    const value = JSON.parse(text) as { version?: unknown; data?: unknown; tree?: unknown } | null;
    if (typeof value === "object" && value !== null && typeof value.version === "number" && Number.isInteger(value.version) && "data" in value) {
      const tree = typeof value.tree === "object" && value.tree !== null ? (value.tree as Record<string, Record<string, unknown>>) : undefined;
      return { version: value.version, data: value.data, ...(tree ? { tree } : {}) };
    }
  } catch {
    // Not JSON: handled below, as a file that does not parse.
  }
  return null;
}

export interface SaveOptions<Data> {
  /** The entry's name: 1 to 64 letters, digits, `_` and `-`. */
  readonly name: string;
  /** The version of what `pick` returns. Raise it when its shape changes and add a step to `migrate`. */
  readonly version: number;
  /** What to keep: a plain, JSON-safe object picked from the game's state. Optional with `tree`. */
  readonly pick?: () => Data;
  /** Put a loaded save into the game's state. */
  readonly apply?: (data: Data) => void;
  /**
   * Keep every component's own state too (`useState` values and refs, as hot reload keeps them), not only what `pick` takes
   * from the game state. On `load`, `apply` runs first, and once the tree it builds has settled, each component takes its saved
   * state back, found by its path (a list item by its key). Values that are not plain data (a function, a class instance such
   * as a body) are left out, said once. Default false.
   */
  readonly tree?: boolean;
  /** Steps from an older version: `migrate[1]` turns version 1's data into version 2's, and so on up to the current one. */
  readonly migrate?: Readonly<Record<number, (old: any) => any>>;
  /** Where a problem is reported (an unreadable or too-new save). Default `console.warn`. */
  readonly warn?: (message: string) => void;
}

/** One save of the game. `exists`, `write`, `load` and `remove` all work through the installed storage. */
export class Save<Data> {
  readonly #options: SaveOptions<Data>;
  #warned = false;
  #warnedTree = false;

  constructor(options: SaveOptions<Data>) {
    this.#options = options;
  }

  /** Is there a save. (One that cannot be read counts: `load` says why it cannot.) */
  exists(): boolean {
    return sink?.read(this.#options.name) !== null && sink !== null;
  }

  /** Keep what `pick` returns. True when it was written. */
  write(): boolean {
    if (sink === null) return false;
    const entry: { version: number; data: unknown; tree?: Record<string, Record<string, unknown>> } = { version: this.#options.version, data: this.#options.pick?.() ?? null };
    if (this.#options.tree) entry.tree = this.#plainTree();
    return sink.write(this.#options.name, JSON.stringify(entry));
  }

  /**
   * Read the save, bring it up to the current version and `apply` it. False, changing nothing, when there is none, when it does not
   * parse (said once), or when it is from a newer version of the game (said once, so the player is not left guessing).
   */
  load(): boolean {
    const warn = this.#options.warn ?? defaultWarn;
    const text = sink?.read(this.#options.name) ?? null;
    if (text === null) return false;
    const entry = parseEntry(text);
    if (entry === null) {
      if (!this.#warned) warn(`The save '${this.#options.name}' cannot be read (it is not a save of this game): it is ignored.`);
      this.#warned = true;
      return false;
    }
    if (entry.version > this.#options.version) {
      if (!this.#warned) warn(`The save '${this.#options.name}' is from a newer version of the game (save version ${entry.version}, this game reads up to ${this.#options.version}): it is ignored.`);
      this.#warned = true;
      return false;
    }
    let data = entry.data;
    try {
      for (let v = entry.version; v < this.#options.version; v++) {
        const step = this.#options.migrate?.[v];
        if (step === undefined) throw new Error(`there is no migration from version ${v}`);
        data = step(data);
      }
    } catch (error) {
      if (!this.#warned) warn(`The save '${this.#options.name}' cannot be brought up to version ${this.#options.version}: ${error instanceof Error ? error.message : String(error)}.`);
      this.#warned = true;
      return false;
    }
    this.#options.apply?.(data as Data);
    if (this.#options.tree && entry.tree !== undefined) queueTreeRestore(new Map(Object.entries(entry.tree)));
    return true;
  }

  /** The game's tree as JSON-safe data: each component's state by path, without the values that are not plain data. */
  #plainTree(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    const skipped: string[] = [];
    for (const [path, fields] of captureGameTree()) {
      const kept: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(fields)) {
        if (isPlainData(value)) kept[field] = value;
        else skipped.push(`${path} ${field}`);
      }
      out[path] = kept;
    }
    if (skipped.length > 0 && !this.#warnedTree) {
      (this.#options.warn ?? defaultWarn)(`The save '${this.#options.name}' leaves out state that is not plain data (it cannot be written as JSON): ${skipped.join(", ")}.`);
      this.#warnedTree = true;
    }
    return out;
  }

  remove(): void {
    sink?.remove(this.#options.name);
  }
}

/** A number that JSON keeps, a string, a boolean, null, or an array or plain object of those. */
function isPlainData(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainData);
  if (typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Object.values(value as object).every(isPlainData);
}

/** Make a save. Keep the result in a module: `export const save = createSave({ … })`. */
export function createSave<Data>(options: SaveOptions<Data>): Save<Data> {
  return new Save(options);
}

/** The settings the engine itself applies; a game may keep others beside them. */
export interface EngineSettings {
  /** Music volume, 0 to 1. */
  music?: number;
  /** Sound effects volume, 0 to 1. */
  effects?: number;
  fullscreen?: boolean;
  /** The controls' bindings (`Controls.toJSON()`), or null for the game's own. */
  bindings?: Record<string, string[]> | null;
}

export interface SettingsOptions<S> {
  readonly name: string;
  /** Every setting and its default: what is used for what the file does not say. */
  readonly defaults: S;
  /** The game's `controls`, so a `bindings` setting is applied to them. */
  readonly controls?: Controls;
  readonly warn?: (message: string) => void;
}

/**
 * The player's settings, kept apart from the save. `music` and `effects` set the volume groups, `fullscreen` the window, `bindings` the
 * controls; they are applied when the player starts (before the first frame) and each time `set` changes them.
 */
export class Settings<S extends EngineSettings> {
  readonly #options: SettingsOptions<S>;
  #values: S;
  #warned = false;
  readonly #listeners = new Set<(values: Readonly<S>) => void>();

  constructor(options: SettingsOptions<S>) {
    this.#options = options;
    this.#values = { ...options.defaults };
    settingsStores.add(this);
  }

  get(): Readonly<S> {
    return this.#values;
  }

  /**
   * Be told each time the settings change (`set`, `reset`, or a reload when storage is installed), after they are applied, so the
   * controls already have their new keys. The way to show them: copy them into the game state, where components select them
   * (`settings.subscribe((values) => useGame.setState({ settings: values }))`). Returns the function that stops it.
   */
  subscribe(listener: (values: Readonly<S>) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** Stop reloading when storage is installed: for a store that is made again (a test, a hot reload) and so would be read twice. */
  dispose(): void {
    settingsStores.delete(this);
    this.#listeners.clear();
  }

  /** Change some settings, apply them, and keep them. True when they were written. */
  set(patch: Partial<S>): boolean {
    this.#values = { ...this.#values, ...patch };
    this.#apply();
    return sink?.write(this.#options.name, JSON.stringify({ version: 1, data: this.#values })) ?? false;
  }

  /** Back to the defaults (and the controls to the game's keys), kept. */
  reset(): boolean {
    this.#options.controls?.reset();
    this.#values = { ...this.#options.defaults };
    this.#apply();
    return sink?.write(this.#options.name, JSON.stringify({ version: 1, data: this.#values })) ?? false;
  }

  /** Read the file again (what `setStorage` does) and apply it. What it does not say stays at the defaults; a file that does not parse is said once and ignored. */
  reload(): void {
    this.#values = { ...this.#options.defaults };
    const text = sink?.read(this.#options.name) ?? null;
    if (text !== null) {
      const entry = parseEntry(text);
      if (entry !== null && typeof entry.data === "object" && entry.data !== null) {
        for (const key of Object.keys(this.#options.defaults)) {
          const value = (entry.data as Record<string, unknown>)[key];
          if (value !== undefined && typeof value === typeof (this.#options.defaults as Record<string, unknown>)[key]) (this.#values as Record<string, unknown>)[key] = value;
          else if (value === null && (this.#options.defaults as Record<string, unknown>)[key] === null) (this.#values as Record<string, unknown>)[key] = null;
        }
        const bindings = (entry.data as Record<string, unknown>)["bindings"];
        if (bindings !== null && typeof bindings === "object") (this.#values as EngineSettings).bindings = bindings as Record<string, string[]>;
      } else if (!this.#warned) {
        (this.#options.warn ?? defaultWarn)(`The settings file '${this.#options.name}' cannot be read: the defaults are used.`);
        this.#warned = true;
      }
    }
    this.#apply();
  }

  #apply(): void {
    const v = this.#values;
    if (typeof v.music === "number") setVolume("music", v.music);
    if (typeof v.effects === "number") setVolume("effects", v.effects);
    if (v.bindings !== undefined && v.bindings !== null) this.#options.controls?.load(v.bindings);
    if (typeof v.fullscreen === "boolean") sink?.setFullscreen?.(v.fullscreen);
    for (const listener of [...this.#listeners]) listener(v);
  }
}

/**
 * A setting's type, from its default: `fullscreen: false` is a setting that may be `true` too. TypeScript keeps a boolean default's
 * literal type when the settings type is inferred, so without this `set({ fullscreen: true })` would not type-check.
 */
export type SettingsOf<S> = { [K in keyof S]: S[K] extends boolean ? boolean : S[K] };

/** Make the settings. Keep the result in a module: `export const settings = createSettings({ name: "settings", defaults: { music: 0.6, … } })`. */
export function createSettings<S extends EngineSettings>(options: SettingsOptions<S>): Settings<SettingsOf<S> & EngineSettings> {
  return new Settings(options as unknown as SettingsOptions<SettingsOf<S> & EngineSettings>);
}
