// Identifiers of the IR: branded string ids for state, elements, locals, refs and sounds, their constructors, and source spans.

export declare const stateIdBrand: unique symbol;

export declare const elementIdBrand: unique symbol;

export declare const localIdBrand: unique symbol;

export declare const soundIdBrand: unique symbol;

/** Identifies a persistent state slot within a component. */
export type StateId = string & { readonly [stateIdBrand]: true };

/** Stable structural identity of an element within a component (e.g. `Player/0/1`). */
export type ElementId = string & { readonly [elementIdBrand]: true };

/** Identifies a parameter or `const` local inside one function body. */
export type LocalId = string & { readonly [localIdBrand]: true };

/** Identifies a `useSound` binding within a component. */
export type SoundId = string & { readonly [soundIdBrand]: true };

export function soundId(component: string, name: string): SoundId {
  return `${component}.${name}` as SoundId;
}

export function localId(component: string, name: string, serial: number): LocalId {
  return `${component}.${name}#${serial}` as LocalId;
}

export function stateId(component: string, name: string): StateId {
  return `${component}.${name}` as StateId;
}

export function elementId(component: string, path: readonly number[]): ElementId {
  return [component, ...path].join("/") as ElementId;
}

export interface SourceSpan {
  readonly fileName: string;
  readonly start: number;
  readonly end: number;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}
