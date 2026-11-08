/**
 * The authoring entry point: what component source imports.
 *
 *   import { useState, useUpdate, Entity, Sprite } from "@rge/runtime/jsx";
 *
 * Source TSX is compiled, never run, so everything here is a declaration that
 * exists for the type-checker (the functions throw if called). Prop types are
 * derived from the runtime's own classes, so they cannot drift from it, and a
 * test checks that this module exports exactly what the compiler accepts.
 */
import type { InputState } from "./input.ts";
import type { EntityProps } from "./components/Entity.ts";
import type { SpriteProps } from "./components/Sprite.ts";
import type { ColliderProps } from "./components/Collider.ts";
import type { Child, JSX } from "./jsx-runtime.ts";

export type { TransformProps, Child } from "./jsx-runtime.ts";

export { clamp } from "./math.ts";

// -- state and refs -----------------------------------------------------------

/** `useState(100)` infers `number`, not the literal `100`. Arrays and records are kept as written. */
type Widen<T> = T extends number ? number : T extends string ? string : T extends boolean ? boolean : T;

/** Primitive values, the only thing a ref holds. */
type Primitive = number | string | boolean;

export type Setter<T> = (value: T | ((previous: T) => T)) => void;

function compileTimeOnly(name: string): never {
  throw new Error(`${name} is a compile-time declaration: components are compiled by @rge/compiler, not executed.`);
}

/**
 * State: reads are a snapshot of the last render, as in React; setters batch
 * into one render per frame. Arrays and records need their type
 * (`useState<EnemyData[]>([])`) and are updated immutably: a setter only
 * renders when it is given a new value, so `setItems([...items, item])`, never
 * a mutation of `items`.
 */
export function useState<T>(_initial: T): [Widen<T>, Setter<Widen<T>>] {
  return compileTimeOnly("useState");
}

/** A value that persists across frames but never renders. Read and write `.current` in handlers only. */
export function useRef<T extends Primitive>(_initial: T): { current: Widen<T> } {
  return compileTimeOnly("useRef");
}

// -- per-frame hooks ----------------------------------------------------------

/** Runs every frame, after `useInput`. `dt` is the frame time in seconds. */
export function useUpdate(_handler: (dt: number) => void): void {
  return compileTimeOnly("useUpdate");
}

/** Runs every frame with the polled input state, before `useUpdate`. */
export function useInput(_handler: (input: InputState) => void): void {
  return compileTimeOnly("useInput");
}

/**
 * Runs once, when the component joins the world (after its children have).
 * Setting state here renders in the same frame. There is no cleanup to
 * return: that is `useUnmount`.
 */
export function useMount(_handler: () => void): void {
  return compileTimeOnly("useMount");
}

/**
 * Runs once, when the component leaves the world (a condition turning off, a
 * list item removed). It cannot set state, since the component is going away;
 * it can write refs and call callback props, which is how the parent finds out.
 */
export function useUnmount(_handler: () => void): void {
  return compileTimeOnly("useUnmount");
}

// -- elements -----------------------------------------------------------------

/** A named container; the usual root of a component. */
export function Entity(_props: EntityProps & { children?: Child }): JSX.Element {
  return compileTimeOnly("Entity");
}

/** Draws an image. */
export function Sprite(_props: SpriteProps): JSX.Element {
  return compileTimeOnly("Sprite");
}

/** A hit area for collisions. */
export function Collider(_props: ColliderProps): JSX.Element {
  return compileTimeOnly("Collider");
}
