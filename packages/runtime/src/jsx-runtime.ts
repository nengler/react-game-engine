/**
 * The JSX types for authoring components (`jsxImportSource: "@rge/runtime"`).
 * Source TSX is never executed: the compiler turns it into classes. These
 * declarations exist so an editor and `tsc` can type-check the TSX itself.
 */

import type { Transform } from "./Transform.ts";

/** Position, rotation, scale and `global`, derived from the runtime's `Transform`. All optional. */
export type TransformProps = Partial<Transform>;

/** What a JSX element may be inside another element: elements, and the `false`/`null` that `{cond && <X />}` and `{cond ? <X /> : null}` produce. */
export type Child = JSX.Element | false | null | undefined | readonly Child[];

declare const elementBrand: unique symbol;

export namespace JSX {
  /** The type of a JSX expression. Opaque: it only says "this came from JSX". */
  export interface Element {
    readonly [elementBrand]: true;
  }
  /** Built-in elements are capitalised components, so there are no lowercase tags. */
  export interface IntrinsicElements {}
  export interface ElementChildrenAttribute {
    children: {};
  }
  /**
   * Attributes of every element, whatever its props type: `key` (keyed lists
   * use it, a later milestone) and `transform`. On a built-in, `transform`
   * sets its own transform; on a component, it places the component, so the
   * component's props type never declares it.
   */
  export interface IntrinsicAttributes {
    key?: string | number;
    /** Relative to the parent unless `global: true`. Values may come from state. */
    transform?: TransformProps;
  }
}

function compileTimeOnly(name: string): never {
  throw new Error(`${name} is a compile-time declaration: components are compiled by @rge/compiler, not executed.`);
}

export function jsx(_type: unknown, _props: unknown, _key?: unknown): JSX.Element {
  return compileTimeOnly("jsx");
}

export const jsxs = jsx;

export function Fragment(_props: { children?: Child }): JSX.Element {
  return compileTimeOnly("Fragment");
}
