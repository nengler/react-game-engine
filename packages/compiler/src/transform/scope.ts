import type { ExprIR, LocalId, RefId, StateId, TypeIR } from "../ir/types.ts";

export type Binding =
  | { readonly kind: "state"; readonly id: StateId }
  | { readonly kind: "setter"; readonly state: StateId; readonly name: string }
  | { readonly kind: "ref"; readonly id: RefId; readonly name: string }
  /** A declared prop in scope as a plain name. A value reads `this.props.x`; a callback is only called (or forwarded whole). */
  | { readonly kind: "prop"; readonly name: string; readonly role: "value" | "callback" }
  /** The whole props object of `function Enemy(props: EnemyProps)`: only read as `props.speed` or called as `props.onDefeated?.()`. */
  | { readonly kind: "propsObject"; readonly name: string }
  /** A component-body `const`: its (already lowered) expression is inlined wherever it is read. */
  | { readonly kind: "derived"; readonly name: string; readonly value: ExprIR }
  | { readonly kind: "local"; readonly id: LocalId; readonly name: string }
  | { readonly kind: "param"; readonly id: LocalId; readonly name: string; readonly type: TypeIR };

/** Lexical scope chain: component scope (state, setters) → function scope (params) → block scopes (locals). */
export class Scope {
  readonly #bindings = new Map<string, Binding>();
  readonly parent: Scope | null;

  constructor(parent: Scope | null = null) {
    this.parent = parent;
  }

  get(name: string): Binding | undefined {
    return this.#bindings.get(name) ?? this.parent?.get(name);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Declared in this scope itself, not an outer one. */
  hasOwn(name: string): boolean {
    return this.#bindings.has(name);
  }

  declare(name: string, binding: Binding): void {
    this.#bindings.set(name, binding);
  }
}
