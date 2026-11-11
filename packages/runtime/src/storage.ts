/**
 * Saved data: a save of the game and the player's settings, kept between runs. The runtime has no disk of its own: a player
 * installs a `StorageSink` with `setStorage` (the way it installs a sound sink), over the host's saved-data folder, and the stores
 * below write through it. With no sink installed (the tests, a game that is not running in a player) nothing is kept; tests
 * install `createMemoryStorage()`.
 *
 * What is stored is text: JSON as `{ "version": n, "data": … }`. Calls are synchronous (the entries are small and the host's calls
 * block), so they are made from game-state actions, as `sfx.play` is.
 */
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

/** Parse an entry's `{ version, data }`, or say why not. */
function parseEntry(text: string): { version: number; data: unknown } | null {
  try {
    const value = JSON.parse(text) as { version?: unknown; data?: unknown } | null;
    if (typeof value === "object" && value !== null && typeof value.version === "number" && Number.isInteger(value.version) && "data" in value) {
      return { version: value.version, data: value.data };
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
  /** What to keep: a plain, JSON-safe object picked from the game's state. */
  readonly pick: () => Data;
  /** Put a loaded save into the game's state. */
  readonly apply: (data: Data) => void;
  /** Steps from an older version: `migrate[1]` turns version 1's data into version 2's, and so on up to the current one. */
  readonly migrate?: Readonly<Record<number, (old: any) => any>>;
  /** Where a problem is reported (an unreadable or too-new save). Default `console.warn`. */
  readonly warn?: (message: string) => void;
}

/** One save of the game. `exists`, `write`, `load` and `remove` all work through the installed storage. */
export class Save<Data> {
  readonly #options: SaveOptions<Data>;
  #warned = false;

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
    const text = JSON.stringify({ version: this.#options.version, data: this.#options.pick() });
    return sink.write(this.#options.name, text);
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
    this.#options.apply(data as Data);
    return true;
  }

  remove(): void {
    sink?.remove(this.#options.name);
  }
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

  constructor(options: SettingsOptions<S>) {
    this.#options = options;
    this.#values = { ...options.defaults };
    settingsStores.add(this);
  }

  get(): Readonly<S> {
    return this.#values;
  }

  /** Stop reloading when storage is installed: for a store that is made again (a test, a hot reload) and so would be read twice. */
  dispose(): void {
    settingsStores.delete(this);
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
  }
}

/** Make the settings. Keep the result in a module: `export const settings = createSettings({ name: "settings", defaults: { music: 0.6, … } })`. */
export function createSettings<S extends EngineSettings>(options: SettingsOptions<S>): Settings<S> {
  return new Settings(options);
}
