// The IR of expressions: reads, literals, calls, array methods and operators.
import { type StateId, type LocalId, type RefId } from "./ids.ts";
import { type ParamIR } from "./values.ts";



// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type ExprIR =
  | StoreRefIR
  | PlainRefIR
  | NumberLiteralIR
  | StringLiteralIR
  | BooleanLiteralIR
  | NullLiteralIR
  | StateReadIR
  | LocalReadIR
  | ParamReadIR
  | PropertyReadIR
  | PropReadIR
  | RefReadIR
  | MemberReadIR
  | ArrayLiteralIR
  | ObjectLiteralIR
  | ArrowIR
  | CallIR
  | TemplateLiteralIR
  | UnaryExprIR
  | BinaryExprIR
  | ConditionalExprIR;

/**
 * `state={useGame}` on a `<Game>`: the project's game state itself (the imported store), handed to the runtime. It is
 * the only place a component uses the store as a value; the generated code writes the imported name.
 */
/**
 * A function imported from a relative `.ts` file, used as a value (`<Router transition={crossfade} />`): the generated code writes
 * the imported name. The compiler does not look inside it.
 */
export interface PlainRefIR {
  readonly kind: "PlainRef";
  readonly name: string;
}

export interface StoreRefIR {
  readonly kind: "StoreRef";
}

export interface NumberLiteralIR {
  readonly kind: "NumberLiteral";
  readonly value: number;
}

export interface StringLiteralIR {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface BooleanLiteralIR {
  readonly kind: "BooleanLiteral";
  readonly value: boolean;
}

export interface NullLiteralIR {
  readonly kind: "NullLiteral";
}

export interface StateReadIR {
  readonly kind: "StateRead";
  readonly state: StateId;
}

/** A `const` local declared in a function body. */
export interface LocalReadIR {
  readonly kind: "LocalRead";
  readonly local: LocalId;
  readonly name: string;
}

/** A function parameter. */
export interface ParamReadIR {
  readonly kind: "ParamRead";
  readonly param: LocalId;
  readonly name: string;
}

/** `input.pointerX`: only on a parameter of a runtime handle type, checked in transform. */
export interface PropertyReadIR {
  readonly kind: "PropertyRead";
  readonly object: ParamReadIR;
  readonly name: string;
}

/** A declared prop's current value: `this.props.speed`. A callback prop is only read when forwarded as a whole attribute value (`onX={onX}`). */
export interface PropReadIR {
  readonly kind: "PropRead";
  readonly name: string;
}

/** `r.current`: the ref's current value. Only valid inside handlers (a JSX read would never update). */
export interface RefReadIR {
  readonly kind: "RefRead";
  readonly ref: RefId;
}

/**
 * `e.id`, `enemies.length`, `found?.hp`: a member of a value (a record, an
 * array). The compiler does not know the value's type; the type-check of the
 * generated code does. Members of runtime handle parameters are
 * `PropertyRead`, which the manifest checks.
 */
export interface MemberReadIR {
  readonly kind: "MemberRead";
  readonly object: ExprIR;
  readonly name: string;
  /** `?.` */
  readonly optional: boolean;
}

/** `[a, ...rest]`. */
export interface ArrayLiteralIR {
  readonly kind: "ArrayLiteral";
  readonly elements: readonly ArrayElementIR[];
}

export interface ArrayElementIR {
  /** `...value`. */
  readonly spread: boolean;
  readonly value: ExprIR;
}

/** `{ id, speed: 2, ...e }`. Later properties override earlier ones, as in JS. */
export interface ObjectLiteralIR {
  readonly kind: "ObjectLiteral";
  readonly properties: readonly ObjectPropertyIR[];
}

export type ObjectPropertyIR =
  | { readonly kind: "Property"; readonly name: string; readonly value: ExprIR }
  | { readonly kind: "Spread"; readonly value: ExprIR };

/**
 * `(e) => e.id !== id`: an expression-bodied arrow, only valid as the
 * argument of an allowlisted array method, which calls it synchronously (it
 * never escapes). Parameters are `Contextual`: the array's element type
 * provides them.
 */
export interface ArrowIR {
  readonly kind: "Arrow";
  readonly params: readonly ParamIR[];
  readonly body: ExprIR;
}

/** Array methods handler code may call. None mutates its receiver (state updates must be immutable). */
export const ARRAY_METHODS = {
  filter: { args: [1, 1], callback: true },
  map: { args: [1, 1], callback: true },
  some: { args: [1, 1], callback: true },
  every: { args: [1, 1], callback: true },
  find: { args: [1, 1], callback: true },
  findIndex: { args: [1, 1], callback: true },
  includes: { args: [1, 1], callback: false },
  indexOf: { args: [1, 1], callback: false },
  slice: { args: [0, 2], callback: false },
  concat: { args: [1, Infinity], callback: false },
} as const satisfies Record<string, { readonly args: readonly [number, number]; readonly callback: boolean }>;

export type ArrayMethodName = keyof typeof ARRAY_METHODS;

/** Array methods that change the array in place: reported with the immutable alternative. */
export const MUTATING_ARRAY_METHODS: Readonly<Record<string, string>> = {
  push: "`setItems([...items, item])`",
  unshift: "`setItems([item, ...items])`",
  pop: "`setItems(items.slice(0, -1))`",
  shift: "`setItems(items.slice(1))`",
  splice: "`filter`, `slice` and spreads",
  sort: "a sorted copy built from `slice()` (sorting is not supported yet)",
  reverse: "a reversed copy (not supported yet)",
  fill: "`map`",
  copyWithin: "`map`",
  forEach: "`map`, `filter` or `some` (handler code builds new arrays rather than looping)",
};

/** A call to a fixed allowlist (`Math.*`, `clamp`) or a method of a runtime handle parameter. */
export interface CallIR {
  readonly kind: "Call";
  readonly callee: CalleeIR;
  readonly args: readonly ExprIR[];
}

export type CalleeIR =
  | { readonly kind: "Function"; readonly name: string }
  /**
   * A call of a function imported from a relative `.ts` file, or of a method of a value imported from one (`fx.burst`, the
   * name then has a dot): opaque, so its arguments are all it depends on.
   */
  | { readonly kind: "Plain"; readonly name: string }
  | { readonly kind: "Method"; readonly receiver: ParamReadIR; readonly name: string }
  /** `enemies.filter((e) => …)`: an allowlisted, non-mutating array method (`ARRAY_METHODS`) on any value. */
  | { readonly kind: "ArrayMethod"; readonly receiver: ExprIR; readonly name: ArrayMethodName }
  /** A callback prop: `onDefeated()` or `onDefeated?.()`. Argument counts and types are left to the type-check. */
  | { readonly kind: "Prop"; readonly name: string; readonly optional: boolean };

export interface TemplateLiteralIR {
  readonly kind: "TemplateLiteral";
  /** `quasis.length === expressions.length + 1`. */
  readonly quasis: readonly string[];
  readonly expressions: readonly ExprIR[];
}

export type UnaryOperator = "!" | "-" | "+";

export interface UnaryExprIR {
  readonly kind: "Unary";
  readonly operator: UnaryOperator;
  readonly operand: ExprIR;
}

export type BinaryOperator =
  | "+" | "-" | "*" | "/" | "%"
  | "<" | "<=" | ">" | ">="
  | "===" | "!==" | "==" | "!="
  | "&&" | "||" | "??";

export interface BinaryExprIR {
  readonly kind: "Binary";
  readonly operator: BinaryOperator;
  readonly left: ExprIR;
  readonly right: ExprIR;
}

export interface ConditionalExprIR {
  readonly kind: "Conditional";
  readonly test: ExprIR;
  readonly whenTrue: ExprIR;
  readonly whenFalse: ExprIR;
}
