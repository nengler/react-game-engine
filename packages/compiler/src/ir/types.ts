/**
 * The compiler's Intermediate Representation.
 *
 * The IR is plain, JSON-serialisable data with no references to TypeScript AST
 * nodes. Every union is discriminated by `kind`; consumers should switch on it
 * and use `assertNever` so new variants are compile errors until handled.
 */

declare const stateIdBrand: unique symbol;
declare const elementIdBrand: unique symbol;

/** Identifies a persistent state slot within a component. */
export type StateId = string & { readonly [stateIdBrand]: true };
/** Stable structural identity of an element within a component (e.g. `Player/0/1`). */
export type ElementId = string & { readonly [elementIdBrand]: true };

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
  /** The root `<Entity>`: describes the component instance itself. */
  readonly root: HostElementIR;
}

// ---------------------------------------------------------------------------
// Hooks and state
// ---------------------------------------------------------------------------

/** Hook declarations. Future: useTransform, useRef, ... */
export type HookIR = UseStateHookIR | OnUpdateHookIR | OnCollisionEnterHookIR;

/** `onUpdate((dt) => { ... })`: runs once per `World.update(dt)` tick. */
export interface OnUpdateHookIR {
  readonly kind: "OnUpdate";
  /** Name the handler gave its delta-time parameter, or null if it takes none. */
  readonly deltaParam: string | null;
  readonly body: readonly StmtIR[];
  readonly span: SourceSpan;
}

/** `onCollisionEnter(() => { ... })`: runs when the World reports a new collision involving this object. */
export interface OnCollisionEnterHookIR {
  readonly kind: "OnCollisionEnter";
  readonly body: readonly StmtIR[];
  readonly span: SourceSpan;
}

// ---------------------------------------------------------------------------
// Statements (handler bodies)
// ---------------------------------------------------------------------------

/**
 * Statements are only valid inside handler bodies. State reads are live:
 * after a `SetState`, later reads in the same handler see the new value.
 */
export type StmtIR = SetStateStmtIR | IfStmtIR | LocalDeclStmtIR;

/** `setHealth(expr)` (or `setHealth(h => expr)`, lowered with `h` as a read of the state). */
export interface SetStateStmtIR {
  readonly kind: "SetState";
  readonly state: StateId;
  /** Name of the generated setter method to call. */
  readonly setterName: string;
  readonly value: ExprIR;
}

export interface IfStmtIR {
  readonly kind: "If";
  readonly test: ExprIR;
  readonly then: readonly StmtIR[];
  /** Empty when there is no `else`. */
  readonly else: readonly StmtIR[];
}

/** `const name = expr;` scoped to the enclosing block. */
export interface LocalDeclStmtIR {
  readonly kind: "LocalDecl";
  readonly name: string;
  readonly value: ExprIR;
}

export interface UseStateHookIR {
  readonly kind: "UseState";
  readonly state: StateId;
  /** Name of the generated setter method, or null if the setter was not bound. */
  readonly setterName: string | null;
  readonly span: SourceSpan;
}

/** Value types the compiler can currently infer for state. */
export type ValueType = "number" | "string" | "boolean";

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
export type ComponentRef = IntrinsicComponentRef | LocalComponentRef;

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

/** A handler parameter or a `const` local declared in a handler body. */
export interface LocalReadIR {
  readonly kind: "LocalRead";
  readonly name: string;
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

/** All state slots an expression reads, in first-read order, without duplicates. */
export function collectDependencies(expr: ExprIR): StateId[] {
  const out: StateId[] = [];
  const visit = (e: ExprIR): void => {
    switch (e.kind) {
      case "NumberLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
      case "LocalRead":
        return;
      case "StateRead":
        if (!out.includes(e.state)) out.push(e.state);
        return;
      case "Unary":
        visit(e.operand);
        return;
      case "Binary":
        visit(e.left);
        visit(e.right);
        return;
      case "Conditional":
        visit(e.test);
        visit(e.whenTrue);
        visit(e.whenFalse);
        return;
      default:
        assertNever(e, "expression");
    }
  };
  visit(expr);
  return out;
}
