/**
 * The compiler's Intermediate Representation.
 *
 * The IR is plain, JSON-serialisable data with no references to TypeScript AST
 * nodes. Every union is discriminated by `kind`; consumers should switch on it
 * and use `assertNever` so new variants are compile errors until handled.
 */

declare const stateIdBrand: unique symbol;
declare const elementIdBrand: unique symbol;
declare const localIdBrand: unique symbol;
declare const refIdBrand: unique symbol;

/** Identifies a persistent state slot within a component. */
export type StateId = string & { readonly [stateIdBrand]: true };
/** Stable structural identity of an element within a component (e.g. `Player/0/1`). */
export type ElementId = string & { readonly [elementIdBrand]: true };

/** Identifies a parameter or `const` local inside one function body. */
export type LocalId = string & { readonly [localIdBrand]: true };

/** Identifies a `useRef` value within a component. */
export type RefId = string & { readonly [refIdBrand]: true };

export function refId(component: string, name: string): RefId {
  return `${component}.${name}` as RefId;
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

// ---------------------------------------------------------------------------
// Module / component
// ---------------------------------------------------------------------------

export interface IRModule {
  readonly kind: "Module";
  readonly sourceFile: string;
  /**
   * Top-level `interface` / `type` declarations (a component's props type),
   * copied into the generated module as written, so the type-check validates them.
   */
  readonly typeDeclarations: readonly TypeDeclarationIR[];
  readonly components: readonly ComponentIR[];
}

/** A source `interface Name { … }` or `type Name = { … }`, kept as text. */
export interface TypeDeclarationIR {
  readonly kind: "TypeDeclaration";
  readonly name: string;
  /** The declaration's source text, without `export`. */
  readonly text: string;
}

export interface ComponentIR {
  readonly kind: "Component";
  readonly name: string;
  readonly span: SourceSpan;
  /** Hook declarations, in source order. */
  readonly hooks: readonly HookIR[];
  /** Persistent storage slots created by hooks. */
  readonly state: readonly StateIR[];
  /** `useRef` values: mutable fields that never cause a render. */
  readonly refs: readonly RefIR[];
  /** Declared props, from the destructured parameter. Empty for a component without props. */
  readonly props: readonly PropDeclIR[];
  /** The name of the props type (`EnemyProps`), or null for a component without props. */
  readonly propsType: string | null;
  /** `export default function Enemy() {}` or `export default Enemy;`: the module also exports it as its default. */
  readonly isDefaultExport: boolean;
  /** The root `<Entity>`: describes the component instance itself. */
  readonly root: HostElementIR;
}

// ---------------------------------------------------------------------------
// Hooks and state
// ---------------------------------------------------------------------------

/** Hook declarations. (`useRef` is not a hook entry: its handle is a `RefIR` in `ComponentIR.refs`.) */
export type HookIR = UseStateHookIR | OnUpdateHookIR | OnInputHookIR;

/**
 * The fields of a transform (runtime `Entity.transform`), settable with the
 * `transform={{ x, y }}` attribute. Pixels, y down; `rotation` in radians.
 * Relative to the nearest ancestor `<Entity>` unless `global` is true.
 */
export const TRANSFORM_FIELDS = ["x", "y", "rotation", "scaleX", "scaleY", "global"] as const;
export type TransformField = (typeof TRANSFORM_FIELDS)[number];

/**
 * `const cooldown = useRef(0)`: a value that persists across frames and
 * renders but is not state. Reading or writing `cooldown.current` never marks
 * anything dirty, so it is for bookkeeping nothing on screen depends on
 * (timers, accumulators, previous values). Refs hold values only; there is no
 * `ref={…}` on elements.
 */
export interface RefIR {
  readonly kind: "Ref";
  readonly id: RefId;
  /** Also the generated field name. */
  readonly name: string;
  readonly type: ValueType;
  /** Must not read state. */
  readonly initialValue: ExprIR;
  readonly span: SourceSpan;
}

export interface UseStateHookIR {
  readonly kind: "UseState";
  readonly state: StateId;
  /** Name of the generated setter method, or null if the setter was not bound. */
  readonly setterName: string | null;
  readonly span: SourceSpan;
}

/** `onUpdate((dt) => { ... })`: runs once per `World.tick(dt, input)`, after `onInput`. */
export interface OnUpdateHookIR {
  readonly kind: "OnUpdate";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

/** `onInput((input) => { ... })`: runs once per tick with the polled `InputState`, before `onUpdate`. */
export interface OnInputHookIR {
  readonly kind: "OnInput";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

export type HandlerHookIR = OnUpdateHookIR | OnInputHookIR;

export function isHandlerHook(hook: HookIR): hook is HandlerHookIR {
  return hook.kind === "OnUpdate" || hook.kind === "OnInput";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Primitive value types (what a ref holds, and what the compiler infers from a literal). */
export type ValueType = "number" | "string" | "boolean";

/**
 * The types the IR can name. State is a primitive, an `Array`, or a
 * `SourceType` (a type written in the component's file, such as a record
 * interface); refs hold primitives only.
 */
export type TypeIR = PrimitiveTypeIR | NamedTypeIR | ContextualTypeIR | ArrayTypeIR | SourceTypeIR;

/** `T[]`. */
export interface ArrayTypeIR {
  readonly kind: "Array";
  readonly element: TypeIR;
}

/**
 * A type written in the source (`EnemyData`, `{ x: number }`, `"a" | "b"`),
 * copied into the generated code as text. The type declarations of the file
 * are copied too, so the type-check resolves it.
 */
export interface SourceTypeIR {
  readonly kind: "SourceType";
  readonly text: string;
}

/**
 * No annotation: the parameter's type comes from where the function is used.
 * A callback passed to a child component is contextually typed by the child's
 * props type, which the parent (compiling one file at a time) cannot see.
 */
export interface ContextualTypeIR {
  readonly kind: "Contextual";
}

export interface PrimitiveTypeIR {
  readonly kind: "Primitive";
  readonly name: ValueType | "void";
}

/** A type exported by the runtime package (`GameObject`, `InputState`). */
export interface NamedTypeIR {
  readonly kind: "Named";
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Functions and statements (handler bodies)
// ---------------------------------------------------------------------------

export interface ParamIR {
  readonly id: LocalId;
  readonly name: string;
  readonly type: TypeIR;
}

/** A small function body: a hook handler or a `setX(prev => ...)` updater. */
export interface FunctionIR {
  readonly kind: "Function";
  readonly params: readonly ParamIR[];
  readonly body: readonly StatementIR[];
}

/**
 * Statements are only valid inside functions. State reads are live: after a
 * `SetState`, later reads in the same function see the new value.
 */
export type StatementIR = ExpressionStatementIR | LocalConstStmtIR | IfStmtIR | ReturnStmtIR | SetStateStmtIR | AssignStmtIR;

export type AssignOperator = "=" | "+=" | "-=" | "*=" | "/=";

/** Where an assignment writes. Not reactive: no write marks anything dirty. */
export type AssignTargetIR = RefCurrentTargetIR;

/** `r.current`, where `r` is a `useRef` value. */
export interface RefCurrentTargetIR {
  readonly kind: "RefCurrent";
  readonly ref: RefId;
}

/** `target = value;` and the compound forms. */
export interface AssignStmtIR {
  readonly kind: "Assign";
  readonly target: AssignTargetIR;
  readonly operator: AssignOperator;
  readonly value: ExprIR;
}

/** An allowlisted call evaluated for its effect (later: callback props). */
export interface ExpressionStatementIR {
  readonly kind: "ExpressionStatement";
  readonly expression: ExprIR;
}

/** `const name = expr;` scoped to the enclosing block. */
export interface LocalConstStmtIR {
  readonly kind: "LocalConst";
  readonly id: LocalId;
  readonly name: string;
  readonly value: ExprIR;
}

export interface IfStmtIR {
  readonly kind: "If";
  readonly test: ExprIR;
  readonly then: readonly StatementIR[];
  /** Empty when there is no `else`. */
  readonly else: readonly StatementIR[];
}

/** `return;` in a handler, `return expr;` in an updater. */
export interface ReturnStmtIR {
  readonly kind: "Return";
  readonly value: ExprIR | null;
}

/** `setX(value)` or `setX(prev => ...)`. Emitted as a call to the generated setter, so dirty marking stays in one place. */
export type SetStateStmtIR = SetStateValueIR | SetStateUpdaterIR;

export interface SetStateValueIR {
  readonly kind: "SetState";
  readonly state: StateId;
  readonly value: ExprIR;
}

export interface SetStateUpdaterIR {
  readonly kind: "SetState";
  readonly state: StateId;
  /** One parameter (the previous value), returning the next value. */
  readonly updater: FunctionIR;
}

export interface StateIR {
  readonly kind: "State";
  readonly id: StateId;
  /** Field name on the generated class. */
  readonly name: string;
  /** A primitive, an array (`useState<EnemyData[]>([])`) or a source type. */
  readonly type: TypeIR;
  /** Must not depend on any state. */
  readonly initialValue: ExprIR;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** What an element instantiates. */
export type ComponentRef = IntrinsicComponentRef | LocalComponentRef | ImportedComponentRef;

/** A component provided by the runtime package (Entity, Sprite, ...). */
export interface IntrinsicComponentRef {
  readonly kind: "Intrinsic";
  readonly name: string;
}

/** A compiled component declared in the same module. */
export interface LocalComponentRef {
  readonly kind: "Local";
  readonly name: string;
}

/** A compiled component declared in another source file. */
export interface ImportedComponentRef {
  readonly kind: "Imported";
  readonly name: string;
  /** The specifier as written in the source (`./WarningIcon.tsx`); the generator points it at the generated `.ts`. */
  readonly module: string;
  /** `import Enemy from "./Enemy.tsx"`: `name` is the local name of the module's default export. */
  readonly isDefault: boolean;
}

/** The component's root element; it *is* the instance, so it has no field. */
export interface HostElementIR {
  readonly kind: "HostElement";
  readonly component: IntrinsicComponentRef;
  readonly props: readonly PropIR[];
  /** `transform={{ x, y }}`: the instance's own transform. See `ElementIR.transform`. */
  readonly transform: readonly TransformPropIR[];
  readonly children: readonly ChildIR[];
  readonly span: SourceSpan;
}

/** A persistent child instance owned by the component. */
export interface ElementIR {
  readonly kind: "Element";
  readonly id: ElementId;
  /** Unique within the component. */
  readonly fieldName: string;
  readonly component: ComponentRef;
  readonly props: readonly PropIR[];
  /**
   * `transform={{ x: x, y: 0 }}`: writes to the element's runtime `transform`
   * (only `<Entity>` elements have one). Each field is a static or dynamic
   * prop like any other, so position is ordinary state: `setX(...)` moves it.
   */
  readonly transform: readonly TransformPropIR[];
  readonly children: readonly ChildIR[];
  readonly span: SourceSpan;
}

/** How a child exists over time. Future: KeyedListChild. */
export type ChildIR = StaticChildIR | ConditionalChildIR;

/** Created once with its parent; never recreated. */
export interface StaticChildIR {
  readonly kind: "StaticChild";
  readonly element: ElementIR;
}

/** Created when `condition` becomes truthy, destroyed when it becomes falsy. */
export interface ConditionalChildIR {
  readonly kind: "ConditionalChild";
  readonly condition: ExprIR;
  readonly dependencies: readonly DependencyIR[];
  readonly element: ElementIR;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PropIR = ValuePropIR | CallbackPropIR;

/** A prop that is a value: static (evaluated once) or dynamic (re-evaluated on render). */
export type ValuePropIR = StaticPropIR | DynamicPropIR;

/** A `transform` field; `name` is one of `TRANSFORM_FIELDS`. */
export type TransformPropIR = ValuePropIR & { readonly name: TransformField };

/**
 * What a dynamic value depends on, so a render is only needed when it can
 * have changed: a state slot of this component, or one of its props (which
 * the parent updates through `updateProps`).
 */
export type DependencyIR =
  | { readonly kind: "State"; readonly state: StateId }
  | { readonly kind: "Prop"; readonly name: string };

/**
 * A callback passed to a child component: `onDefeated={() => setScore(…)}`.
 * Created once with the child, inline in its constructor call, so it is
 * contextually typed by the child's props type and reads state through
 * `this` (never stale). It is therefore never "dynamic".
 */
export interface CallbackPropIR {
  readonly kind: "CallbackProp";
  readonly name: string;
  /** Parameters are `Contextual`: their types come from the child. */
  readonly handler: FunctionIR;
}

// -- declared props (the receiving side) --------------------------------------

/** A prop a component declares in its destructured parameter. */
export interface PropDeclIR {
  readonly kind: "PropDecl";
  readonly name: string;
  /** `?` in the props type, or a default in the destructuring. */
  readonly optional: boolean;
  /** `= 1` in the destructuring; must not read state or other props. */
  readonly defaultValue: ExprIR | null;
  /** A function type is a callback (called, never read); anything else is a value. */
  readonly role: "value" | "callback";
  readonly type: PropTypeIR;
}

/**
 * A prop's type as the compiler understands it: enough for a scene schema
 * (M6) without asking the TypeScript checker. Type-checking itself uses the
 * copied source text, so anything not representable here is `SourceText`
 * (such a prop is "code-only": data cannot set it).
 */
export type PropTypeIR =
  | { readonly kind: "Primitive"; readonly name: ValueType }
  | { readonly kind: "Literals"; readonly values: readonly (string | number)[] }
  | { readonly kind: "Array"; readonly element: PropTypeIR }
  | { readonly kind: "Function" }
  | { readonly kind: "SourceText"; readonly text: string };

/** Evaluated once at construction. */
export interface StaticPropIR {
  readonly kind: "StaticProp";
  readonly name: string;
  readonly value: ExprIR;
}

/** Re-evaluated on render and written to the existing instance. */
export interface DynamicPropIR {
  readonly kind: "DynamicProp";
  readonly name: string;
  readonly value: ExprIR;
  readonly dependencies: readonly DependencyIR[];
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type ExprIR =
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function assertNever(value: never, what = "value"): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}

/** Direct sub-expressions of an expression, in evaluation order. */
export function childExpressions(e: ExprIR): readonly ExprIR[] {
  switch (e.kind) {
    case "NumberLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "StateRead":
    case "LocalRead":
    case "ParamRead":
    case "RefRead":
    case "PropRead":
      return [];
    case "PropertyRead":
    case "MemberRead":
      return [e.object];
    case "ArrayLiteral":
      return e.elements.map((el) => el.value);
    case "ObjectLiteral":
      return e.properties.map((p) => p.value);
    case "Arrow":
      return [e.body];
    case "Call":
      return e.callee.kind === "Method" || e.callee.kind === "ArrayMethod" ? [e.callee.receiver, ...e.args] : e.args;
    case "TemplateLiteral":
      return e.expressions;
    case "Unary":
      return [e.operand];
    case "Binary":
      return [e.left, e.right];
    case "Conditional":
      return [e.test, e.whenTrue, e.whenFalse];
    default:
      return assertNever(e, "expression");
  }
}

/** Pre-order walk over an expression tree. */
export function walkExpr(expr: ExprIR, visit: (e: ExprIR) => void): void {
  visit(expr);
  for (const child of childExpressions(expr)) walkExpr(child, visit);
}

/** All state slots and props an expression reads, in first-read order, without duplicates. */
export function collectDependencies(expr: ExprIR): DependencyIR[] {
  const out: DependencyIR[] = [];
  const add = (d: DependencyIR): void => {
    if (!out.some((o) => o.kind === d.kind && (o.kind === "State" ? o.state === (d as typeof o).state : o.name === (d as typeof o).name))) out.push(d);
  };
  walkExpr(expr, (e) => {
    if (e.kind === "StateRead") add({ kind: "State", state: e.state });
    else if (e.kind === "PropRead") add({ kind: "Prop", name: e.name });
  });
  return out;
}

/** Only the state slots an expression reads (what a `useState` initial value may not touch). */
export function stateReads(expr: ExprIR): StateId[] {
  return collectDependencies(expr).flatMap((d) => (d.kind === "State" ? [d.state] : []));
}
