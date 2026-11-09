import type { GameObject } from "./GameObject.ts";

/** What a leaf of the game state holds. Arrays are not supported yet. */
export type GameStateValue = number | string | boolean;

/** The state tree: objects nested as deep as you like, with primitives at the leaves. */
export type GameStateTree = { [key: string]: GameStateValue | GameStateTree };

/** An action: written as if it mutates the state it is given; the store runs it on a copy and keeps the result. */
export type GameStateAction<S> = (state: S, ...args: never[]) => void;

/** An action as a component calls it: without the leading state parameter. */
export type BoundAction<A> = A extends (state: never, ...rest: infer R) => void ? (...rest: R) => void : never;

/** What `useGame(s => …)` selects from: the state itself, and every action bound. */
export type GameStateView<S, A> = S & { readonly [K in keyof A]: BoundAction<A[K]> };

/**
 * The game's state: one nested object, and the actions that change it. Create it once, in `GameState.ts`:
 *
 *     export const useGame = createGameState({
 *       state: { coins: 0, player: { hp: 10 } },
 *       actions: { hurt(s) { s.player.hp -= 1; }, collect(s, n: number) { s.coins += n; } },
 *     });
 *
 * and use it in a component with a selector, as with Zustand: `const hp = useGame((s) => s.player.hp)` reads one
 * leaf, and `const hurt = useGame((s) => s.hurt)` binds an action to call in a handler. Calling `useGame` is
 * compile-time only (the compiler turns the selector into a read of that one path); at run time it is the store,
 * `useGame.store`.
 */
export interface GameState<S, A> {
  <T>(selector: (state: GameStateView<S, A>) => T): T;
  readonly store: GameStore;
}

/** Create the game's state. See `GameState`. */
export function createGameState<S extends GameStateTree, A extends { [name: string]: GameStateAction<S> }>(config: { readonly state: S; readonly actions: A }): GameState<S, A> {
  const store = new GameStore(config.state, config.actions as unknown as { [name: string]: (state: never, ...args: never[]) => void });
  const use = (): never => {
    throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
  };
  return Object.assign(use, { store }) as unknown as GameState<S, A>;
}

/**
 * The values and the actions behind a `createGameState`. A value is read by its dotted path (`"player.hp"`). An action
 * runs on a copy of the state, so it can be written with plain assignments, and if it throws nothing changes. Every
 * leaf it changed (found by comparing the copy with the state) marks each mounted object that reads that path dirty;
 * those copy the new value into their own field when they next render, so within a frame every handler sees the same
 * snapshot, as with `useState`. An action that changes nothing renders nothing.
 */
export class GameStore {
  readonly #initial: GameStateTree;
  readonly #actions: { readonly [name: string]: (state: never, ...args: never[]) => void };
  #state: GameStateTree;
  readonly #subscribers = new Map<string, Set<GameObject>>();

  constructor(initial: GameStateTree, actions: { readonly [name: string]: (state: never, ...args: never[]) => void }) {
    this.#initial = clone(initial);
    this.#state = clone(initial);
    this.#actions = actions;
    stores.add(this);
  }

  /** The latest value at a dotted path. */
  get<T extends GameStateValue>(path: string): T {
    let at: GameStateValue | GameStateTree | undefined = this.#state;
    for (const key of path.split(".")) {
      if (typeof at !== "object") throw new Error(`The game state has nothing at '${path}'.`);
      at = at[key];
    }
    if (at === undefined || typeof at === "object") throw new Error(`The game state has no value at '${path}'.`);
    return at as T;
  }

  /** Run an action by name with its arguments (after the state, which the store supplies). */
  run(name: string, args: readonly unknown[] = []): void {
    const action = this.#actions[name];
    if (typeof action !== "function") throw new Error(`The game state has no action '${name}'.`);
    const draft = clone(this.#state);
    (action as (state: GameStateTree, ...rest: unknown[]) => void)(draft, ...args);
    const changed = changedPaths(this.#state, draft, "", []);
    this.#state = draft;
    this.#notify(changed);
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
