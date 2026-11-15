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

/**
 * An action of `createGameState(data, actions)`: it takes the state, writable, then its own arguments, and changes the state
 * in place (`select(s, pad: number) { s.cursor = pad; }`). What it returns is returned to the caller.
 */
export type GameAction<D> = (state: D, ...args: any[]) => unknown;

/** The actions as components call them: the state argument is supplied (`select(3)`). */
export type BoundActions<A> = { readonly [K in keyof A]: A[K] extends (state: never, ...args: infer P) => infer R ? (...args: P) => R : never };

/**
 * Create the game's state.
 *
 * - **`createGameState(data, actions)`**, the form to write: the data is a plain object, and each action takes the state as its
 *   first argument and writes it directly (`select(s, pad: number) { s.cursor = pad; s.open = true; }`). A component calls it
 *   without the state (`const { select } = useGame.actions(); select(3)`). Only actions change the state.
 * - **`createGameState<State>()(creator)` and `createGameState(creator)`**, the Zustand form with `set` and `get`, kept while games
 *   move to the form above.
 */
export function createGameState<D extends object, A extends Record<string, GameAction<D>>>(data: D, actions: A): GameState<D & BoundActions<A>>;
export function createGameState<S extends object>(): (creator: GameStateCreator<S>) => GameState<S>;
export function createGameState<S extends object>(creator: GameStateCreator<S>): GameState<S>;
export function createGameState<S extends object>(
  creator?: GameStateCreator<S> | object,
  actions?: Record<string, GameAction<object>>,
): GameState<S> | ((creator: GameStateCreator<S>) => GameState<S>) {
  if (actions !== undefined) return wrap(GameStore.fromActions(creator as object, actions)) as unknown as GameState<S>;
  const make = (creator: GameStateCreator<S>): GameState<S> => wrap(new GameStore<S>(creator));
  return creator ? make(creator as GameStateCreator<S>) : make;
}

function wrap<S>(store: GameStore<S>): GameState<S> {
  const use = (): never => {
    throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
  };
  const actions = (): ActionsOf<S> => {
    const state = store.getState() as Record<string, unknown>;
    return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === "function")) as ActionsOf<S>;
  };
  return Object.assign(use, { store, actions, getState: () => store.getState(), setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => store.setState(partial) }) as unknown as GameState<S>;
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

  /**
   * The store of `createGameState(data, actions)`. An action runs on a draft, a copy of the state it may change in place (an
   * action called from inside another shares its draft); when the outermost one returns, the draft is compared with the state leaf
   * by leaf, what did not change keeps its object (so a reader comparing by `===` sees no change), and the readers of what did are
   * told, as `setState` tells them. The data is the state's values; the bound actions sit beside them, as the creator form's do.
   */
  static fromActions<D extends object>(data: D, actions: Record<string, GameAction<D>>): GameStore<D> {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "function") throw new Error(`The game state's data holds a function at '${key}': actions go in the second argument of createGameState.`);
      if (key in actions) throw new Error(`'${key}' is both a value and an action of the game state.`);
    }
    let store: GameStore<D> | null = null;
    store = new GameStore<D>(() => {
      const bound: Record<string, unknown> = {};
      for (const [name, action] of Object.entries(actions)) bound[name] = (...args: unknown[]) => store!.#act(action as GameAction<unknown>, args);
      return { ...structuredClone(data), ...bound } as D;
    });
    return store;
  }

  /** The draft the running actions write, or null between actions. */
  #draft: Record<string, unknown> | null = null;

  #act(action: GameAction<unknown>, args: readonly unknown[]): unknown {
    if (this.#draft !== null) return action(this.#draft, ...args);
    const draft = structuredClone(this.values());
    this.#draft = draft;
    let result: unknown;
    try {
      result = action(draft, ...args);
    } finally {
      this.#draft = null;
    }
    this.setState(shareUnchanged(this.values(), draft) as Partial<S>);
    return result;
  }

  constructor(creator: GameStateCreator<S>) {
    const set: SetGameState<S> = (partial) => this.setState(partial);
    const made = creator(set, () => this.#state) as Record<string, unknown>;
    // Each action says its name while it runs, so the development inspector can show what it changed (only when recording).
    for (const [name, value] of Object.entries(made)) {
      if (typeof value !== "function") continue;
      const action = value as (...args: unknown[]) => unknown;
      const named = (...args: unknown[]): unknown => {
        const outer = this.#acting;
        this.#acting = name;
        try {
          return action(...args);
        } finally {
          this.#acting = outer;
        }
      };
      Object.defineProperty(named, "name", { value: name });
      made[name] = named;
    }
    this.#initial = made as S;
    this.#state = this.#initial;
    stores.add(this);
  }

  /** The action running now, if any. */
  #acting: string | null = null;

  /**
   * The last changes, newest last, while `recording` is on (the development inspector turns it on): which action made each (or
   * `"setState"`), and each leaf it changed, before and after.
   */
  readonly history: { readonly action: string; readonly changes: readonly { readonly path: string; readonly before: unknown; readonly after: unknown }[] }[] = [];
  /** Keep `history`. Off by default: a game pays nothing for it. */
  recording = false;

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
    const changed = changedPaths(before as Tree, this.#state as Tree, "", []);
    if (this.recording && changed.length > 0) {
      this.history.push({ action: this.#acting ?? "setState", changes: changed.map((path) => ({ path, before: leafAt(before, path), after: leafAt(this.#state, path) })) });
      if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
    }
    this.#notify(changed);
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

  /**
   * Put back a state taken earlier (development rewind): every value of `snapshot`, keeping this store's actions, telling every
   * reader of a leaf that changed.
   */
  restore(snapshot: Record<string, unknown>): void {
    const before = this.#state;
    const actions = Object.fromEntries(Object.entries(before as Record<string, unknown>).filter(([, v]) => typeof v === "function"));
    this.#state = { ...snapshot, ...actions } as S;
    this.#notify(changedPaths(before as Tree, this.#state as Tree, "", []));
  }

  /** The values of the state, without its actions: what rewind keeps (the state is replaced, never changed in place, so this is a snapshot). */
  values(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.#state as Record<string, unknown>).filter(([, v]) => typeof v !== "function"));
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
 * `after`, with every object or array whose values equal `before`'s replaced by `before`'s own, so what an action did not change
 * keeps its identity. Leaves are compared with `===`.
 */
function shareUnchanged(before: unknown, after: unknown): unknown {
  if (before === after) return before;
  const beforeObject = typeof before === "object" && before !== null;
  const afterObject = typeof after === "object" && after !== null;
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) return after;
  const a = before as Tree;
  const b = after as Tree;
  const keys = Object.keys(b);
  let same = keys.length === Object.keys(a).length;
  const out: Tree = Array.isArray(b) ? ([] as unknown as Tree) : {};
  for (const key of keys) {
    const shared = Object.hasOwn(a, key) ? shareUnchanged(a[key], b[key]) : b[key];
    out[key] = shared;
    if (shared !== a[key]) same = false;
  }
  return same ? before : out;
}

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
/** The value at a dotted path, or undefined. */
function leafAt(state: unknown, path: string): unknown {
  let at: unknown = state;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Tree)[key];
  }
  return at;
}

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
