import { NodeFlags, SyntaxKind, type ArrowFunction, type Expression, type Node, type Statement } from "typescript/ast";
import {
  isArrowFunction,
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
  type ExprIR,
  type FunctionIR,
  type LocalId,
  type ParamIR,
  type StateId,
  type StatementIR,
  type TypeIR,
  type ValueType,
} from "../ir/types.ts";
import { Scope } from "./scope.ts";

/** What function lowering needs from the component lowering that owns it. */
export interface LoweringContext {
  readonly componentName: string;
  /** Innermost scope; expression lowering resolves identifiers against it. */
  scope: Scope;
  lowerExpression(node: Expression): ExprIR | null;
  stateType(state: StateId): ValueType;
  nextSerial(): number;
  error(code: (typeof DiagnosticCode)[keyof typeof DiagnosticCode], message: string, node: Node): void;
}

export interface FunctionOptions {
  /** Types of the parameters the caller will pass; the function may declare a prefix of them. */
  readonly paramTypes: readonly TypeIR[];
  /** `void`: handlers (`return;` only). `value`: updaters (`return expr;` required). */
  readonly returns: "void" | "value";
  /** What to call the function in diagnostics. */
  readonly what: string;
}

/** Names handler code may never rebind, because the call allowlist refers to them. */
const RESERVED_LOCALS = new Set(["Math", "clamp"]);

export function lowerFunction(ctx: LoweringContext, fn: ArrowFunction, options: FunctionOptions): FunctionIR | null {
  const outer = ctx.scope;
  const scope = new Scope(outer);
  ctx.scope = scope;
  try {
    const params: ParamIR[] = [];
    if (fn.parameters.length > options.paramTypes.length) {
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
      const type = options.paramTypes[index]!;
      scope.declare(name, { kind: "param", id, name, type });
      params.push({ id, name, type });
    }

    let body: StatementIR[] | null;
    if (isBlock(fn.body)) {
      body = lowerStatements(ctx, fn.body.statements, options);
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
function lowerStatements(ctx: LoweringContext, statements: readonly Statement[], options: FunctionOptions): StatementIR[] | null {
  const outer = ctx.scope;
  ctx.scope = new Scope(outer);
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
    `Unsupported statement in handler (${SyntaxKind[statement.kind]}). Supported: state setter calls, allowlisted calls, \`if\`/\`else\`, \`const\` and \`return\`.`,
    statement,
  );
  return null;
}

/** `setX(value)`, `setX(prev => ...)`, or an allowlisted call. */
function lowerExpressionStatement(ctx: LoweringContext, expression: Expression, at: Node): StatementIR | null {
  const call = unwrapParens(expression);
  if (isCallExpression(call) && isIdentifier(call.expression)) {
    const callee = ctx.scope.get(call.expression.text);
    if (callee?.kind === "setter") return lowerSetState(ctx, call.arguments, callee.state, call);
  }
  const lowered = ctx.lowerExpression(call);
  if (!lowered) return null;
  if (lowered.kind !== "Call") {
    ctx.error(DiagnosticCode.UnsupportedStatement, "Expression statements must be a state setter call or an allowlisted call.", at);
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
    const type: TypeIR = { kind: "Primitive", name: ctx.stateType(state) };
    const updater = lowerFunction(ctx, arg, { paramTypes: [type], returns: "value", what: "State updater" });
    return updater && { kind: "SetState", state, updater };
  }
  const value = ctx.lowerExpression(arg);
  return value && { kind: "SetState", state, value };
}

function checkFreshName(ctx: LoweringContext, name: string, at: Node): boolean {
  if (ctx.scope.has(name) || RESERVED_LOCALS.has(name)) {
    ctx.error(DiagnosticCode.InvalidHandler, `'${name}' is already declared in this component (or reserved); shadowing is not allowed.`, at);
    return false;
  }
  return true;
}

export type { LocalId };
