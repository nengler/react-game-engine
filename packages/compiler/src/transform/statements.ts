import { NodeFlags, SyntaxKind, type ArrowFunction, type BinaryExpression, type Expression, type Node, type Statement } from "typescript/ast";
import {
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isArrayBindingPattern,
  isBreakStatement,
  isObjectBindingPattern,
  isOmittedExpression,
  isCaseClause,
  isSwitchStatement,
  isContinueStatement,
  isExpressionStatement,
  isForOfStatement,
  isIdentifier,
  isIfStatement,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isVariableDeclarationList,
  isVariableStatement,
} from "typescript/ast/is";
import { unwrapParens } from "../analyzer/analyzer.ts";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import {
  localId,
  type AssignOperator,
  type AssignTargetIR,
  type LoopBindingIR,
  type ExprIR,
  type FunctionIR,
  type ParamIR,
  type StateId,
  type StatementIR,
  type TypeIR,
} from "../ir/types.ts";
import { type Scope } from "./scope.ts";

/** What function lowering needs from the component lowering that owns it. */
export interface LoweringContext {
  readonly componentName: string;
  /** Innermost scope; expression lowering resolves identifiers against it. */
  scope: Scope;
  lowerExpression(node: Expression): ExprIR | null;
  /** Lowers each expression in order; null at the first that fails. */
  lowerAll(nodes: readonly Expression[]): ExprIR[] | null;
  /** Resolves `r.current.prop`; reports its own diagnostic and returns null if `node` is not a valid assignment target. */
  lowerAssignTarget(node: Expression): AssignTargetIR | null;
  stateType(state: StateId): TypeIR;
  /** False in a `useUnmount` handler: the component is going away, so a state update could never render. */
  canSetState(): boolean;
  /** False in a state updater: it runs inside the setter, whether or not the update changes anything. */
  canPlaySound(): boolean;
  /** Lowers a state updater: sounds cannot be played in it. */
  inUpdater<T>(lower: () => T): T;
  /** Lowers something in a new scope beneath the current one, restored afterwards. */
  inScope<T>(lower: (scope: Scope) => T): T;
  nextSerial(): number;
  /** A type annotation (`let best: Enemy | null`): primitives and arrays understood, anything else kept as source text. */
  typeFromNode(node: Node): TypeIR;
  /** Names handler code may never rebind, because the call allowlist refers to them (`Math`, runtime functions). */
  isCallableName(name: string): boolean;
  error(code: (typeof DiagnosticCode)[keyof typeof DiagnosticCode], message: string, node: Node): void;
}

interface FunctionOptions {
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
  return ctx.inScope((scope) => {
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
      body = lowerStatements(ctx, fn.body.statements, options, { newScope: false, jumps: NO_JUMPS });
    } else if (options.returns === "value") {
      const value = ctx.lowerExpression(fn.body);
      body = value && [{ kind: "Return", value }];
    } else {
      const stmt = lowerExpressionStatement(ctx, fn.body, fn.body);
      body = stmt && [stmt];
    }
    return body && { kind: "Function", params, body };
  });
}

/** Which jumps the statements may make: `break` in a `for…of` or a `switch`, `continue` in a `for…of`, of the same function. */
interface Jumps {
  readonly break: boolean;
  readonly continue: boolean;
}

const NO_JUMPS: Jumps = { break: false, continue: false };

/** Where statements are lowered: in a block scope of their own (`const`s declared inside do not leak out), and what they may jump out of. */
interface BlockOptions {
  readonly newScope: boolean;
  readonly jumps: Jumps;
}

function lowerStatements(ctx: LoweringContext, statements: readonly Statement[], options: FunctionOptions, block: BlockOptions): StatementIR[] | null {
  const lower = (): StatementIR[] | null => {
    const out: StatementIR[] = [];
    let ok = true;
    for (const statement of statements) {
      const lowered = lowerStatement(ctx, statement, options, block.jumps);
      if (lowered) out.push(lowered);
      else ok = false;
    }
    return ok ? out : null;
  };
  return block.newScope ? ctx.inScope(lower) : lower();
}

function lowerStatement(ctx: LoweringContext, statement: Statement, options: FunctionOptions, jumps: Jumps): StatementIR | null {
  if (isExpressionStatement(statement)) return lowerExpressionStatement(ctx, statement.expression, statement);

  if (isIfStatement(statement)) {
    const test = ctx.lowerExpression(statement.expression);
    const branch = (s: Statement) => lowerStatements(ctx, isBlock(s) ? s.statements : [s], options, { newScope: true, jumps });
    const thenBranch = branch(statement.thenStatement);
    const elseBranch = statement.elseStatement ? branch(statement.elseStatement) : [];
    return test && thenBranch && elseBranch && { kind: "If", test, then: thenBranch, else: elseBranch };
  }

  if (isForOfStatement(statement)) return lowerForOf(ctx, statement, options);

  if (isBlock(statement)) {
    const body = lowerStatements(ctx, statement.statements, options, { newScope: true, jumps });
    return body && { kind: "Block", body };
  }

  if (isSwitchStatement(statement)) return lowerSwitch(ctx, statement, options, jumps);

  if (isBreakStatement(statement) || isContinueStatement(statement)) {
    const isBreak = isBreakStatement(statement);
    const word = isBreak ? "break" : "continue";
    if (statement.label) {
      ctx.error(DiagnosticCode.UnsupportedStatement, `Labelled \`${word}\` is not supported: it leaves the innermost ${isBreak ? "`for…of` or `switch`" : "`for…of`"}.`, statement);
      return null;
    }
    if (!(isBreak ? jumps.break : jumps.continue)) {
      ctx.error(DiagnosticCode.UnsupportedStatement, `\`${word}\` is only valid inside a ${isBreak ? "`for…of` loop or a `switch`" : "`for…of` loop"} of the same function.`, statement);
      return null;
    }
    return { kind: isBreak ? "Break" : "Continue" };
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
    const mutable = (list.flags & NodeFlags.Let) !== 0;
    const isConst = (list.flags & NodeFlags.Const) !== 0;
    if ((!isConst && !mutable) || list.declarations.length !== 1 || !isIdentifier(decl.name) || !decl.initializer) {
      ctx.error(DiagnosticCode.UnsupportedStatement, "Only `const name = expression;` and `let name = expression;` declarations (one name, with a value) are supported in handlers.", statement);
      return null;
    }
    // `const events = step(input, dt);`: a game-state action whose result the handler uses (only here, in a handler, where it
    // runs once; in JSX or a derived value it would run on every render).
    const init = unwrapParens(decl.initializer);
    const action = isCallExpression(init) && isIdentifier(init.expression) ? ctx.scope.get(init.expression.text) : undefined;
    let value: ExprIR | null;
    if (action?.kind === "action" && isCallExpression(init)) {
      if (!ctx.canPlaySound()) {
        ctx.error(DiagnosticCode.SoundOutsideHandler, `\`${action.name}()\` cannot be called in a state updater: it runs inside the setter and may run again. Call it in the handler.`, init);
        return null;
      }
      const args = ctx.lowerAll(init.arguments);
      if (!args) return null;
      value = { kind: "Call", callee: { kind: "Action", name: action.action }, args };
    } else value = ctx.lowerExpression(decl.initializer); // lowered before the name exists: no self-reference
    const name = decl.name.text;
    if (!value || !checkFreshName(ctx, name, decl.name)) return null;
    const id = localId(ctx.componentName, name, ctx.nextSerial());
    ctx.scope.declare(name, { kind: "local", id, name, mutable });
    const type = decl.type ? ctx.typeFromNode(decl.type) : undefined;
    return { kind: "LocalConst", id, name, value, ...(mutable ? { mutable: true as const } : {}), ...(type ? { type } : {}) };
  }

  ctx.error(
    DiagnosticCode.UnsupportedStatement,
    `Unsupported statement in handler (${SyntaxKind[statement.kind]}). Supported: state setter calls, assignments to \`ref.current\` and \`let\` locals, allowlisted calls, \`if\`/\`else\`, \`switch\`, \`for…of\` (with \`break\` and \`continue\`), \`const\`, \`let\` and \`return\`.`,
    statement,
  );
  return null;
}

/**
 * `for (const enemy of enemies) { … }`, `for (const [i, e] of enemies.entries())`, `for (const { id, hp } of enemies)`: the array is
 * lowered first (it cannot read the item), then the body in a scope where the item's names are `const`s, and `break` /
 * `continue` are allowed.
 */
function lowerForOf(ctx: LoweringContext, statement: Statement & { kind: SyntaxKind.ForOfStatement }, options: FunctionOptions): StatementIR | null {
  const loop = statement as unknown as { awaitModifier?: Node; initializer: Node; expression: Expression; statement: Statement };
  const shape = "A loop is written `for (const item of items) { … }` (or `const [i, item]`, `const { id, hp }`)";
  if (loop.awaitModifier) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}: no \`await\`.`, statement);
    return null;
  }
  const list = loop.initializer;
  const decl = isVariableDeclarationList(list) && list.declarations.length === 1 ? list.declarations[0]! : null;
  if (!decl || !isVariableDeclarationList(list) || (list.flags & NodeFlags.Const) === 0 || decl.type) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}: one \`const\`, without a type (the array gives it).`, list);
    return null;
  }
  const pattern = loopPattern(decl.name);
  if (pattern === null) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}: names and \`[…]\` / \`{…}\` patterns of them, no defaults or rests.`, decl.name);
    return null;
  }
  const iterable = ctx.lowerExpression(loop.expression);
  if (!iterable) return null;
  return ctx.inScope((scope) => {
    // Each name of the pattern, declared as a `const` of the body's scope.
    const bind = (pattern: LoopPattern): LoopBindingIR | null => {
      switch (pattern.kind) {
        case "name": {
          if (!checkFreshName(ctx, pattern.name, pattern.node)) return null;
          const local = localId(ctx.componentName, pattern.name, ctx.nextSerial());
          scope.declare(pattern.name, { kind: "local", id: local, name: pattern.name, mutable: false });
          return { kind: "Name", local, name: pattern.name };
        }
        case "array": {
          const elements: (LoopBindingIR | null)[] = [];
          for (const e of pattern.elements) {
            const bound = e === null ? null : bind(e);
            if (e !== null && bound === null) return null;
            elements.push(bound);
          }
          return { kind: "Array", elements };
        }
        case "object": {
          const entries: { key: string; value: LoopBindingIR }[] = [];
          for (const e of pattern.entries) {
            const value = bind(e.value);
            if (!value) return null;
            entries.push({ key: e.key, value });
          }
          return { kind: "Object", entries };
        }
      }
    };
    const binding = bind(pattern);
    if (!binding) return null;
    const body = lowerStatements(ctx, isBlock(loop.statement) ? loop.statement.statements : [loop.statement], options, { newScope: true, jumps: { break: true, continue: true } });
    return body && { kind: "ForOf", binding, iterable, body };
  });
}

type LoopPattern =
  | { readonly kind: "name"; readonly name: string; readonly node: Node }
  | { readonly kind: "array"; readonly elements: readonly (LoopPattern | null)[] }
  | { readonly kind: "object"; readonly entries: readonly { readonly key: string; readonly value: LoopPattern }[] };

/** A loop's binding: a name, or `[a, , b]` / `{ a, b: c }` of names and such patterns. Null for defaults, rests and computed keys. */
function loopPattern(name: Node): LoopPattern | null {
  if (isIdentifier(name)) return { kind: "name", name: name.text, node: name };
  if (isArrayBindingPattern(name)) {
    const elements: (LoopPattern | null)[] = [];
    for (const element of name.elements) {
      // A hole (`[, b]`): an omitted expression, or, as this parser gives it, an element with no name.
      if (isOmittedExpression(element) || (!element.dotDotDotToken && !element.initializer && !element.name)) {
        elements.push(null);
        continue;
      }
      if (element.dotDotDotToken || element.initializer || !element.name) return null;
      const inner = loopPattern(element.name);
      if (!inner) return null;
      elements.push(inner);
    }
    return elements.some((e) => e !== null) ? { kind: "array", elements } : null;
  }
  if (isObjectBindingPattern(name)) {
    const entries: { key: string; value: LoopPattern }[] = [];
    for (const element of name.elements) {
      if (element.dotDotDotToken || element.initializer || !element.name) return null;
      const key = element.propertyName === undefined ? (isIdentifier(element.name) ? element.name.text : null) : isIdentifier(element.propertyName) ? element.propertyName.text : null;
      const value = loopPattern(element.name);
      if (key === null || !value) return null;
      entries.push({ key, value });
    }
    return entries.length > 0 ? { kind: "object", entries } : null;
  }
  return null;
}

/**
 * `switch (x) { case a: …; break; default: … }`: written as it is, falling through as in JS. The cases share one scope (as in
 * JS); `break` leaves the switch, and `continue` still belongs to an enclosing loop.
 */
function lowerSwitch(ctx: LoweringContext, statement: Statement & { kind: SyntaxKind.SwitchStatement }, options: FunctionOptions, jumps: Jumps): StatementIR | null {
  const node = statement as unknown as { expression: Expression; caseBlock: { clauses: readonly Node[] } };
  const discriminant = ctx.lowerExpression(node.expression);
  return ctx.inScope(() => {
    const cases: { test: ExprIR | null; body: StatementIR[] }[] = [];
    let ok = discriminant !== null;
    for (const clause of node.caseBlock.clauses) {
      const isCase = isCaseClause(clause);
      const test = isCase ? ctx.lowerExpression(clause.expression) : null;
      const statements = (clause as unknown as { statements: readonly Statement[] }).statements;
      const body = lowerStatements(ctx, statements, options, { newScope: false, jumps: { break: true, continue: jumps.continue } });
      if ((isCase && !test) || !body) ok = false;
      else cases.push({ test, body });
    }
    return ok && discriminant ? { kind: "Switch", discriminant, cases } : null;
  });
}

const ASSIGN_OPERATORS: ReadonlyMap<SyntaxKind, AssignOperator> = new Map([
  [SyntaxKind.EqualsToken, "="], [SyntaxKind.PlusEqualsToken, "+="], [SyntaxKind.MinusEqualsToken, "-="],
  [SyntaxKind.AsteriskEqualsToken, "*="], [SyntaxKind.SlashEqualsToken, "/="], [SyntaxKind.PercentEqualsToken, "%="],
  [SyntaxKind.AsteriskAsteriskEqualsToken, "**="], [SyntaxKind.BarBarEqualsToken, "||="],
  [SyntaxKind.AmpersandAmpersandEqualsToken, "&&="], [SyntaxKind.QuestionQuestionEqualsToken, "??="],
] as const);

/** Every assignment-shaped operator, so unsupported ones (the bitwise and shift forms) get a precise diagnostic. */
const ASSIGNMENT_TOKENS: ReadonlySet<SyntaxKind> = new Set([
  ...ASSIGN_OPERATORS.keys(),
  SyntaxKind.AmpersandEqualsToken, SyntaxKind.BarEqualsToken, SyntaxKind.CaretEqualsToken, SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken, SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
]);

/** `target = value` / `target += value` (ref properties). */
function lowerAssignment(ctx: LoweringContext, expression: BinaryExpression): StatementIR | null {
  const operator = ASSIGN_OPERATORS.get(expression.operatorToken.kind);
  if (!operator) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `Supported assignment operators: ${[...ASSIGN_OPERATORS.values()].join(", ")}.`, expression.operatorToken);
    return null;
  }
  const target = ctx.lowerAssignTarget(unwrapParens(expression.left));
  const value = ctx.lowerExpression(expression.right);
  return target && value && { kind: "Assign", target, operator, value };
}

/**
 * `n++`, `--r.current`: as a statement, the same as `+= 1` / `-= 1` on a `let` local or a ref. (Anywhere else, `++` stays an
 * error: it would change state in place.)
 */
function lowerIncrement(ctx: LoweringContext, expression: Expression): StatementIR | null | undefined {
  if (!isPrefixUnaryExpression(expression) && !isPostfixUnaryExpression(expression)) return undefined;
  const operator = expression.operator === SyntaxKind.PlusPlusToken ? "+=" : expression.operator === SyntaxKind.MinusMinusToken ? "-=" : null;
  if (operator === null) return undefined;
  const operand = unwrapParens(expression.operand);
  // Only a local or `ref.current`; anything else (`count++` on state) is left to the expression's own diagnostic.
  const object = isPropertyAccessExpression(operand) ? unwrapParens(operand.expression) : null;
  const kind = isIdentifier(operand) ? ctx.scope.get(operand.text)?.kind : object && isIdentifier(object) ? ctx.scope.get(object.text)?.kind : undefined;
  if (kind !== (isIdentifier(operand) ? "local" : "ref")) return undefined;
  const target = ctx.lowerAssignTarget(operand);
  return target && { kind: "Assign", target, operator, value: { kind: "NumberLiteral", value: 1 } };
}

/** `setX(value)`, `setX(prev => ...)`, an assignment, or an allowlisted call. */
function lowerExpressionStatement(ctx: LoweringContext, expression: Expression, at: Node): StatementIR | null {
  const call = unwrapParens(expression);
  if (isBinaryExpression(call) && ASSIGNMENT_TOKENS.has(call.operatorToken.kind)) return lowerAssignment(ctx, call);
  const increment = lowerIncrement(ctx, call);
  if (increment !== undefined) return increment;
  if (isCallExpression(call) && isIdentifier(call.expression)) {
    const callee = ctx.scope.get(call.expression.text);
    if (callee?.kind === "sound") {
      if (call.arguments.length > 1) {
        ctx.error(DiagnosticCode.UnsupportedStatement, `\`${callee.name}\` takes at most one argument, the volume from 0 to 1: the sound and its path are fixed where it is declared.`, call);
        return null;
      }
      if (!ctx.canPlaySound()) {
        ctx.error(DiagnosticCode.SoundOutsideHandler, `\`${callee.name}()\` cannot be called in a state updater: it runs inside the setter and may run again. Play the sound in the handler, next to the setter call.`, call);
        return null;
      }
      const volume = call.arguments.length === 1 ? ctx.lowerExpression(call.arguments[0]!) : null;
      if (call.arguments.length === 1 && volume === null) return null;
      return { kind: "PlaySound", sound: callee.id, volume };
    }
    if (callee?.kind === "action") {
      if (!ctx.canPlaySound()) {
        ctx.error(DiagnosticCode.SoundOutsideHandler, `\`${callee.name}()\` cannot be called in a state updater: it runs inside the setter and may run again. Call it in the handler, next to the setter call.`, call);
        return null;
      }
      const args = ctx.lowerAll(call.arguments);
      if (!args) return null;
      return { kind: "CallAction", action: callee.action, args };
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
    const updater = ctx.inUpdater(() => lowerFunction(ctx, arg, { paramTypes: [type], returns: "value", what: "State updater" }));
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

