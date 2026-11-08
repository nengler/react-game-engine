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
declare const transformIdBrand: unique symbol;
declare const refIdBrand: unique symbol;

/** Identifies a persistent state slot within a component. */
export type StateId = string & { readonly [stateIdBrand]: true };
/** Stable structural identity of an element within a component (e.g. `Player/0/1`). */
export type ElementId = string & { readonly [elementIdBrand]: true };

/** Identifies a parameter or `const` local inside one function body. */
export type LocalId = string & { readonly [localIdBrand]: true };

/** Identifies a component's `useTransform` slot. */
export type TransformId = string & { readonly [transformIdBrand]: true };
/** Identifies a `useRef` handle within a component. */
export type RefId = string & { readonly [refIdBrand]: true };

export function transformId(component: string, name: string): TransformId {
  return `${component}.${name}` as TransformId;
}

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
  readonly components: readonly ComponentIR[];
}

export interface ComponentIR {
  readonly kind: "Component";
  readonly name: string;
  readonly span: SourceSpan;
  /** Hook declarations, in source order. */
  readonly hooks: readonly HookIR[];
  /** Persistent storage slots created by hooks. */
  readonly state: readonly StateIR[];
  /** `useRef` handles, each resolved to the element it is attached to. */
  readonly refs: readonly RefIR[];
  /** The root `<Entity>`: describes the component instance itself. */
  readonly root: HostElementIR;
}

// ---------------------------------------------------------------------------
// Hooks and state
// ---------------------------------------------------------------------------

/** Hook declarations. (`useRef` is not a hook entry: its handle is a `RefIR` in `ComponentIR.refs`.) */
export type HookIR = UseStateHookIR | UseTransformHookIR | OnUpdateHookIR | OnInputHookIR | OnCollisionEnterHookIR;

/** The fields of a transform, which live on the runtime `Entity.transform`. */
export const TRANSFORM_FIELDS = ["x", "y", "rotation", "scaleX", "scaleY"] as const;
export type TransformField = (typeof TRANSFORM_FIELDS)[number];

/**
 * `const t = useTransform({ x: 0, y: 0 })`: binds the component's own
 * `this.transform`. Not reactive: writes never mark the object dirty.
 */
export interface UseTransformHookIR {
  readonly kind: "UseTransform";
  readonly slot: TransformId;
  /** The name the source binds it to. */
  readonly name: string;
  /** Fields not listed keep the runtime defaults (0, 0, 0, 1, 1). */
  readonly initial: Readonly<Partial<Record<TransformField, number>>>;
  readonly span: SourceSpan;
}

/** `const r = useRef<Sprite>()` attached with `ref={r}`. The element's field takes the ref's name. */
export interface RefIR {
  readonly kind: "Ref";
  readonly id: RefId;
  /** Also the generated field name of the target element. */
  readonly name: string;
  /** The tag the ref was declared for (`Sprite`). */
  readonly componentName: string;
  readonly target: ElementId;
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

/** `onCollisionEnter((other) => { ... })`: runs when the World reports a new collision involving this component. */
export interface OnCollisionEnterHookIR {
  readonly kind: "OnCollisionEnter";
  readonly handler: FunctionIR;
  readonly span: SourceSpan;
}

export type HandlerHookIR = OnUpdateHookIR | OnInputHookIR | OnCollisionEnterHookIR;

export function isHandlerHook(hook: HookIR): hook is HandlerHookIR {
  return hook.kind === "OnUpdate" || hook.kind === "OnInput" || hook.kind === "OnCollisionEnter";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Value types the compiler can currently infer for state. */
export type ValueType = "number" | "string" | "boolean";

/** The types the IR can name. `ValueType` is the subset usable for state. */
export type TypeIR = PrimitiveTypeIR | NamedTypeIR;

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

/** Where an assignment writes. Neither target is reactive: no write marks anything dirty. */
export type AssignTargetIR = TransformFieldTargetIR | RefPropertyTargetIR;

/** `t.x`, where `t` is the component's `useTransform` binding. */
export interface TransformFieldTargetIR {
  readonly kind: "TransformField";
  readonly slot: TransformId;
  readonly field: TransformField;
}

/** `r.current.image`, where `r` is a `useRef` handle to an intrinsic element. */
export interface RefPropertyTargetIR {
  readonly kind: "RefProperty";
  readonly ref: RefId;
  readonly property: string;
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
  readonly type: ValueType;
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
}

/** The component's root element; it *is* the instance, so it has no field. */
export interface HostElementIR {
  readonly kind: "HostElement";
  readonly component: IntrinsicComponentRef;
  readonly props: readonly PropIR[];
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
  readonly dependencies: readonly StateId[];
  readonly element: ElementIR;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Future: EventHandlerProp (onInput, callbacks between components). */
export type PropIR = StaticPropIR | DynamicPropIR;

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
  readonly dependencies: readonly StateId[];
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
  | TransformReadIR
  | RefReadIR
  | RefPropertyReadIR
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

/** `t.x`: reads the live transform field. Only valid inside handlers (a JSX read would never update). */
export interface TransformReadIR {
  readonly kind: "TransformRead";
  readonly slot: TransformId;
  readonly field: TransformField;
}

/** `r.current`: the ref's element, `null` while a conditional element is unmounted. Only valid inside handlers. */
export interface RefReadIR {
  readonly kind: "RefRead";
  readonly ref: RefId;
}

/** `r.current.image`: a property of the ref's element. The element must be non-null (the type-check enforces this). */
export interface RefPropertyReadIR {
  readonly kind: "RefPropertyRead";
  readonly ref: RefId;
  readonly property: string;
}

/** A call to a fixed allowlist (`Math.*`, `clamp`) or a method of a runtime handle parameter. */
export interface CallIR {
  readonly kind: "Call";
  readonly callee: CalleeIR;
  readonly args: readonly ExprIR[];
}

export type CalleeIR =
  | { readonly kind: "Function"; readonly name: string }
  | { readonly kind: "Method"; readonly receiver: ParamReadIR; readonly name: string };

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
    case "TransformRead":
    case "RefRead":
    case "RefPropertyRead":
      return [];
    case "PropertyRead":
      return [e.object];
    case "Call":
      return e.callee.kind === "Method" ? [e.callee.receiver, ...e.args] : e.args;
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

/** All state slots an expression reads, in first-read order, without duplicates. */
export function collectDependencies(expr: ExprIR): StateId[] {
  const out: StateId[] = [];
  walkExpr(expr, (e) => {
    if (e.kind === "StateRead" && !out.includes(e.state)) out.push(e.state);
  });
  return out;
}
