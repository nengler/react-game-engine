import type { ExprIR, LocalId, RefId, SoundId, StateId, TypeIR } from "../ir/types.ts";

type Binding =
  | { readonly kind: "state"; readonly id: StateId }
  | { readonly kind: "setter"; readonly state: StateId; readonly name: string }
  | { readonly kind: "ref"; readonly id: RefId; readonly name: string }
  /** A `useSound` function: only called, as a statement in a handler. */
  | { readonly kind: "sound"; readonly id: SoundId; readonly name: string }
  /** A game-state action (`const collect = useGame((s) => s.collect)`): only called, as a statement in a handler. */
  | { readonly kind: "action"; readonly name: string; readonly action: string }
  /** A declared prop in scope as a plain name. A value reads `this.props.x`; a callback is only called (or forwarded whole). */
  | { readonly kind: "prop"; readonly name: string; readonly role: "value" | "callback" }
  /** The whole props object of `function Enemy(props: EnemyProps)`: only read as `props.speed` or called as `props.onDefeated?.()`. */
  | { readonly kind: "propsObject"; readonly name: string }
  /** The `children` prop of a component that renders `{children}`: only valid as that child, never read as a value. */
  | { readonly kind: "children"; readonly name: string }
  /** A component-body `const`: its (already lowered) expression is inlined wherever it is read. */
  | { readonly kind: "derived"; readonly name: string; readonly value: ExprIR }
  /** A `const` (or, `mutable`, a `let`) declared in a handler body, or a `for…of` item. */
  /**
   * `owned`: the handler made the value (a literal, `new`, a call's result), so it may change it in place. A local that reads
   * state, a prop or another value (`const list = enemies`) is not owned: changing it would change state in place.
   */
  | { readonly kind: "local"; readonly id: LocalId; readonly name: string; readonly mutable: boolean; owned?: boolean }
  /** The parameter of a computed `useGame` selector (`s` in `(s) => s.cursor === id`): only read as a path, `s.cursor`. */
  | { readonly kind: "storeRoot"; readonly name: string }
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

  /** Every name in scope, innermost first: the candidates for a "did you mean" suggestion. */
  names(): string[] {
    return [...this.#bindings.keys(), ...(this.parent?.names() ?? [])];
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
