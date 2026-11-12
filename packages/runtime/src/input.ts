/**
 * Polled input for one frame. The mock builds it from test-supplied data; a real backend would fill it from devices. Each
 * question takes a key name (`"Z"`, `"PadA"`) or the name of an action of the game's controls (`"jump"`, see `createControls`).
 */
export interface InputState {
  /** True only on the frame the key went down (for an action: one of its keys did). */
  pressed(key: string): boolean;
  /** True while the key is held (for an action: any of its keys is). */
  down(key: string): boolean;
  /** True only on the frame the key went up (for an action: one of its keys did, and none is still held). */
  released(key: string): boolean;
  readonly pointerX: number;
  readonly pointerY: number;
  /**
   * The first key or button that went down this step, by name (for "press a key for Jump"), or undefined when none did. The mouse
   * buttons and the gamepad's are keys too.
   */
  lastPressed(): KeyName | undefined;
  /** Whether `name` is an action of the game's controls (asking about one that is not would be about a key of that name). */
  isAction?(name: string): boolean;
}

/** Is `name` one of the keys the player knows (`KEY_NAMES`). */
function isKeyName(name: string): name is KeyName {
  return (KEY_NAMES as readonly string[]).includes(name);
}

/**
 * Every key name the player knows, in the order of its keys buffer (`RGE_KEYS` in `native/include/rge.h`, append only; the
 * player's `KEYS` is this list, and a test keeps it equal to the header). Mouse buttons and the first gamepad are keys too.
 */
export const KEY_NAMES = [
  "Space", "Enter", "Escape", "Tab", "Backspace", "Shift", "Control", "Alt",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "MouseLeft", "MouseRight", "MouseMiddle",
  // The first gamepad: its buttons, and the d-pad or left stick as four directions (down past the dead zone).
  "PadA", "PadB", "PadX", "PadY", "PadLB", "PadRB", "PadBack", "PadStart", "PadLeft", "PadRight", "PadUp", "PadDown",
] as const;

/** A key name: what a `createControls` binding is made of, so a misspelt key (`"Spcae"`) is a type error, not a silent key. */
export type KeyName = (typeof KEY_NAMES)[number];

export interface InputSnapshot {
  readonly pressed?: Iterable<string>;
  readonly down?: Iterable<string>;
  readonly released?: Iterable<string>;
  readonly pointer?: { readonly x: number; readonly y: number };
}

/**
 * The game's actions, by name, each the keys and buttons that do it: `createControls({ jump: ["Z", "Space", "PadA"] })`. Kept in a
 * module and handed to `<Game controls={controls}>`, so every `input.pressed("jump")` in the game means any of those keys, the
 * rules read actions instead of keys, and rebinding is one place. An input script's names (`right*30, jump`) can be the same
 * table (`controls.bindings`).
 */
export class Controls<Name extends string = string> {
  /** The keys of each action now. Read every time an action is asked about, so `bind` and `load` apply at once; do not keep a copy. */
  bindings: Readonly<Record<Name, readonly KeyName[]>>;
  readonly #defaults: Readonly<Record<Name, readonly KeyName[]>>;
  readonly #listeners = new Set<(bindings: Readonly<Record<Name, readonly KeyName[]>>) => void>();

  constructor(bindings: Readonly<Record<Name, readonly KeyName[]>>) {
    for (const [name, keys] of Object.entries<readonly string[]>(bindings)) {
      if (keys.length === 0) throw new Error(`The action '${name}' has no keys.`);
    }
    this.bindings = bindings;
    this.#defaults = bindings;
  }

  /** Give an action these keys (at least one; each a `KeyName`). Returns false, changing nothing, for an unknown action or a bad key. */
  bind(action: string, keys: readonly string[]): boolean {
    if (!Object.hasOwn(this.bindings, action) || keys.length === 0 || !keys.every(isKeyName)) return false;
    this.bindings = { ...this.bindings, [action]: [...keys] as KeyName[] };
    this.#changed();
    return true;
  }

  /** Back to the keys the game was written with. */
  reset(): void {
    if (this.bindings === this.#defaults) return;
    this.bindings = this.#defaults;
    this.#changed();
  }

  /**
   * Be told each time the keys change (`bind`, `reset`, `load`), with the new bindings: a settings screen copies them into the game
   * state so the rows that show them re-render. Returns the function that stops it.
   */
  subscribe(listener: (bindings: Readonly<Record<Name, readonly KeyName[]>>) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener(this.bindings);
  }

  /** The bindings as plain data, for a settings file. */
  toJSON(): Record<string, string[]> {
    return Object.fromEntries(Object.entries<readonly string[]>(this.bindings).map(([action, keys]) => [action, [...keys]]));
  }

  /**
   * Take bindings from plain data (a settings file): each known action with a list of real key names is rebound; anything else (an
   * action the game no longer has, a key that is not a `KeyName`, a list that is empty) is ignored, so an old file cannot break the
   * controls. Returns how many actions were rebound.
   */
  load(data: unknown): number {
    if (typeof data !== "object" || data === null) return 0;
    let count = 0;
    for (const [action, keys] of Object.entries(data as Record<string, unknown>)) {
      if (Array.isArray(keys) && keys.every((k) => typeof k === "string") && this.bind(action, keys as string[])) count++;
    }
    return count;
  }

  /**
   * What to call an action's first key on screen, so a label cannot drift from the binding: `controls.label("wave")` is `"Space"`.
   * `Escape` is `"Esc"` and the arrows are `"Left"`, `"Right"`, `"Up"` and `"Down"`; other keys are their names. A name that is not
   * an action is returned as it is.
   */
  label(name: string): string {
    const key = this.keysOf(name)?.[0];
    if (key === undefined) return name;
    if (key === "Escape") return "Esc";
    return key.startsWith("Arrow") ? key.slice(5) : key;
  }

  /** The keys of an action, or undefined when `name` is not one (a key name, say). */
  keysOf(name: string): readonly KeyName[] | undefined {
    return Object.hasOwn(this.bindings, name) ? this.bindings[name as Name] : undefined;
  }
}

/**
 * Make the game's controls. Keep the result in a module (`export const controls = createControls({ … })`). Each key must be a
 * `KeyName`, so the editor and the type-check catch a misspelt one.
 */
export function createControls<const Bindings extends Record<string, readonly KeyName[]>>(bindings: Bindings): Controls<keyof Bindings & string> {
  return new Controls<keyof Bindings & string>(bindings);
}

/**
 * Answer the three questions for a name that may be an action: `has(key, which)` answers for one key. Shared by the test input
 * below and the player's.
 */
export function actionAware(controls: Controls | undefined, has: (key: string, which: "pressed" | "down" | "released") => boolean): Pick<InputState, "pressed" | "down" | "released"> {
  const ask = (name: string, which: "pressed" | "down" | "released"): boolean => {
    const keys = controls?.keysOf(name);
    if (keys === undefined) return has(name, which);
    if (which === "released") return keys.some((k) => has(k, "released")) && !keys.some((k) => has(k, "down"));
    return keys.some((k) => has(k, which));
  };
  return { pressed: (name) => ask(name, "pressed"), down: (name) => ask(name, "down"), released: (name) => ask(name, "released") };
}

/** Input from test data: the keys pressed, held and released, and the game's `controls` so actions can be asked about too. */
export function createInputState(snapshot: InputSnapshot = {}, controls?: Controls): InputState {
  const sets = { pressed: new Set(snapshot.pressed), down: new Set(snapshot.down), released: new Set(snapshot.released) };
  const { pressed, down, released } = actionAware(controls, (key, which) => sets[which].has(key));
  return {
    pressed,
    down,
    released,
    pointerX: snapshot.pointer?.x ?? 0,
    pointerY: snapshot.pointer?.y ?? 0,
    isAction: (name) => controls?.keysOf(name) !== undefined,
    lastPressed: () => [...(snapshot.pressed ?? [])].find(isKeyName),
  };
}

/** Input with nothing pressed, used when a tick is given none. */
export const NO_INPUT: InputState = createInputState();
