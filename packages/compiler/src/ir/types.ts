/**
 * The compiler's Intermediate Representation.
 *
 * The IR is plain, JSON-serialisable data with no references to TypeScript AST
 * nodes. Every union is discriminated by `kind`; consumers should switch on it
 * and use `assertNever` so new variants are compile errors until handled.
 */

export * from "./ids.ts";
export * from "./declarations.ts";
export * from "./values.ts";
export * from "./statements.ts";
export * from "./elements.ts";
export * from "./expressions.ts";
export * from "./walk.ts";
