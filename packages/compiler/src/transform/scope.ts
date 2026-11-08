import type { LocalId, RefId, StateId, TypeIR } from "../ir/types.ts";

export type Binding =
  | { readonly kind: "state"; readonly id: StateId }
  | { readonly kind: "setter"; readonly state: StateId; readonly name: string }
  | { readonly kind: "ref"; readonly id: RefId; readonly name: string }
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

  declare(name: string, binding: Binding): void {
    this.#bindings.set(name, binding);
  }
}
