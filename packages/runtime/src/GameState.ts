import type { GameObject } from "./GameObject.ts";

/** What a game-state key holds. Arrays and records are not supported yet. */
export type GameStateValue = number | string | boolean;

/**
 * The game's global state: one value per key, shared by every component that calls `useGameState(key)`.
 *
 * A key's value is created from the initial value the compiler passes at the call site (the schema's, so every call
 * site agrees) the first time anything reads or writes it. A write takes effect in the store at once, so a component
 * built later in the same frame starts from it, and marks every mounted component that reads the key dirty. Those
 * components copy the new value into their own field when they next render (`commitState`), so within a frame
 * every handler sees the same snapshot, as with `useState`. Updaters chain on the latest value.
 */
export class GameStateStore {
  readonly #values = new Map<string, GameStateValue>();
  readonly #subscribers = new Map<string, Set<GameObject>>();

  /** The latest value of `key`, created from `initial` if nothing has touched it yet. */
  read<T extends GameStateValue>(key: string, initial: T): T {
    if (!this.#values.has(key)) this.#values.set(key, initial);
    return this.#values.get(key) as T;
  }

  /** Set `key` to a value, or to what an updater makes of the latest one. Does nothing when the value is unchanged. */
  set<T extends GameStateValue>(key: string, initial: T, value: T | ((previous: T) => T)): void {
    const previous = this.read(key, initial);
    const next = typeof value === "function" ? value(previous) : value;
    if (next === previous) return;
    this.#values.set(key, next);
    const subscribers = this.#subscribers.get(key);
    if (subscribers) for (const object of [...subscribers]) object.markDirty();
  }

  /** Start telling `object` when any of `keys` changes. Called when it joins a world. */
  subscribe(object: GameObject, keys: readonly string[]): void {
    for (const key of keys) {
      let set = this.#subscribers.get(key);
      if (!set) this.#subscribers.set(key, (set = new Set()));
      set.add(object);
    }
  }

  unsubscribe(object: GameObject, keys: readonly string[]): void {
    for (const key of keys) this.#subscribers.get(key)?.delete(object);
  }
}

let current = new GameStateStore();

/** The store components read and write. */
export function getGameStateStore(): GameStateStore {
  return current;
}

/** Install a store; the player does it at start, so each game begins from its initial values. */
export function setGameStateStore(store: GameStateStore): void {
  current = store;
}

/** Start again from the initial values: a new, empty store. Components already mounted keep reading the old one until they are rebuilt. */
export function resetGameState(): GameStateStore {
  return (current = new GameStateStore());
}

/** What generated code calls to read a key (see `GameStateStore.read`). */
export function readGameState<T extends GameStateValue>(key: string, initial: T): T {
  return current.read(key, initial);
}

/** What a generated setter calls (see `GameStateStore.set`). */
export function setGameState<T extends GameStateValue>(key: string, initial: T, value: T | ((previous: T) => T)): void {
  current.set(key, initial, value);
}
