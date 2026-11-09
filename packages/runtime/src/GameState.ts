import type { GameObject } from "./GameObject.ts";

/** What a leaf of the game state holds. Arrays are not supported yet. */
export type GameStateValue = number | string | boolean;

/**
 * `set`, as in Zustand: a partial state, or a function from the state to one. It is **shallow-merged**, so a nested
 * object is replaced as a whole: `set((s) => ({ player: { ...s.player, hp: s.player.hp - 1 } }))`.
 */
export type SetGameState<S> = (partial: Partial<S> | ((state: S) => Partial<S>)) => void;

export type GetGameState<S> = () => S;

/** What you write: given `set` and `get`, return the state with its actions in it. */
export type GameStateCreator<S> = (set: SetGameState<S>, get: GetGameState<S>) => S;

/**
 * The game's state, shaped like a Zustand store. Create it once, in `GameState.ts`:
 *
 *     export const useGame = createGameState<State>()((set) => ({
 *       coins: 0,
 *       player: { hp: 10 },
 *       collect: () => set((s) => ({ coins: s.coins + 1 })),
 *     }));
 *
 * A component reads with a selector, which returns the value: `const hp = useGame((s) => s.player.hp)`, and an action
 * is selected the same way and called in a handler: `const collect = useGame((s) => s.collect)`. Calling `useGame`
 * is compile-time only (the compiler turns the selector into that one path); `getState` and `setState` work
 * as in Zustand, for code that is not a compiled component.
 */
export interface GameState<S> {
  <T>(selector: (state: S) => T): T;
  readonly store: GameStore<S>;
  getState(): S;
  setState(partial: Partial<S> | ((state: S) => Partial<S>)): void;
}

/** Create the game's state. Both the curried form (`createGameState<State>()(creator)`) and `createGameState(creator)` work. */
export function createGameState<S extends object>(): (creator: GameStateCreator<S>) => GameState<S>;
export function createGameState<S extends object>(creator: GameStateCreator<S>): GameState<S>;
export function createGameState<S extends object>(creator?: GameStateCreator<S>): GameState<S> | ((creator: GameStateCreator<S>) => GameState<S>) {
  const make = (creator: GameStateCreator<S>): GameState<S> => {
    const store = new GameStore<S>(creator);
    const use = (): never => {
      throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
    };
    return Object.assign(use, { store, getState: () => store.getState(), setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => store.setState(partial) }) as unknown as GameState<S>;
  };
  return creator ? make(creator) : make;
}

/**
 * The state behind a `createGameState`. `setState` shallow-merges, then compares the old and new state leaf by leaf and
 * marks dirty every mounted object that reads a leaf that changed (and only those). Those objects copy the new value
 * into their own field when they next render, so within a frame every handler sees the same snapshot, as with
 * `useState`. A `set` that changes no leaf renders nothing. A function in the state (an action) is not a leaf.
 */
export class GameStore<S = object> {
  readonly #initial: S;
  #state: S;
  readonly #subscribers = new Map<string, Set<GameObject>>();

  constructor(creator: GameStateCreator<S>) {
    const set: SetGameState<S> = (partial) => this.setState(partial);
    this.#initial = creator(set, () => this.#state);
    this.#state = this.#initial;
    stores.add(this);
  }

  /** The whole state, with its actions. */
  getState(): S {
    return this.#state;
  }

  /** Zustand's `setState`: a partial state or an updater, shallow-merged. */
  setState(partial: Partial<S> | ((state: S) => Partial<S>)): void {
    const next = typeof partial === "function" ? partial(this.#state) : partial;
    if (next === null || next === undefined) return;
    const before = this.#state;
    this.#state = { ...before, ...next };
    this.#notify(changedPaths(before as Tree, this.#state as Tree, "", []));
  }

  /** The latest value of one leaf, by dotted path (`"player.hp"`). What a compiled component's snapshot reads. */
  get<T extends GameStateValue>(path: string): T {
    let at: unknown = this.#state;
    for (const key of path.split(".")) {
      if (typeof at !== "object" || at === null) throw new Error(`The game state has nothing at '${path}'.`);
      at = (at as Tree)[key];
    }
    if (at === undefined || typeof at === "object" || typeof at === "function") throw new Error(`The game state has no value at '${path}'.`);
    return at as T;
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

  /** Back to the state the creator returned, telling every reader. The player does this at start. */
  reset(): void {
    const before = this.#state;
    this.#state = this.#initial;
    this.#notify(changedPaths(before as Tree, this.#state as Tree, "", []));
  }

  #notify(changed: readonly string[]): void {
    for (const path of changed) {
      const subscribers = this.#subscribers.get(path);
      if (subscribers) for (const object of [...subscribers]) object.markDirty();
    }
  }
}

type Tree = { [key: string]: unknown };

/** Every store made in this process, so a new game can reset them all. */
const stores = new Set<{ reset(): void }>();

/** Put every game state back to its initial values. `createPlayer` calls it, so each game starts fresh; tests call it between cases. */
export function resetGameState(): void {
  for (const store of stores) store.reset();
}

/** The dotted path of every leaf whose value differs between two states (functions are not leaves; a leaf in only one counts). */
function changedPaths(before: Tree, after: Tree, prefix: string, out: string[]): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (typeof a === "function" || typeof b === "function") continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) changedPaths(a as Tree, b as Tree, path, out);
    else if (a !== b) out.push(path);
  }
  return out;
}
