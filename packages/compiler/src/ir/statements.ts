// The IR of statements: assignments, state setters, sounds, control flow and actions.
import { type StateId, type LocalId, type RefId, type SoundId } from "./ids.ts";
import { type FunctionIR, type TypeIR } from "./values.ts";
import { type ExprIR } from "./expressions.ts";



/**
 * Statements are only valid inside functions. State reads are live: after a
 * `SetState`, later reads in the same function see the new value.
 */
export type StatementIR =
  | ExpressionStatementIR
  | LocalConstStmtIR
  | IfStmtIR
  | ForOfStmtIR
  | WhileStmtIR
  | ForStmtIR
  | TryStmtIR
  | ThrowStmtIR
  | SwitchStmtIR
  | BlockStmtIR
  | LoopJumpStmtIR
  | ReturnStmtIR
  | SetStateStmtIR
  | AssignStmtIR
  | PlaySoundStmtIR
  | CallActionStmtIR;

/**
 * `for (const enemy of enemies) { … }`: the body once per item of an array (or of `entries()`, `keys()`, `values()`), in order.
 * The item is bound by `const`, as a name or destructured, in the body's scope.
 */
export interface ForOfStmtIR {
  readonly kind: "ForOf";
  readonly binding: LoopBindingIR;
  readonly iterable: ExprIR;
  readonly body: readonly StatementIR[];
}

/** `while (test) { … }`, or with `doWhile`, `do { … } while (test);`. */
export interface WhileStmtIR {
  readonly kind: "While";
  readonly test: ExprIR;
  readonly body: readonly StatementIR[];
  readonly doWhile: boolean;
}

/**
 * `for (let i = 0; i < n; i++) { … }`: `init` is `let` locals (or assignments to locals and refs) in the loop's own scope, `test`
 * may be left out, and `update` is assignments (`i++` is `i += 1`), written as a comma list.
 */
export interface ForStmtIR {
  readonly kind: "For";
  readonly init: readonly (LocalConstStmtIR | AssignStmtIR)[];
  readonly test: ExprIR | null;
  readonly update: readonly AssignStmtIR[];
  readonly body: readonly StatementIR[];
}

/** `try { … } catch (e) { … } finally { … }`: `e` is a `const` local of the catch block (it may be left out: `catch { … }`). */
export interface TryStmtIR {
  readonly kind: "Try";
  readonly block: readonly StatementIR[];
  readonly handler: { readonly binding: { readonly local: LocalId; readonly name: string } | null; readonly body: readonly StatementIR[] } | null;
  readonly finalizer: readonly StatementIR[] | null;
}

/** `throw new Error("…");` */
export interface ThrowStmtIR {
  readonly kind: "Throw";
  readonly value: ExprIR;
}

/**
 * How a `for…of` binds each item: a name, `[index, item]` (a hole is null), or `{ id, hp: health }`, nested as deep as written
 * (`[i, { id }]`). Each name is a `const` local.
 */
export type LoopBindingIR =
  | { readonly kind: "Name"; readonly local: LocalId; readonly name: string }
  | { readonly kind: "Array"; readonly elements: readonly (LoopBindingIR | null)[] }
  | { readonly kind: "Object"; readonly entries: readonly { readonly key: string; readonly value: LoopBindingIR }[] };

/** `{ … }`: statements in a scope of their own. */
export interface BlockStmtIR {
  readonly kind: "Block";
  readonly body: readonly StatementIR[];
}

/**
 * `switch (kind) { case "a": …; break; default: … }`, written as it is: cases fall through as in JS. The cases share one scope,
 * as in JS. `break` leaves the switch; `continue` belongs to an enclosing loop.
 */
export interface SwitchStmtIR {
  readonly kind: "Switch";
  readonly discriminant: ExprIR;
  /** In source order; `test` is null for `default`. */
  readonly cases: readonly { readonly test: ExprIR | null; readonly body: readonly StatementIR[] }[];
}

/** `break;` (in a loop or a `switch`) or `continue;` (in a loop), of the same function. */
export interface LoopJumpStmtIR {
  readonly kind: "Break" | "Continue";
}

/**
 * `collect(5)`, where `collect` is a game-state action bound with `const collect = useGame((s) => s.collect)`. It runs
 * the action in the game's store at once, which marks every component that reads what it changed.
 */
export interface CallActionStmtIR {
  readonly kind: "CallAction";
  readonly action: string;
  readonly args: readonly ExprIR[];
}

/** `playHit()`, where `playHit` is a `useSound` binding. A play is an effect, not state: it happens at once and renders nothing. */
export interface PlaySoundStmtIR {
  readonly kind: "PlaySound";
  readonly sound: SoundId;
  /** `playHit(0.5)`: the volume, 0 to 1; null plays at full volume. */
  readonly volume: ExprIR | null;
}

export type AssignOperator = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "||=" | "&&=" | "??=";

/** Where an assignment writes. Not reactive: no write marks anything dirty. */
export type AssignTargetIR = RefCurrentTargetIR | LocalTargetIR | PathTargetIR;

/** `best.hits = 0`, `grid[y]![x] = 1`: a member or element of a value the handler made (its own local). */
export interface PathTargetIR {
  readonly kind: "Path";
  readonly target: ExprIR;
}

/** A `let` local of the enclosing function: `best = enemy`, `total += e.hp`. */
export interface LocalTargetIR {
  readonly kind: "Local";
  readonly local: LocalId;
  readonly name: string;
}

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

/** `const name = expr;` (or `let`, with `mutable`) scoped to the enclosing block. */
export interface LocalConstStmtIR {
  readonly kind: "LocalConst";
  readonly id: LocalId;
  readonly name: string;
  readonly value: ExprIR;
  /** `let`: an assignment may change it later in the function. Absent for `const`. */
  readonly mutable?: true;
  /** `let best: Enemy | null = null`: the annotation, written into the generated code. Absent when TypeScript infers it. */
  readonly type?: TypeIR;
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

/**
 * `setX(value)` or `setX(prev => ...)`. Emitted as a call to the generated setter, except an updater of one expression in a
 * hook, which is written out as what the setter would do with it (see `HandlerEmitter.updaterInPlace`).
 */
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
