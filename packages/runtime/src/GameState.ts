import type { GameObject } from "./GameObject.ts";

/** What a leaf of the game state holds. Arrays are not supported yet. */
export type GameStateValue = number | string | boolean;

/** The state tree: objects nested as deep as you like, with primitives at the leaves. */
export type GameStateTree = { [key: string]: GameStateValue | GameStateTree };

/** A setter, as `useState` returns: a value, or an updater that gets the latest value. */
export type GameStateSetter<T> = (value: T | ((previous: T) => T)) => void;

/**
 * The game's state: one nested object, created once in `GameState.ts`:
 *
 *     export const useGame = createGameState({ coins: 0, player: { hp: 10, name: "Ada" } });
 *
 * A component reads and writes one leaf with a selector, as it would `useState`:
 * `const [hp, setHp] = useGame((s) => s.player.hp)`, then `setHp(5)` or `setHp((h) => h - 1)`. Calling `useGame` is
 * compile-time only (the compiler turns the selector into that one path); at run time it is the store, `useGame.store`.
 */
export interface GameState<S> {
  <T extends GameStateValue>(selector: (state: S) => T): [T, GameStateSetter<T>];
  readonly store: GameStore;
}

/** Create the game's state. See `GameState`. */
export function createGameState<S extends GameStateTree>(initial: S): GameState<S> {
  const store = new GameStore(initial);
  const use = (): never => {
    throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
  };
  return Object.assign(use, { store }) as unknown as GameState<S>;
}

/**
 * The values behind a `createGameState`, by dotted path (`"player.hp"`). A write takes effect in the store at once (a
 * component built later in the frame starts from it, and updaters chain on the latest value) and marks every mounted
 * object that reads that path dirty; they copy the new value into their own field when they next render, so within a
 * frame every handler sees the same snapshot, as with `useState`. A write that changes nothing renders nothing.
 */
export class GameStore {
  readonly #initial: GameStateTree;
  #state: GameStateTree;
  readonly #subscribers = new Map<string, Set<GameObject>>();

  constructor(initial: GameStateTree) {
    this.#initial = clone(initial);
    this.#state = clone(initial);
    stores.add(this);
  }

  /** The latest value at a dotted path. */
  get<T extends GameStateValue>(path: string): T {
    const [parent, key] = this.#locate(path);
    return parent[key] as T;
  }

  /** Set the leaf at a path to a value, or to what an updater makes of the latest one. Does nothing when it is unchanged. */
  set<T extends GameStateValue>(path: string, value: T | ((previous: T) => T)): void {
    const [parent, key] = this.#locate(path);
    const previous = parent[key] as T;
    const next = typeof value === "function" ? value(previous) : value;
    if (next === previous) return;
    parent[key] = next;
    this.#notify([path]);
  }

  /** Start tracking `object` as a reader of each path. Called when it joins a world. */
  subscribe(object: GameObject, paths: readonly string[]): void {
    for (const path of paths) {
      let set = this.#subscribers.get(path);
      if (!set) this.#subscribers.set(path, (set = new Set()));
      set.add(object);
    }
  }

  unsubscribe(object: GameObject, paths: readonly string[]): void {
    for (const path of paths) this.#subscribers.get(path)?.delete(object);
  }

  /** Back to the initial state, telling every reader. The player does this at start. */
  reset(): void {
    const changed = changedPaths(this.#state, this.#initial, "", []);
    this.#state = clone(this.#initial);
    this.#notify(changed);
  }

  /** The object holding the leaf at `path`, and the leaf's key. */
  #locate(path: string): [{ [key: string]: GameStateValue | GameStateTree }, string] {
    const keys = path.split(".");
    const last = keys.pop() as string;
    let at: GameStateTree = this.#state;
    for (const key of keys) {
      const next: GameStateValue | GameStateTree | undefined = at[key];
      if (next === undefined || typeof next !== "object") throw new Error(`The game state has nothing at '${path}'.`);
      at = next;
    }
    const leaf = at[last];
    if (leaf === undefined || typeof leaf === "object") throw new Error(`The game state has no value at '${path}'.`);
    return [at, last];
  }

  #notify(changed: readonly string[]): void {
    for (const path of changed) {
      const subscribers = this.#subscribers.get(path);
      if (subscribers) for (const object of [...subscribers]) object.markDirty();
    }
  }
}

/** Every store made in this process, so a new game can reset them all. */
const stores = new Set<GameStore>();

/** Put every game state back to its initial values. `createPlayer` calls it, so each game starts fresh; tests call it between cases. */
export function resetGameState(): void {
  for (const store of stores) store.reset();
}

function clone(tree: GameStateTree): GameStateTree {
  const out: GameStateTree = {};
  for (const key of Object.keys(tree)) {
    const value = tree[key] as GameStateValue | GameStateTree;
    out[key] = typeof value === "object" ? clone(value) : value;
  }
  return out;
}

/** The dotted path of every leaf whose value differs between two trees (a leaf in only one counts as different). */
function changedPaths(before: GameStateTree, after: GameStateTree, prefix: string, out: string[]): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof a === "object" && typeof b === "object") changedPaths(a, b, path, out);
    else if (a !== b) out.push(path);
  }
  return out;
}
