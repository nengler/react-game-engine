import { NodeFlags, SyntaxKind, type ArrowFunction, type BinaryExpression, type Expression, type Node, type Statement } from "typescript/ast";
import {
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isIdentifier,
  isIfStatement,
  isReturnStatement,
  isVariableStatement,
} from "typescript/ast/is";
import { unwrapParens } from "../analyzer/analyzer.ts";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import {
  localId,
  type AssignOperator,
  type AssignTargetIR,
  type ExprIR,
  type FunctionIR,
  type LocalId,
  type ParamIR,
  type StateId,
  type StatementIR,
  type TypeIR,
} from "../ir/types.ts";
import { Scope } from "./scope.ts";

/** What function lowering needs from the component lowering that owns it. */
export interface LoweringContext {
  readonly componentName: string;
  /** Innermost scope; expression lowering resolves identifiers against it. */
  scope: Scope;
  lowerExpression(node: Expression): ExprIR | null;
  /** Resolves `r.current.prop`; reports its own diagnostic and returns null if `node` is not a valid assignment target. */
  lowerAssignTarget(node: Expression): AssignTargetIR | null;
  stateType(state: StateId): TypeIR;
  /** False in a `useUnmount` handler: the component is going away, so a state update could never render. */
  canSetState(): boolean;
  nextSerial(): number;
  /** Names handler code may never rebind, because the call allowlist refers to them (`Math`, runtime functions). */
  isCallableName(name: string): boolean;
  error(code: (typeof DiagnosticCode)[keyof typeof DiagnosticCode], message: string, node: Node): void;
}

export interface FunctionOptions {
  /**
   * Types of the parameters the caller will pass; the function may declare a
   * prefix of them. `"contextual"`: any number of parameters, none annotated
   * (a callback passed to a child, typed by the child's props type).
   */
  readonly paramTypes: readonly TypeIR[] | "contextual";
  /** `void`: handlers (`return;` only). `value`: updaters (`return expr;` required). */
  readonly returns: "void" | "value";
  /** What to call the function in diagnostics. */
  readonly what: string;
}


export function lowerFunction(ctx: LoweringContext, fn: ArrowFunction, options: FunctionOptions): FunctionIR | null {
  const outer = ctx.scope;
  const scope = new Scope(outer);
  ctx.scope = scope;
  try {
    const params: ParamIR[] = [];
    if (options.paramTypes !== "contextual" && fn.parameters.length > options.paramTypes.length) {
      ctx.error(DiagnosticCode.InvalidHandler, `${options.what} takes at most ${options.paramTypes.length} parameter(s).`, fn.parameters[options.paramTypes.length]!);
      return null;
    }
    for (const [index, param] of fn.parameters.entries()) {
      if (!isIdentifier(param.name) || param.initializer || param.dotDotDotToken) {
        ctx.error(DiagnosticCode.InvalidHandler, `${options.what} parameters must be plain identifiers.`, param);
        return null;
      }
      const name = param.name.text;
      if (!checkFreshName(ctx, name, param)) return null;
      const id = localId(ctx.componentName, name, ctx.nextSerial());
      const type: TypeIR = options.paramTypes === "contextual" ? { kind: "Contextual" } : options.paramTypes[index]!;
      scope.declare(name, { kind: "param", id, name, type });
      params.push({ id, name, type });
    }

    let body: StatementIR[] | null;
    if (isBlock(fn.body)) {
      // The body's top-level block shares the parameters' scope, as in JS: `(n) => { const n = 1; }` is a redeclaration.
      body = lowerStatements(ctx, fn.body.statements, options, false);
    } else if (options.returns === "value") {
      const value = ctx.lowerExpression(fn.body);
      body = value && [{ kind: "Return", value }];
    } else {
      const stmt = lowerExpressionStatement(ctx, fn.body, fn.body);
      body = stmt && [stmt];
    }
    return body && { kind: "Function", params, body };
  } finally {
    ctx.scope = outer;
  }
}

/** Lowers statements in a fresh block scope, so `const`s declared inside do not leak out. */
function lowerStatements(ctx: LoweringContext, statements: readonly Statement[], options: FunctionOptions, newScope = true): StatementIR[] | null {
  const outer = ctx.scope;
  if (newScope) ctx.scope = new Scope(outer);
  try {
    const out: StatementIR[] = [];
    let ok = true;
    for (const statement of statements) {
      const lowered = lowerStatement(ctx, statement, options);
      if (lowered) out.push(lowered);
      else ok = false;
    }
    return ok ? out : null;
  } finally {
    ctx.scope = outer;
  }
}

function lowerStatement(ctx: LoweringContext, statement: Statement, options: FunctionOptions): StatementIR | null {
  if (isExpressionStatement(statement)) return lowerExpressionStatement(ctx, statement.expression, statement);

  if (isIfStatement(statement)) {
    const test = ctx.lowerExpression(statement.expression);
    const branch = (s: Statement) => lowerStatements(ctx, isBlock(s) ? s.statements : [s], options);
    const thenBranch = branch(statement.thenStatement);
    const elseBranch = statement.elseStatement ? branch(statement.elseStatement) : [];
    return test && thenBranch && elseBranch && { kind: "If", test, then: thenBranch, else: elseBranch };
  }

  if (isReturnStatement(statement)) {
    if (options.returns === "void") {
      if (statement.expression) {
        ctx.error(DiagnosticCode.InvalidHandler, `${options.what} cannot return a value.`, statement);
        return null;
      }
      return { kind: "Return", value: null };
    }
    if (!statement.expression) {
      ctx.error(DiagnosticCode.InvalidHandler, `${options.what} must return the next value.`, statement);
      return null;
    }
    const value = ctx.lowerExpression(statement.expression);
    return value && { kind: "Return", value };
  }

  if (isVariableStatement(statement)) {
    const list = statement.declarationList;
    const decl = list.declarations[0]!;
    if ((list.flags & NodeFlags.Const) === 0 || list.declarations.length !== 1 || !isIdentifier(decl.name) || !decl.initializer) {
      ctx.error(DiagnosticCode.UnsupportedStatement, "Only `const name = expression;` declarations are supported in handlers.", statement);
      return null;
    }
    const value = ctx.lowerExpression(decl.initializer); // lowered before the name exists: no self-reference
    const name = decl.name.text;
    if (!value || !checkFreshName(ctx, name, decl.name)) return null;
    const id = localId(ctx.componentName, name, ctx.nextSerial());
    ctx.scope.declare(name, { kind: "local", id, name });
    return { kind: "LocalConst", id, name, value };
  }

  ctx.error(
    DiagnosticCode.UnsupportedStatement,
    `Unsupported statement in handler (${SyntaxKind[statement.kind]}). Supported: state setter calls, ref property assignments, allowlisted calls, \`if\`/\`else\`, \`const\` and \`return\`.`,
    statement,
  );
  return null;
}

const ASSIGN_OPERATORS: ReadonlyMap<SyntaxKind, AssignOperator> = new Map([
  [SyntaxKind.EqualsToken, "="], [SyntaxKind.PlusEqualsToken, "+="], [SyntaxKind.MinusEqualsToken, "-="],
  [SyntaxKind.AsteriskEqualsToken, "*="], [SyntaxKind.SlashEqualsToken, "/="],
] as const);

/** Every assignment-shaped operator, so unsupported ones (`||=`, `%=`) get a precise diagnostic. */
const ASSIGNMENT_TOKENS: ReadonlySet<SyntaxKind> = new Set([
  ...ASSIGN_OPERATORS.keys(),
  SyntaxKind.PercentEqualsToken, SyntaxKind.AsteriskAsteriskEqualsToken, SyntaxKind.BarBarEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.QuestionQuestionEqualsToken,
]);

/** `target = value` / `target += value` (ref properties). */
function lowerAssignment(ctx: LoweringContext, expression: BinaryExpression): StatementIR | null {
  const operator = ASSIGN_OPERATORS.get(expression.operatorToken.kind);
  if (!operator) {
    ctx.error(DiagnosticCode.UnsupportedStatement, "Supported assignment operators: =, +=, -=, *=, /=.", expression.operatorToken);
    return null;
  }
  const target = ctx.lowerAssignTarget(unwrapParens(expression.left));
  const value = ctx.lowerExpression(expression.right);
  return target && value && { kind: "Assign", target, operator, value };
}

/** `setX(value)`, `setX(prev => ...)`, an assignment, or an allowlisted call. */
function lowerExpressionStatement(ctx: LoweringContext, expression: Expression, at: Node): StatementIR | null {
  const call = unwrapParens(expression);
  if (isBinaryExpression(call) && ASSIGNMENT_TOKENS.has(call.operatorToken.kind)) return lowerAssignment(ctx, call);
  if (isCallExpression(call) && isIdentifier(call.expression)) {
    const callee = ctx.scope.get(call.expression.text);
    if (callee?.kind === "sound") {
      if (call.arguments.length !== 0) {
        ctx.error(DiagnosticCode.SoundOutsideHandler, `\`${callee.name}\` takes no arguments: the sound and its path are fixed where it is declared.`, call);
        return null;
      }
      return { kind: "PlaySound", sound: callee.id };
    }
    if (callee?.kind === "setter") {
      if (!ctx.canSetState()) {
        ctx.error(
          DiagnosticCode.UnsupportedStatement,
          `\`${call.expression.text}\` cannot be called in \`useUnmount\`: the component is going away, so the update could never render. Tell the parent with a callback prop (\`onGone?.()\`), or write a ref.`,
          call,
        );
        return null;
      }
      return lowerSetState(ctx, call.arguments, callee.state, call);
    }
  }
  const lowered = ctx.lowerExpression(call);
  if (!lowered) return null;
  if (lowered.kind !== "Call") {
    ctx.error(DiagnosticCode.UnsupportedStatement, "Expression statements must be a state setter call, an assignment to a ref property, or an allowlisted call.", at);
    return null;
  }
  return { kind: "ExpressionStatement", expression: lowered };
}

function lowerSetState(ctx: LoweringContext, args: readonly Expression[], state: StateId, at: Node): StatementIR | null {
  if (args.length !== 1) {
    ctx.error(DiagnosticCode.UnsupportedStatement, "State setters take exactly one argument.", at);
    return null;
  }
  const arg = unwrapParens(args[0]!);
  if (isArrowFunction(arg)) {
    const type = ctx.stateType(state);
    const updater = lowerFunction(ctx, arg, { paramTypes: [type], returns: "value", what: "State updater" });
    return updater && { kind: "SetState", state, updater };
  }
  const value = ctx.lowerExpression(arg);
  return value && { kind: "SetState", state, value };
}

/**
 * Shadowing follows JS: a parameter or `const` may reuse an outer name, which
 * is what makes `setCount((count) => count + 1)` work (state is emitted as
 * `this.count`, so the generated code cannot confuse them). Only a
 * redeclaration in the same scope, rebinding a name the call allowlist
 * relies on (`Math`, runtime functions), or a `$` name (generated code's
 * temporaries), is an error.
 */
export function checkFreshName(ctx: LoweringContext, name: string, at: Node): boolean {
  if (name.startsWith("$")) {
    ctx.error(DiagnosticCode.InvalidHandler, `'${name}': names starting with \`$\` are reserved for generated code.`, at);
    return false;
  }
  if (ctx.scope.hasOwn(name)) {
    ctx.error(DiagnosticCode.InvalidHandler, `'${name}' is already declared in this scope.`, at);
    return false;
  }
  if (ctx.isCallableName(name)) {
    ctx.error(DiagnosticCode.InvalidHandler, `'${name}' is reserved for allowlisted calls and cannot be rebound.`, at);
    return false;
  }
  return true;
}

export type { LocalId };
