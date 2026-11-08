import { GameObject } from "../GameObject.ts";

export interface EntityProps {
  name?: string;
}

/**
 * A named container. Compiled components extend Entity.
 *
 * `P` is the component's props type. A component with props passes them (and
 * the defaults for the optional ones) to the constructor, so they are available
 * to field initialisers, which run right after `super()` returns.
 */
export class Entity<P extends object = {}> extends GameObject {
  static override readonly intrinsic = true;

  name: string;
  /** The component's props: a private copy, updated in place by `updateProps`. */
  props: P;

  constructor(hostProps: EntityProps = {}, props?: P, defaults?: Partial<P>) {
    super();
    this.name = hostProps.name ?? "";
    this.props = { ...defaults, ...definedOnly(props) } as P;
  }

  /**
   * Apply changed props from the parent. A key whose value is `undefined`
   * falls back to its default; a key not mentioned is left alone. Compares
   * with `===` and returns whether anything changed, so the caller can mark
   * the component dirty exactly once.
   */
  protected applyProps(next: Partial<P>, defaults: Partial<P> = {}): boolean {
    let changed = false;
    for (const key of Object.keys(next) as (keyof P)[]) {
      const value = (next[key] === undefined ? defaults[key] : next[key]) as P[keyof P];
      if (this.props[key] !== value) {
        this.props[key] = value;
        changed = true;
      }
    }
    return changed;
  }
}

function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (value) for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}
