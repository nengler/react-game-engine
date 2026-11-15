/**
 * Context, as React's: a value a component provides to everything below it, read where it is needed instead of passed down by
 * hand through every level.
 *
 *     // theme.ts
 *     export const Theme = createContext({ accent: "#ffb15e", text: "#fff1d6" });
 *
 *     <Theme.Provider value={palette}>…</Theme.Provider>     // in a component: everything under it reads `palette`
 *     const { accent } = useContext(Theme);                   // in a component under it
 *
 * The compiler writes `<Theme.Provider value>` as the built-in `<Provider context={Theme} value>`, and `useContext(Theme)` as a
 * state that a `ContextReader` keeps up to date: the reader finds the nearest provider of its context above its component when
 * the component joins a world, and the provider marks every reader's component dirty when its value changes.
 */
import { Entity, type EntityProps } from "./components/Entity.ts";
import type { GameObject } from "./GameObject.ts";
import type { Child, JSX } from "./jsx-runtime.ts";
import type { World } from "./World.ts";

/** What `createContext` returns: its default value, and (for the type-checker) the `Provider` element written `<Theme.Provider>`. */
export interface Context<T> {
  readonly default: T;
  /** `<Theme.Provider value={…}>…</Theme.Provider>`: compiled into the built-in `<Provider context={Theme} value>`. */
  // A method, so a context of any value type is a `Context<unknown>` (as `<Provider context>` takes it).
  Provider(props: { value: T; children?: Child }): JSX.Element;
}

/** Make a context, in a `.ts` file: `export const Theme = createContext({ accent: "#ffb15e" })`. */
export function createContext<T>(defaultValue: T): Context<T> {
  return {
    default: defaultValue,
    Provider: () => {
      throw new Error("<Context.Provider> is a compile-time declaration: components are compiled by @rge/compiler, not executed.");
    },
  };
}

export interface ProviderProps extends EntityProps {
  /** The context it provides. */
  context: Context<unknown>;
  /** What every `useContext(context)` under it reads. */
  value: unknown;
}

/**
 * The built-in `<Provider context value>` (written `<Theme.Provider value>`): a container that layout sees through and that draws
 * nothing, which hands `value` to every reader of `context` below it, and tells them when it changes.
 */
export class Provider<P extends object = {}> extends Entity<P> {
  override readonly layoutContents = true;
  readonly context: Context<unknown>;
  #value: unknown;
  readonly #readers = new Set<GameObject>();

  constructor(hostProps: ProviderProps, props?: P, defaults?: Partial<P>) {
    super(hostProps, props, defaults);
    this.context = hostProps.context;
    this.#value = hostProps.value;
  }

  get value(): unknown {
    return this.#value;
  }

  /** A new value: every component that reads this context renders again. */
  set value(next: unknown) {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const reader of this.#readers) reader.markDirty();
  }

  /** A component under it reads its context (see `ContextReader`). */
  addReader(component: GameObject): void {
    this.#readers.add(component);
  }

  removeReader(component: GameObject): void {
    this.#readers.delete(component);
  }
}

/**
 * What a component's `useContext(Theme)` keeps: the provider it found when the component joined a world (the nearest one of
 * that context above it), or none, in which case `value` is the context's default.
 */
export class ContextReader<T> {
  readonly #context: Context<T>;
  #provider: Provider | null = null;
  #owner: GameObject | null = null;

  constructor(context: Context<T>) {
    this.#context = context;
  }

  get value(): T {
    return this.#provider === null ? this.#context.default : (this.#provider.value as T);
  }

  /** Called when the component joins a world (`GameObject.ownedHandles`): find the provider, and render with its value. */
  attachOwner(owner: GameObject, _world: World): void {
    this.#owner = owner;
    for (let at = owner.parent; at !== null; at = at.parent) {
      if (at instanceof Provider && at.context === (this.#context as Context<unknown>)) {
        this.#provider = at;
        at.addReader(owner);
        break;
      }
    }
    owner.markDirty();
  }

  detachOwner(): void {
    if (this.#owner !== null) this.#provider?.removeReader(this.#owner);
    this.#provider = null;
    this.#owner = null;
  }
}

/** A component's reader of a context: the compiler writes one for each `useContext`. */
export function readContext<T>(context: Context<T>): ContextReader<T> {
  return new ContextReader(context);
}
