import { NodeFlags, SyntaxKind, type ArrowFunction, type BinaryExpression, type CallExpression, type Expression, type Node, type PropertyAccessExpression, type Statement } from "typescript/ast";
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
  isForStatement,
  isDoStatement,
  isWhileStatement,
  isTryStatement,
  isThrowStatement,
  isIdentifier,
  isIfStatement,
  isPostfixUnaryExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isElementAccessExpression,
  isSpreadElement,
  isNumericLiteral,
  isStringLiteral,
  isNonNullExpression,
  isReturnStatement,
  isVariableDeclarationList,
  isVariableStatement,
  isFunctionDeclaration,
} from "typescript/ast/is";
import { unwrapParens } from "../analyzer/analyzer.ts";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import {
  localId,
  MUTATING_ARRAY_METHODS,
  type ArrayMethodName,
  type ArrayElementIR,
  type AssignOperator,
  type BinaryOperator,
  type AssignStmtIR,
  type AssignTargetIR,
  type LocalConstStmtIR,
  type LoopBindingIR,
  type ObjectPropertyIR,
  walkStatements,
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
  /** Resolves an assignment to a `let` local or a member of a handler's own value; reports its own diagnostic and returns null if `node` is not a valid assignment target. */
  lowerAssignTarget(node: Expression): AssignTargetIR | null;
  stateType(state: StateId): TypeIR;
  /** `receiver.name(args)` for an allowlisted array method (`toSpliced`, `with`, …), the arguments lowered as a call would. */
  lowerArrayCall(receiver: ExprIR, name: ArrayMethodName, args: readonly Expression[], at: Node): ExprIR | null;
  /** Whether a state slot holds a per-instance object (a physics body): its members are called, never written through the field. */
  isHandleState(state: StateId): boolean;
  /** `s.vx` on a `useMutable` value `s`: its state slot. Undefined if `node` is not on one, "error" after reporting. */
  mutableField(node: PropertyAccessExpression): StateId | "error" | undefined;
  /** False in a `useUnmount` handler: the component is going away, so a state update could never render. */
  canSetState(): boolean;
  /** In statements of the component body, which run during render (see `LoweringMode.inRenderBlock`). */
  inRenderBlock(): boolean;
  /** True in a handler: where it may hand a callback to a function (`settings.subscribe(() => …)`). */
  canPassCallback(): boolean;
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
  /** `declared`: each parameter's own annotation, as written (`(id: string) => …` in a component body). */
  readonly paramTypes: readonly TypeIR[] | "contextual" | "declared";
  /**
   * `void`: handlers (`return;` only). `value`: a function that returns a value (`return expr;` required). `cleanup`: `useMount`, which may return
   * a cleanup (`return () => …;`, `return settings.subscribe(…);`, or an expression body that calls a function). `any`: a function
   * a handler hands to a method or the standard library (`list.sort((a, b) => …)`), which may return a value or nothing.
   */
  readonly returns: "void" | "value" | "cleanup" | "any";
  /** What to call the function in diagnostics. */
  readonly what: string;
}


export function lowerFunction(ctx: LoweringContext, fn: ArrowFunction, options: FunctionOptions): FunctionIR | null {
  return ctx.inScope((scope) => {
    const params: ParamIR[] = [];
    if (options.paramTypes !== "contextual" && options.paramTypes !== "declared" && fn.parameters.length > options.paramTypes.length) {
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
      const type: TypeIR =
        options.paramTypes === "contextual" ? { kind: "Contextual" }
        : options.paramTypes === "declared" ? (param.type ? ctx.typeFromNode(param.type) ?? { kind: "Contextual" } : { kind: "Contextual" })
        : options.paramTypes[index]!;
      scope.declare(name, { kind: "param", id, name, type });
      params.push({ id, name, type });
    }

    let body: StatementIR[] | null;
    if (isBlock(fn.body)) {
      // The body's top-level block shares the parameters' scope, as in JS: `(n) => { const n = 1; }` is a redeclaration.
      body = lowerStatements(ctx, fn.body.statements, options, { newScope: false, jumps: NO_JUMPS });
    } else if (options.returns === "value" || (options.returns === "any" && !isEffect(ctx, fn.body))) {
      const value = ctx.lowerExpression(fn.body);
      body = value && [{ kind: "Return", value }];
    } else {
      const stmt = lowerExpressionStatement(ctx, fn.body, fn.body);
      // `useMount(() => settings.subscribe(…))`: what a call returns is the cleanup (kept only if it is a function, as in React).
      body = stmt && [options.returns === "cleanup" && stmt.kind === "ExpressionStatement" ? { kind: "Return", value: stmt.expression } : stmt];
    }
    // A function of the component's own keeps its type parameters: its parameter types may name them.
    const typeParams = options.paramTypes === "declared" && fn.typeParameters !== undefined ? `<${fn.typeParameters.map((t) => t.getText()).join(", ")}>` : undefined;
    return body && { kind: "Function", params, body, ...(typeParams !== undefined ? { typeParams } : {}) };
  });
}

/**
 * Statements of the component body that compute together (a render block): lowered like a handler's, in a scope of their own,
 * then a `return { a, b }` of the names declared at the top is added, so what reads them after the block reads them from it. A
 * `return` of the author's is refused: a component returns once, at its end.
 */
export function lowerRenderBlock(ctx: LoweringContext, statements: readonly Statement[], names: readonly string[], at: Node): FunctionIR | null {
  return ctx.inScope(() => {
    const body = lowerStatements(ctx, statements, { paramTypes: [], returns: "void", what: "The component body" }, { newScope: false, jumps: NO_JUMPS });
    if (!body) return null;
    let returns = false;
    walkStatements(body, () => {}, (s) => {
      if (s.kind === "Return") returns = true;
    });
    if (returns) {
      ctx.error(DiagnosticCode.InvalidComponentBody, "A component returns once, at its end: compute a value here and test it in the `return` (`return open ? <Menu /> : null`).", at);
      return null;
    }
    const properties: ObjectPropertyIR[] = [];
    for (const name of names) {
      const binding = ctx.scope.get(name);
      if (binding?.kind !== "local") {
        ctx.error(DiagnosticCode.InvalidComponentBody, `'${name}' must be declared with \`const\` or \`let\` and one name, in statements of the component body.`, at);
        return null;
      }
      properties.push({ kind: "Property", name, value: { kind: "LocalRead", local: binding.id, name } });
    }
    body.push({ kind: "Return", value: { kind: "ObjectLiteral", properties } });
    return { kind: "Function", params: [], body };
  });
}

/** A function a handler hands to a method of its own value or to the standard library: it may return a value, or nothing. */
export function lowerFunctionValue(ctx: LoweringContext, fn: ArrowFunction): ExprIR | null {
  const lowered = lowerFunction(ctx, fn, { paramTypes: "contextual", returns: "any", what: "A function" });
  return lowered && { kind: "Callback", fn: lowered };
}

/**
 * `() => setView(read())` as a value in a handler: handed to a function (`settings.subscribe(() => …)`) or returned from
 * `useMount` as its cleanup. It is a handler of its own, which may run later, lowered like a callback prop. Null (after
 * reporting) when it is not allowed here or its body is not handler code.
 */
export function lowerCallbackValue(ctx: LoweringContext, fn: ArrowFunction, what: string): ExprIR | null {
  if (!ctx.canPassCallback()) {
    ctx.error(DiagnosticCode.UnsupportedExpression, `An arrow function can be handed to a function only in a handler (\`useMount(() => settings.subscribe(() => …))\`), not in ${what}.`, fn);
    return null;
  }
  const lowered = lowerFunction(ctx, fn, { paramTypes: "contextual", returns: "void", what: "A callback" });
  return lowered && { kind: "Callback", fn: lowered };
}

/** Which jumps the statements may make: `break` in a `for…of` or a `switch`, `continue` in a `for…of`, of the same function. */
interface Jumps {
  readonly break: boolean;
  readonly continue: boolean;
}

const NO_JUMPS: Jumps = { break: false, continue: false };
/** Inside a loop's body: both. */
const LOOP_JUMPS: Jumps = { break: true, continue: true };

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

  if (isWhileStatement(statement) || isDoStatement(statement)) {
    const test = ctx.lowerExpression(statement.expression);
    const body = lowerStatements(ctx, isBlock(statement.statement) ? statement.statement.statements : [statement.statement], options, { newScope: true, jumps: LOOP_JUMPS });
    return test && body && { kind: "While", test, body, doWhile: isDoStatement(statement) };
  }

  if (isForStatement(statement)) return lowerFor(ctx, statement, options);

  if (isTryStatement(statement)) {
    const block = lowerStatements(ctx, statement.tryBlock.statements, options, { newScope: true, jumps });
    if (!block) return null;
    let handler: { binding: { local: ReturnType<typeof localId>; name: string } | null; body: StatementIR[] } | null = null;
    if (statement.catchClause) {
      const clause = statement.catchClause;
      const declared = clause.variableDeclaration;
      if (declared && !isIdentifier(declared.name)) {
        ctx.error(DiagnosticCode.UnsupportedStatement, "A `catch` binds one name (`catch (e)`), or none (`catch`).", declared);
        return null;
      }
      const caught = ctx.inScope((scope) => {
        let binding: { local: ReturnType<typeof localId>; name: string } | null = null;
        if (declared && isIdentifier(declared.name)) {
          const name = declared.name.text;
          if (!checkFreshName(ctx, name, declared.name)) return null;
          const local = localId(ctx.componentName, name, ctx.nextSerial());
          scope.declare(name, { kind: "local", id: local, name, mutable: false });
          binding = { local, name };
        }
        const body = lowerStatements(ctx, clause.block.statements, options, { newScope: false, jumps });
        return body && { binding, body };
      });
      if (!caught) return null;
      handler = caught;
    }
    const finalizer = statement.finallyBlock ? lowerStatements(ctx, statement.finallyBlock.statements, options, { newScope: true, jumps }) : null;
    if (statement.finallyBlock && !finalizer) return null;
    return { kind: "Try", block, handler, finalizer };
  }

  if (isThrowStatement(statement)) {
    const value = ctx.lowerExpression(statement.expression);
    return value && { kind: "Throw", value };
  }

  if (isBlock(statement)) {
    const body = lowerStatements(ctx, statement.statements, options, { newScope: true, jumps });
    return body && { kind: "Block", body };
  }

  if (isSwitchStatement(statement)) return lowerSwitch(ctx, statement, options, jumps);

  if (isBreakStatement(statement) || isContinueStatement(statement)) {
    const isBreak = isBreakStatement(statement);
    const word = isBreak ? "break" : "continue";
    if (statement.label) {
      ctx.error(DiagnosticCode.UnsupportedStatement, `Labelled \`${word}\` is not supported: it leaves the innermost ${isBreak ? "loop or `switch`" : "loop"}.`, statement);
      return null;
    }
    if (!(isBreak ? jumps.break : jumps.continue)) {
      ctx.error(DiagnosticCode.UnsupportedStatement, `\`${word}\` is only valid inside a ${isBreak ? "loop or a `switch`" : "loop"} of the same function.`, statement);
      return null;
    }
    return { kind: isBreak ? "Break" : "Continue" };
  }

  if (isReturnStatement(statement)) {
    if (options.returns === "cleanup" || options.returns === "any") {
      if (!statement.expression) return { kind: "Return", value: null };
      const returned = unwrapParens(statement.expression);
      const value = isArrowFunction(returned) ? lowerCallbackValue(ctx, returned, "this place") : ctx.lowerExpression(statement.expression);
      return value && { kind: "Return", value };
    }
    if (options.returns === "void") {
      if (statement.expression && options.what === "The component body") {
        // React's `if (!hero) return null;`: here a component has one return, of its JSX, and the condition goes in it.
        ctx.error(
          DiagnosticCode.InvalidComponentBody,
          "This `return` is not supported: an early return is `if (condition) return …;` (or `{ return …; }`) at the top level of the component body, with no `else`, as React components usually guard (`if (!hero) return null;`). Otherwise put the condition in what the last `return` returns: `return dead ? null : <Text>…</Text>;`, or `{!dead && <Text>…</Text>}` inside an element.",
          statement,
        );
        return null;
      }
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
      const where = ctx.inRenderBlock() ? "in statements of the component body" : "in handlers";
      ctx.error(ctx.inRenderBlock() ? DiagnosticCode.InvalidComponentBody : DiagnosticCode.UnsupportedStatement, `Only \`const name = expression;\` and \`let name = expression;\` declarations (one name, with a value) are supported ${where}.`, statement);
      return null;
    }
    // `const events = step(input, dt);`: a game-state action whose result the handler uses (only here, in a handler, where it
    // runs once; in JSX or a derived value it would run on every render).
    const init = unwrapParens(decl.initializer);
    const action = isCallExpression(init) && isIdentifier(init.expression) ? ctx.scope.get(init.expression.text) : undefined;
    let value: ExprIR | null;
    if (action?.kind === "action" && isCallExpression(init)) {
      if (ctx.inRenderBlock()) {
        ctx.error(DiagnosticCode.InvalidComponentBody, `An action cannot be called in the component body: it runs on every render. Call \`${action.name}()\` in a handler.`, init);
        return null;
      }
      const args = ctx.lowerAll(init.arguments);
      if (!args) return null;
      value = { kind: "Call", callee: { kind: "Action", name: action.action }, args };
    } else value = ctx.lowerExpression(decl.initializer); // lowered before the name exists: no self-reference
    const name = decl.name.text;
    if (!value || !checkFreshName(ctx, name, decl.name)) return null;
    const id = localId(ctx.componentName, name, ctx.nextSerial());
    ctx.scope.declare(name, { kind: "local", id, name, mutable, owned: isFresh(value) });
    const type = decl.type ? ctx.typeFromNode(decl.type) : undefined;
    return { kind: "LocalConst", id, name, value, ...(mutable ? { mutable: true as const } : {}), ...(type ? { type } : {}) };
  }

  if (isFunctionDeclaration(statement)) {
    const name = statement.name?.text ?? "f";
    ctx.error(
      DiagnosticCode.UnsupportedStatement,
      /^[A-Z]/.test(name)
        ? `Declare the component <${name}> at the top level of the file, not inside another component: each component is compiled on its own, and one declared inside would be made again on every render.`
        : `Write the function as \`const ${name} = (…) => { … };\`: a function declaration is not supported ${ctx.inRenderBlock() ? "in the component body" : "in a handler"}.`,
      statement,
    );
    return null;
  }
  ctx.error(
    DiagnosticCode.UnsupportedStatement,
    `Unsupported statement ${ctx.inRenderBlock() ? "in the component body" : "in a handler"} (${SyntaxKind[statement.kind]}). Supported: state setter calls, writes to \`useMutable\` fields and \`let\` locals, allowlisted calls, \`if\`/\`else\`, \`switch\`, loops (\`for…of\`, \`for\`, \`while\`, \`do…while\`, with \`break\` and \`continue\`), \`try\`/\`catch\`/\`finally\`, \`throw\`, \`const\`, \`let\` and \`return\`.`,
    statement,
  );
  return null;
}

/**
 * Whether an arrow's expression body does something rather than computes a value: a setter, sound or action call, or an
 * assignment (`() => setN(1)`, `() => count.current++`). Such a body is a statement, not a returned value.
 */
function isEffect(ctx: LoweringContext, body: Node): boolean {
  const e = unwrapParens(body as Expression);
  if (isBinaryExpression(e) && ASSIGNMENT_TOKENS.has(e.operatorToken.kind)) return true;
  if (isPrefixUnaryExpression(e) || isPostfixUnaryExpression(e)) return e.operator === SyntaxKind.PlusPlusToken || e.operator === SyntaxKind.MinusMinusToken;
  if (!isCallExpression(e) || !isIdentifier(e.expression)) return false;
  const kind = ctx.scope.get(e.expression.text)?.kind;
  return kind === "sound" || kind === "action" || kind === "function";
}

/** Whether a value is new, made where it is written (a literal, `new`, a call's result), rather than a read of something that exists. */
function isFresh(value: ExprIR): boolean {
  // An array method that hands back one of the array's own items (`enemies.find(…)`) is a read, not a new value.
  if (value.kind === "Call") return !(value.callee.kind === "ArrayMethod" && ITEM_METHODS.has(value.callee.name));
  return value.kind === "ArrayLiteral" || value.kind === "ObjectLiteral" || value.kind === "New" || value.kind === "TemplateLiteral";
}

/** Array methods whose result is one of the array's items. */
const ITEM_METHODS: ReadonlySet<string> = new Set(["find", "findLast", "at"]);

/** The parts of `a, b, c` (a comma list in a `for` loop's head), in order. */
function commaParts(expression: Expression): Expression[] {
  const e = unwrapParens(expression);
  if (isBinaryExpression(e) && e.operatorToken.kind === SyntaxKind.CommaToken) return [...commaParts(e.left), ...commaParts(e.right)];
  return [e];
}

/**
 * `for (let i = 0; i < n; i++) { … }`: the `let`s are the loop's own (declared in a scope around the test, the update and the
 * body); an initializer that is not a declaration, and the update, are assignments (`i++` is `i += 1`), as comma lists.
 */
function lowerFor(ctx: LoweringContext, statement: Statement & { kind: SyntaxKind.ForStatement }, options: FunctionOptions): StatementIR | null {
  const loop = statement as unknown as { initializer?: Node; condition?: Expression; incrementor?: Expression; statement: Statement };
  const shape = "A `for` loop's head is `let` locals or assignments, a test, and assignments: `for (let i = 0; i < n; i++)`";
  const assignments = (expression: Expression): AssignStmtIR[] | null => {
    const out: AssignStmtIR[] = [];
    for (const part of commaParts(expression)) {
      const lowered = lowerExpressionStatement(ctx, part, part);
      if (!lowered) return null;
      if (lowered.kind !== "Assign") {
        ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}.`, part);
        return null;
      }
      out.push(lowered);
    }
    return out;
  };
  return ctx.inScope(() => {
    const init: (LocalConstStmtIR | AssignStmtIR)[] = [];
    const list = loop.initializer;
    if (list !== undefined && isVariableDeclarationList(list)) {
      if ((list.flags & NodeFlags.Let) === 0) {
        ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}: its locals are \`let\`.`, list);
        return null;
      }
      for (const decl of list.declarations) {
        if (!isIdentifier(decl.name) || !decl.initializer) {
          ctx.error(DiagnosticCode.UnsupportedStatement, `${shape}: each \`let\` is one name with a value.`, decl);
          return null;
        }
        const value = ctx.lowerExpression(decl.initializer);
        const name = decl.name.text;
        if (!value || !checkFreshName(ctx, name, decl.name)) return null;
        const id = localId(ctx.componentName, name, ctx.nextSerial());
        ctx.scope.declare(name, { kind: "local", id, name, mutable: true, owned: isFresh(value) });
        const type = decl.type ? ctx.typeFromNode(decl.type) : undefined;
        init.push({ kind: "LocalConst", id, name, value, mutable: true, ...(type ? { type } : {}) });
      }
    } else if (list !== undefined) {
      const assigned = assignments(list as Expression);
      if (!assigned) return null;
      init.push(...assigned);
    }
    const test = loop.condition ? ctx.lowerExpression(loop.condition) : null;
    if (loop.condition && !test) return null;
    const update = loop.incrementor ? assignments(loop.incrementor) : [];
    if (!update) return null;
    const body = lowerStatements(ctx, isBlock(loop.statement) ? loop.statement.statements : [loop.statement], options, { newScope: true, jumps: LOOP_JUMPS });
    return body && { kind: "For", init, test, update, body };
  });
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
    const body = lowerStatements(ctx, isBlock(loop.statement) ? loop.statement.statements : [loop.statement], options, { newScope: true, jumps: LOOP_JUMPS });
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

/** A step from a `useMutable` field into a value it holds: `.hp`, or `[i]`. `bang` is a `!` after it, kept so the generated code type-checks. */
type PathStep =
  | { readonly kind: "prop"; readonly name: string; readonly bang: boolean }
  | { readonly kind: "index"; readonly index: Expression; readonly bang: boolean };

/** `s.enemies[i].hp`: the field (`s.enemies`) and what is reached through it. */
interface MutablePath {
  readonly state: StateId;
  readonly steps: readonly PathStep[];
}

/** An index written through a field is worked out twice (once to read, once to write), so it must be a plain value. */
function isPlainIndex(node: Expression): boolean {
  const e = unwrapParens(node);
  if (isNumericLiteral(e) || isStringLiteral(e) || isIdentifier(e)) return true;
  if (isPropertyAccessExpression(e) || isNonNullExpression(e)) return isPlainIndex(e.expression);
  if (isElementAccessExpression(e)) return isPlainIndex(e.expression) && isPlainIndex(e.argumentExpression);
  if (isPrefixUnaryExpression(e)) return e.operator === SyntaxKind.MinusToken && isPlainIndex(e.operand);
  if (isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    return (k === SyntaxKind.PlusToken || k === SyntaxKind.MinusToken || k === SyntaxKind.AsteriskToken || k === SyntaxKind.PercentToken) && isPlainIndex(e.left) && isPlainIndex(e.right);
  }
  return false;
}

/**
 * `s.enemies`, `s.enemies[i].hp`, `s.pos.x`: a `useMutable` field and the steps into what it holds. Undefined if `target` does not
 * start at a field (the caller carries on), null after reporting.
 */
function mutablePath(ctx: LoweringContext, target: Expression): MutablePath | null | undefined {
  const steps: PathStep[] = [];
  let node = unwrapParens(target);
  let bang = false;
  for (;;) {
    if (isNonNullExpression(node)) {
      bang = true;
      node = unwrapParens(node.expression);
    } else if (isPropertyAccessExpression(node)) {
      const state = ctx.mutableField(node);
      if (state === "error") return null;
      if (state !== undefined) return { state, steps };
      if (node.questionDotToken) {
        ctx.error(DiagnosticCode.UnsupportedStatement, "A write through a field cannot use `?.`: check the value first.", node);
        return null;
      }
      steps.unshift({ kind: "prop", name: node.name.text, bang });
      bang = false;
      node = unwrapParens(node.expression);
    } else if (isElementAccessExpression(node)) {
      if (node.questionDotToken) {
        ctx.error(DiagnosticCode.UnsupportedStatement, "A write through a field cannot use `?.`: check the value first.", node);
        return null;
      }
      if (!isPlainIndex(node.argumentExpression)) {
        ctx.error(
          DiagnosticCode.UnsupportedStatement,
          "An index written through a field is read and written, so it must be a plain value (a name, a number, a property): compute it into a `const` first.",
          node.argumentExpression,
        );
        return null;
      }
      steps.unshift({ kind: "index", index: node.argumentExpression, bang });
      bang = false;
      node = unwrapParens(node.expression);
    } else {
      return undefined;
    }
  }
}

/**
 * The new value of a field after a write inside it, as the author would write it by hand: `s.enemies[i].hp -= 1` is
 * `s.enemies = s.enemies.with(i, { ...s.enemies[i], hp: s.enemies[i].hp - 1 })`. A write copies each level it passes through and
 * nothing else, so the value the frame committed stays as it was and render and other components compare references as before.
 * `leaf` gets the current value at the end of the path (a live read) and returns what replaces it.
 */
function rebuildPath(ctx: LoweringContext, path: MutablePath, leaf: (current: ExprIR) => ExprIR | null): ExprIR | null {
  const go = (read: ExprIR, i: number): ExprIR | null => {
    const step = path.steps[i];
    if (step === undefined) return leaf(read);
    if (step.kind === "prop") {
      const member: ExprIR = { kind: "MemberRead", object: read, name: step.name, optional: false };
      const value = go(step.bang ? { kind: "NonNull", expression: member } : member, i + 1);
      return value && { kind: "ObjectLiteral", properties: [{ kind: "Spread", value: read }, { kind: "Property", name: step.name, value }] };
    }
    const index = ctx.lowerExpression(step.index);
    if (!index) return null;
    const element: ExprIR = { kind: "IndexRead", object: read, index, optional: false };
    const value = go(step.bang ? { kind: "NonNull", expression: element } : element, i + 1);
    return value && { kind: "Call", callee: { kind: "ArrayMethod", receiver: read, name: "with" }, args: [index, value] };
  };
  return go({ kind: "StateRead", state: path.state, live: true }, 0);
}

/** True, after reporting, where a field cannot be written: the component body, and `useUnmount`. */
function writeBlocked(ctx: LoweringContext, at: Node): boolean {
  if (ctx.inRenderBlock()) {
    ctx.error(DiagnosticCode.InvalidComponentBody, "A `useMutable` field cannot be written in the component body: it runs on every render. Write it in a handler (`useUpdate`, `useMount`, a callback prop).", at);
    return true;
  }
  if (!ctx.canSetState()) {
    ctx.error(DiagnosticCode.UnsupportedStatement, "A `useMutable` field cannot be written in `useUnmount`: the component is going away, so the update could never render. Tell the parent with a callback prop (`onGone?.()`).", at);
    return true;
  }
  return false;
}

/**
 * `s.vx = value`, `s.vx += value`, `s.vx++` on a `useMutable` value, and the same inside what a field holds (`s.list[i].hp -= 1`,
 * `s.pos.x = 3`): a write of that state. The handler reads it back at once (a `live` read), so `s.vx += 1; if (s.vx > 3) …` sees the
 * sum. Undefined if `target` is not on a `useMutable` field (the caller carries on).
 */
function lowerMutableWrite(ctx: LoweringContext, target: Expression, operator: AssignOperator, rhs: Expression | null, at: Node): StatementIR | null | undefined {
  const path = mutablePath(ctx, target);
  if (path === undefined) return undefined;
  if (path === null) return null;
  // A physics body is a per-instance object: its members are called, not written.
  if (path.steps.length > 0 && ctx.isHandleState(path.state)) return undefined;
  if (writeBlocked(ctx, at)) return null;
  const value = rhs === null ? ({ kind: "NumberLiteral", value: 1 } as ExprIR) : ctx.lowerExpression(rhs);
  if (!value) return null;
  const next = rebuildPath(ctx, path, (current) =>
    operator === "=" ? value : { kind: "Binary", operator: operator.slice(0, -1) as BinaryOperator, left: current, right: value },
  );
  return next && { kind: "SetState", state: path.state, value: next };
}

/**
 * `s.enemies.push(e)`, `s.enemies[i].tags.splice(0, 1)`, `s.queue.shift()`: an array method that changes a list in place, as a
 * statement on a field's list. The list is replaced by a copy with the change made (`push` is a spread, `splice` is `toSpliced`).
 * Undefined if the call is not one of these (the caller carries on).
 */
function lowerMutableMethod(ctx: LoweringContext, call: CallExpression): StatementIR | null | undefined {
  if (!isPropertyAccessExpression(call.expression)) return undefined;
  const callee = call.expression;
  const name = callee.name.text;
  if (!Object.hasOwn(MUTATING_ARRAY_METHODS, name) || name === "forEach") return undefined;
  const path = mutablePath(ctx, callee.expression);
  if (path === undefined) return undefined;
  if (path === null) return null;
  if (path.steps.length > 0 && ctx.isHandleState(path.state)) return undefined;
  if (writeBlocked(ctx, call)) return null;
  if (call.questionDotToken || callee.questionDotToken) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `\`?.${name}\` is not supported on a field: check the value first.`, call);
    return null;
  }
  const list = callee.expression.getText();
  const elements = (): ArrayElementIR[] | null => {
    const out: ArrayElementIR[] = [];
    for (const argument of call.arguments) {
      const spread = isSpreadElement(argument);
      const value = ctx.lowerExpression(spread ? argument.expression : argument);
      if (!value) return null;
      out.push({ spread, value });
    }
    return out;
  };
  const noArguments = (): boolean => {
    if (call.arguments.length === 0) return true;
    ctx.error(DiagnosticCode.UnsupportedStatement, `\`${name}\` takes no arguments here.`, call);
    return false;
  };
  const next = rebuildPath(ctx, path, (current): ExprIR | null => {
    switch (name) {
      case "push": {
        const added = elements();
        return added && { kind: "ArrayLiteral", elements: [{ spread: true, value: current }, ...added] };
      }
      case "unshift": {
        const added = elements();
        return added && { kind: "ArrayLiteral", elements: [...added, { spread: true, value: current }] };
      }
      case "pop":
        return noArguments() ? { kind: "Call", callee: { kind: "ArrayMethod", receiver: current, name: "slice" }, args: [{ kind: "NumberLiteral", value: 0 }, { kind: "NumberLiteral", value: -1 }] } : null;
      case "shift":
        return noArguments() ? { kind: "Call", callee: { kind: "ArrayMethod", receiver: current, name: "slice" }, args: [{ kind: "NumberLiteral", value: 1 }] } : null;
      case "splice":
        return ctx.lowerArrayCall(current, "toSpliced", call.arguments, call);
      case "sort":
        return ctx.lowerArrayCall(current, "toSorted", call.arguments, call);
      case "reverse":
        return noArguments() ? ctx.lowerArrayCall(current, "toReversed", [], call) : null;
      default:
        ctx.error(DiagnosticCode.UnsupportedStatement, `\`${name}\` is not supported on a field's list: write \`${list} = ${list}.map(…)\` for the list you want.`, call);
        return null;
    }
  });
  return next && { kind: "SetState", state: path.state, value: next };
}

/** `target = value` / `target += value`: a `useMutable` field, a `let` local, or a member of a handler's own value. */
function lowerAssignment(ctx: LoweringContext, expression: BinaryExpression): StatementIR | null {
  const operator = ASSIGN_OPERATORS.get(expression.operatorToken.kind);
  if (!operator) {
    ctx.error(DiagnosticCode.UnsupportedStatement, `Supported assignment operators: ${[...ASSIGN_OPERATORS.values()].join(", ")}.`, expression.operatorToken);
    return null;
  }
  const mutable = lowerMutableWrite(ctx, expression.left, operator, expression.right, expression);
  if (mutable !== undefined) return mutable;
  const target = ctx.lowerAssignTarget(unwrapParens(expression.left));
  const value = ctx.lowerExpression(expression.right);
  // `best = enemy`: from here on `best` may be state's own object, so it is no longer the handler's to change in place.
  if (target?.kind === "Local" && value && !isFresh(value)) {
    const binding = ctx.scope.get(target.name);
    if (binding?.kind === "local") binding.owned = false;
  }
  return target && value && { kind: "Assign", target, operator, value };
}

/**
 * `n++`, `--best.hits`: as a statement, the same as `+= 1` / `-= 1` on a `let` local. (Anywhere else, `++` stays an
 * error: it would change state in place.)
 */
function lowerIncrement(ctx: LoweringContext, expression: Expression): StatementIR | null | undefined {
  if (!isPrefixUnaryExpression(expression) && !isPostfixUnaryExpression(expression)) return undefined;
  const operator = expression.operator === SyntaxKind.PlusPlusToken ? "+=" : expression.operator === SyntaxKind.MinusMinusToken ? "-=" : null;
  if (operator === null) return undefined;
  const operand = unwrapParens(expression.operand);
  const mutable = lowerMutableWrite(ctx, operand, operator, null, expression);
  if (mutable !== undefined) return mutable;
  // Only a local or a member of a handler's own value (`best.hits++`); anything else (`count++` on state) is left to
  // the expression's own diagnostic.
  const object = isPropertyAccessExpression(operand) ? unwrapParens(operand.expression) : null;
  const kind = isIdentifier(operand) ? ctx.scope.get(operand.text)?.kind : object && isIdentifier(object) ? ctx.scope.get(object.text)?.kind : undefined;
  let root: Expression = operand;
  while (isPropertyAccessExpression(root) || isElementAccessExpression(root) || isNonNullExpression(root)) root = unwrapParens(root.expression);
  const rootBinding = root !== operand && isIdentifier(root) ? ctx.scope.get(root.text) : undefined;
  const owned = rootBinding?.kind === "local" && rootBinding.owned === true;
  if (!owned && !(isIdentifier(operand) && kind === "local")) return undefined;
  const target = ctx.lowerAssignTarget(operand);
  return target && { kind: "Assign", target, operator, value: { kind: "NumberLiteral", value: 1 } };
}

/** `setX(value)`, `setX(prev => ...)`, an assignment, or an allowlisted call. */
function lowerExpressionStatement(ctx: LoweringContext, expression: Expression, at: Node): StatementIR | null {
  const call = unwrapParens(expression);
  if (isBinaryExpression(call) && ASSIGNMENT_TOKENS.has(call.operatorToken.kind)) return lowerAssignment(ctx, call);
  const increment = lowerIncrement(ctx, call);
  if (increment !== undefined) return increment;
  if (isCallExpression(call)) {
    const method = lowerMutableMethod(ctx, call);
    if (method !== undefined) return method;
  }
  if (isCallExpression(call) && isIdentifier(call.expression)) {
    const callee = ctx.scope.get(call.expression.text);
    if (ctx.inRenderBlock() && (callee?.kind === "sound" || callee?.kind === "action")) {
      const what = callee.kind === "sound" ? "A sound" : "An action";
      ctx.error(
        DiagnosticCode.InvalidComponentBody,
        `${what} cannot be called in the component body: it runs on every render. Call \`${call.expression.text}()\` in a handler (\`useUpdate\`, \`useMount\`, a callback prop), or compute the value here and use it.`,
        call,
      );
      return null;
    }
    if (callee?.kind === "sound") {
      if (call.arguments.length > 1) {
        ctx.error(DiagnosticCode.UnsupportedStatement, `\`${callee.name}\` takes at most one argument, the volume from 0 to 1: the sound and its path are fixed where it is declared.`, call);
        return null;
      }
      const volume = call.arguments.length === 1 ? ctx.lowerExpression(call.arguments[0]!) : null;
      if (call.arguments.length === 1 && volume === null) return null;
      return { kind: "PlaySound", sound: callee.id, volume };
    }
    if (callee?.kind === "action") {
      const args = ctx.lowerAll(call.arguments);
      if (!args) return null;
      return { kind: "CallAction", action: callee.action, args };
    }
  }
  const lowered = ctx.lowerExpression(call);
  if (!lowered) return null;
  if (lowered.kind !== "Call") {
    ctx.error(DiagnosticCode.UnsupportedStatement, "Expression statements must be a state setter call, a write to a field or a `let` local, or an allowlisted call.", at);
    return null;
  }
  return { kind: "ExpressionStatement", expression: lowered };
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

