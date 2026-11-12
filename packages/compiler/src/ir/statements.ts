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
  | LoopJumpStmtIR
  | ReturnStmtIR
  | SetStateStmtIR
  | AssignStmtIR
  | PlaySoundStmtIR
  | CallActionStmtIR;

/**
 * `for (const enemy of enemies) { … }`: the body once per item of an array, in order. The item is a `const` local of the
 * body's scope. Bounded by the array, so a handler cannot loop forever (there is no `while`).
 */
export interface ForOfStmtIR {
  readonly kind: "ForOf";
  readonly item: LocalId;
  readonly name: string;
  readonly iterable: ExprIR;
  readonly body: readonly StatementIR[];
}

/** `break;` or `continue;`, only inside a `for…of` of the same function. */
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
export type AssignTargetIR = RefCurrentTargetIR | LocalTargetIR;

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
