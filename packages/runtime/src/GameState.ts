import type { GameObject } from "./GameObject.ts";

/** What a leaf of the game state holds. Objects and arrays hold more of these. */
export type GameStateValue = number | string | boolean;

/**
 * A selected value, as components and plain code read it: read-only all the way down. Only the game state's actions change it,
 * so a value read from it is never written in place (`run.items.push(…)` is a type error, as `run.time = 0` is).
 */
export type ReadonlyDeep<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer I)[]
    ? readonly ReadonlyDeep<I>[]
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyDeep<T[K]> }
      : T;

/**
 * The game's state. Create it once, in `GameState.ts`, from its data and the actions that change it:
 *
 *     export const useGame = createGameState(
 *       { coins: 0, player: { hp: 10 } },
 *       {
 *         collect(s, n: number) { s.coins += n; },
 *         hurt(s) { s.player.hp -= 1; },
 *       }
 *     );
 *
 * A component reads with a selector, which returns the value: `const hp = useGame((s) => s.player.hp)`, and takes the
 * actions it calls in handlers with `const { collect } = useGame.actions()`. Calling `useGame` is compile-time only (the
 * compiler turns the selector into that one path). What a selector returns is read-only: only actions change the state.
 */
export interface GameState<S> {
  <T>(selector: (state: ReadonlyDeep<S>) => T): ReadonlyDeep<T>;
  readonly store: GameStore<S>;
  /**
   * The store's actions, and nothing else: `const { collect, hurt } = useGame.actions()` in a component (actions never change,
   * so this subscribes to nothing and never renders it), or `useGame.actions().collect()` in plain code.
   */
  actions(): ActionsOf<S>;
  /** The whole state, read-only, with its actions: for plain code (a test, a tool) that reads it. */
  getState(): ReadonlyDeep<S>;
  /**
   * Replace part of the state from outside the game: a test, a story's `setup`, a tool. Shallow-merged, as Zustand's
   * `setState` is (`useGame.setState({ run: { ...newRun(), time: 754 } })`). Game code changes the state through its actions;
   * calling this while an action runs is an error, since the action's changes would overwrite it.
   */
  setState(partial: Partial<S> | ((state: ReadonlyDeep<S>) => Partial<S>)): void;
}

/** The functions of a state: its actions. */
export type ActionsOf<S> = { readonly [K in keyof S as S[K] extends (...args: never[]) => unknown ? K : never]: S[K] };

/**
 * An action of `createGameState(data, actions)`: it takes the state, writable, then its own arguments, and changes the state
 * in place (`select(s, pad: number) { s.cursor = pad; }`). What it returns is returned to the caller. An action may call
 * another (`useGame.actions().begin()`): they share one draft, committed when the outermost returns.
 */
export type GameAction<D> = (state: D, ...args: any[]) => unknown;

/** The actions as components call them: the state argument is supplied (`select(3)`). */
export type BoundActions<A> = {
  readonly [K in keyof A]: A[K] extends (state: never, ...args: infer P) => infer R ? (...args: P) => R : never;
};

/**
 * Create the game's state from its data, a plain object, and its actions: each takes the state as its first argument and
 * writes it directly (`select(s, pad: number) { s.cursor = pad; s.open = true; }`). A component calls an action without the
 * state (`const { select } = useGame.actions(); select(3)`). Only actions change the state.
 */
export function createGameState<D extends object, A extends Record<string, GameAction<D>>>(
  data: D,
  actions: A
): GameState<D & BoundActions<A>> {
  if (typeof data === "function" || actions === undefined || typeof actions !== "object")
    throw new Error(
      "createGameState takes the data and the actions: `createGameState({ coins: 0 }, { collect(s) { s.coins += 1; } })`. The `(set) => ({ … })` form was removed."
    );
  return wrap(GameStore.fromActions(data, actions)) as unknown as GameState<D & BoundActions<A>>;
}

function wrap<S>(store: GameStore<S>): GameState<S> {
  const use = (): never => {
    throw new Error("useGame(selector) is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
  };
  const actions = (): ActionsOf<S> => {
    const state = store.getState() as Record<string, unknown>;
    return Object.fromEntries(Object.entries(state).filter(([, value]) => typeof value === "function")) as ActionsOf<S>;
  };
  return Object.assign(use, {
    store,
    actions,
    getState: () => store.getState(),
    setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => store.setState(partial),
  }) as unknown as GameState<S>;
}

/**
 * The state behind a `createGameState`. An action runs on a draft; when it returns, the store compares the old and new state
 * leaf by leaf and marks dirty every mounted object that reads a leaf that changed (and only those). Those objects copy the new
 * value into their own field when they next render, so within a frame every handler sees the same snapshot. An action that
 * changes no leaf renders nothing. A function in the state (an action) is not a leaf.
 */
export class GameStore<S = object> {
  #initial: S;
  #state: S;
  readonly #subscribers = new Map<string, Set<GameObject>>();

  /**
   * The store of `createGameState(data, actions)`. An action runs on a draft, a copy of the state it may change in place (an
   * action called from inside another shares its draft); when the outermost one returns, the draft is compared with the state leaf
   * by leaf, what did not change keeps its object (so a reader comparing by `===` sees no change), and the readers of what did are
   * told. The data is the state's values; the bound actions sit beside them.
   */
  static fromActions<D extends object>(data: D, actions: Record<string, GameAction<D>>): GameStore<D> {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "function")
        throw new Error(`The game state's data holds a function at '${key}': actions go in the second argument of createGameState.`);
      if (key in actions) throw new Error(`'${key}' is both a value and an action of the game state.`);
    }
    const store = new GameStore<D>(cloneData(data) as D);
    const bound: Record<string, unknown> = {};
    for (const [name, action] of Object.entries(actions)) {
      // Each action says its name while it runs, so the development inspector can show what it changed (only when recording).
      const named = (...args: unknown[]): unknown => store.#act(name, action as GameAction<unknown>, args);
      Object.defineProperty(named, "name", { value: name });
      bound[name] = named;
    }
    store.#initial = { ...(store.#initial as object), ...bound } as D;
    store.#state = store.#initial;
    return store;
  }

  private constructor(initial: S) {
    this.#initial = initial;
    this.#state = initial;
    stores.add(this);
  }

  /** The draft the running actions write, or null between actions. */
  #draft: Record<string, unknown> | null = null;

  #act(name: string, action: GameAction<unknown>, args: readonly unknown[]): unknown {
    if (this.#draft !== null) return action(this.#draft, ...args);
    const draft = cloneData(this.values()) as Record<string, unknown>;
    this.#draft = draft;
    this.#acting = name;
    try {
      const result = action(draft, ...args);
      this.#draft = null;
      this.#commit(shareUnchanged(this.values(), draft) as Partial<S>);
      return result;
    } finally {
      this.#draft = null;
      this.#acting = null;
    }
  }

  /** The action running now, if any. */
  #acting: string | null = null;

  /**
   * The last changes, newest last, while `recording` is on (the development inspector turns it on): which action made each (or
   * `"setState"`), and each leaf it changed, before and after.
   */
  readonly history: {
    readonly action: string;
    readonly changes: readonly { readonly path: string; readonly before: unknown; readonly after: unknown }[];
  }[] = [];
  /** Keep `history`. Off by default: a game pays nothing for it. */
  recording = false;

  /**
   * The whole state, with its actions. While an action runs, it is the action's draft as it stands (with the actions), so plain
   * code an action calls (a save's `pick`) reads what the action has written so far.
   */
  getState(): S {
    if (this.#draft === null) return this.#state;
    const actions = Object.entries(this.#state as Record<string, unknown>).filter(([, v]) => typeof v === "function");
    return { ...this.#draft, ...Object.fromEntries(actions) } as S;
  }

  /** Replace part of the state from outside the game (a test, a story, a tool): shallow-merged. See `GameState.setState`. */
  setState(partial: Partial<S> | ((state: S) => Partial<S>)): void {
    if (this.#draft !== null)
      throw new Error(
        `setState was called while the action '${this.#acting}' runs: write the state it was given instead, or call another action.`
      );
    const next = typeof partial === "function" ? partial(this.#state) : partial;
    if (next === null || next === undefined) return;
    this.#commit(next);
  }

  #commit(next: Partial<S>): void {
    const before = this.#state;
    this.#state = { ...before, ...next };
    const changed = changedPaths(before as Tree, this.#state as Tree, "", []);
    if (this.recording && changed.length > 0) {
      this.history.push({
        action: this.#acting ?? "setState",
        changes: changed.map((path) => ({ path, before: leafAt(before, path), after: leafAt(this.#state, path) })),
      });
      if (this.history.length > 50) this.history.splice(0, this.history.length - 50);
    }
    this.#notify(changed);
  }

  /**
   * The latest value at a dotted path (`"player.hp"`, `"player"`, `"enemies"`): a leaf, or an object or array as the state
   * holds it. What a compiled component's snapshot reads. Treat an object you get as read-only: actions change the state.
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

  /** Back to the state's initial data, telling every reader. The player does this at start. */
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
      for (let at = path; ;) {
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
 * A deep copy of the game state's data: arrays and plain objects are copied, anything else (a number, a string, an instance of a
 * class) is kept as it is. `structuredClone` would do, but QuickJS-ng, which runs packaged games, does not have it.
 */
function cloneData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneData);
  if (typeof value !== "object" || value === null) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Tree = {};
  for (const key of Object.keys(value)) out[key] = cloneData((value as Tree)[key]);
  return out;
}

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
