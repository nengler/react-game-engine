import type { GameObject } from "./GameObject.ts";

/** What a leaf of the game state holds. Objects and arrays hold more of these. */
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
 * A component reads with a selector, which returns the value: `const hp = useGame((s) => s.player.hp)`, and takes the
 * actions it calls in handlers with `const { collect } = useGame.actions()`. Calling `useGame`
 * is compile-time only (the compiler turns the selector into that one path); `getState` and `setState` work
 * as in Zustand, for code that is not a compiled component.
 */
export interface GameState<S> {
  <T>(selector: (state: S) => T): T;
  readonly store: GameStore<S>;
  /**
   * The store's actions, and nothing else: `const { collect, hurt } = useGame.actions()` in a component (actions never change,
   * so this subscribes to nothing and never renders it), or `useGame.actions().collect()` in plain code.
   */
  actions(): ActionsOf<S>;
  getState(): S;
  setState(partial: Partial<S> | ((state: S) => Partial<S>)): void;
}

/** The functions of a state: its actions. */
export type ActionsOf<S> = { readonly [K in keyof S as S[K] extends (...args: never[]) => unknown ? K : never]: S[K] };

/** Create the game's state. Both the curried form (`createGameState<State>()(creator)`) and `createGameState(creator)` work. */
export function createGameState<S extends object>(): (creator: GameStateCreator<S>) => GameState<S>;
export function createGameState<S extends object>(creator: GameStateCreator<S>): GameState<S>;
export function createGameState<S extends object>(creator?: GameStateCreator<S>): GameState<S> | ((creator: GameStateCreator<S>) => GameState<S>) {
  const make = (creator: GameStateCreator<S>): GameState<S> => {
    const store = new GameStore<S>(creator);
    const use = (): never => {
      throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
    };
    const actions = (): ActionsOf<S> => {
      const state = store.getState() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === "function")) as ActionsOf<S>;
    };
    return Object.assign(use, { store, actions, getState: () => store.getState(), setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => store.setState(partial) }) as unknown as GameState<S>;
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

  /**
   * The latest value at a dotted path (`"player.hp"`, `"player"`, `"enemies"`): a leaf, or an object or array as the state
   * holds it. What a compiled component's snapshot reads. Treat an object you get as read-only: change it with `set`.
   */
  get<T = unknown>(path: string): T {
    let at: unknown = this.#state;
    for (const key of path.split(".")) {
      if (typeof at !== "object" || at === null || !(key in at)) throw new Error(`The game state has nothing at '${path}'.`);
      at = (at as Tree)[key];
    }
    if (typeof at === "function") throw new Error(`'${path}' is an action, not a value of the game state.`);
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

  /**
   * For hot reload: take the values of `older`, the same store from the build before this one, keeping this store's actions.
   * Only what still fits is taken: a key this state no longer has is dropped, a new key keeps its initial value, and a leaf
   * whose type changed (a number that became a string, an object that became an array) keeps the new one. `older` is
   * forgotten, so `resetGameState` no longer resets it. Call it before anything reads this store.
   */
  carryFrom(older: GameStore<unknown>): void {
    const merged = carry(this.#state, older.getState());
    stores.delete(older);
    this.#state = merged as S;
  }

  /** Mark dirty every reader of a changed leaf, and every reader of an object or array that holds one. */
  #notify(changed: readonly string[]): void {
    if (changed.length === 0 || this.#subscribers.size === 0) return;
    const told = new Set<string>();
    for (const path of changed) {
      for (let at = path; ; ) {
        if (told.has(at)) break;
        told.add(at);
        const subscribers = this.#subscribers.get(at);
        if (subscribers) for (const object of [...subscribers]) object.markDirty();
        const dot = at.lastIndexOf(".");
        if (dot < 0) break;
        at = at.slice(0, dot);
      }
    }
  }
}

type Tree = { [key: string]: unknown };

/**
 * `next` with the values of `old` where they still fit (see `GameStore.carryFrom`). Functions always come from `next`: they
 * are the new build's actions. Arrays are taken whole, since their length is data.
 */
function carry(next: unknown, old: unknown): unknown {
  if (typeof next === "function") return next;
  const nextObject = typeof next === "object" && next !== null;
  const oldObject = typeof old === "object" && old !== null;
  if (nextObject !== oldObject) return next;
  if (!nextObject) return typeof next === typeof old ? old : next;
  if (Array.isArray(next) !== Array.isArray(old)) return next;
  if (Array.isArray(old)) return old;
  const out: Tree = {};
  for (const [key, value] of Object.entries(next as Tree)) out[key] = key in (old as Tree) ? carry(value, (old as Tree)[key]) : value;
  return out;
}

/** Every store made in this process, so a new game can reset them all. */
const stores = new Set<{ reset(): void }>();

/** Put every game state back to its initial values. `createPlayer` calls it, so each game starts fresh; tests call it between cases. */
export function resetGameState(): void {
  for (const store of stores) store.reset();
}

/**
 * The dotted path of every leaf whose value differs between two states (functions are not leaves; a leaf in only one
 * counts). Arrays are walked like objects, by index, so an equal copy changes nothing. An object that is the same object
 * on both sides is not walked. One that turns into a leaf (or back) changes every leaf it had, so their readers hear of it.
 */
function changedPaths(before: Tree, after: Tree, prefix: string, out: string[]): string[] {
  if (before === after) return out;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (typeof a === "function" || typeof b === "function") continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const aObject = typeof a === "object" && a !== null;
    const bObject = typeof b === "object" && b !== null;
    if (aObject && bObject) changedPaths(a as Tree, b as Tree, path, out);
    else if (aObject || bObject) {
      out.push(path);
      changedPaths(aObject ? (a as Tree) : {}, bObject ? (b as Tree) : {}, path, out);
    } else if (a !== b) out.push(path);
  }
  return out;
}
