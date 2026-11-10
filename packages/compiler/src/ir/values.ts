// The IR of value types, parameters and functions.
import { type LocalId } from "./ids.ts";
import { type StatementIR } from "./statements.ts";



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
