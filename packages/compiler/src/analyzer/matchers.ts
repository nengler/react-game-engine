// Recognisers for the statements of a component body: state, render constants, stores, refs, sounds and handlers.
import { NodeFlags, type CallExpression, type Expression, type Node, type Statement } from "typescript/ast";
import { isArrayBindingPattern, isObjectBindingPattern, isOmittedExpression, isArrowFunction, isBlock, isExpressionStatement, isCallExpression, isIdentifier, isPropertyAccessExpression, isVariableStatement } from "typescript/ast/is";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import { type UseStoreCallAnalysis, type RenderConstAnalysis, type RenderConstPattern, type UseRefCallAnalysis, type UseSoundCallAnalysis, type HandlerCallAnalysis, type HookCallAnalysis, type UseStateCallAnalysis, HANDLER_HOOKS, REMOVED_HOOKS } from "./model.ts";
import { unwrapParens } from "./util.ts";



/**
 * What a matcher makes of a component-body statement: the hooks it declares, or why it is malformed (reported at the
 * statement; `call` is the hook call, so it is not reported again as misplaced). A matcher returns null for a statement that
 * is not its kind at all.
 */
export type StatementMatch =
  | { readonly kind: "ok"; readonly hooks: readonly HookCallAnalysis[] }
  | { readonly kind: "invalid"; readonly code: DiagnosticCode; readonly message: string; readonly call: CallExpression | null };

/** Recognises `const [value, setValue] = useState(init)`; returns null if the statement is not a useState call at all. */
export function matchUseStateStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useState") return null;

  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code: DiagnosticCode.InvalidUseState, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0) return invalid("useState must be bound with `const`.");
  if (!isArrayBindingPattern(declaration.name)) {
    return invalid("useState must be destructured: `const [value, setValue] = useState(initial)`.");
  }
  const elements = declaration.name.elements;
  if (elements.length < 1 || elements.length > 2) {
    return invalid("useState destructuring must bind one or two names: `[value, setValue]`.");
  }
  const names: (string | null)[] = [];
  for (const element of elements) {
    if (!element.name && !element.dotDotDotToken && !element.initializer) {
      names.push(null); // hole: `const [, setValue] = ...`
      continue;
    }
    if (element.dotDotDotToken || element.initializer || !element.name || !isIdentifier(element.name)) {
      return invalid("useState destructuring must bind plain identifiers.");
    }
    names.push(element.name.text);
  }
  const valueName = names[0];
  if (!valueName) return invalid("useState must bind the state value.");
  if (init.arguments.length > 1) return invalid("useState takes at most one argument.");

  const hook: UseStateCallAnalysis = {
    kind: "useState",
    valueName,
    setterName: names[1] ?? null,
    initializer: init.arguments[0] ?? null,
    typeArgument: init.typeArguments?.[0] ?? null,
    call: init,
    declaration,
  };
  return { kind: "ok", hooks: [hook] };
}

/** `const name = expression;` that is not a hook call (hooks are matched first). */
export function matchRenderConst(statement: Statement): RenderConstAnalysis | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if ((list.flags & NodeFlags.Const) === 0 || list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  if (!declaration.initializer) return null;
  if (isIdentifier(declaration.name)) return { kind: "const", name: declaration.name.text, initializer: declaration.initializer, declaration, pattern: null };
  const pattern = renderConstPattern(declaration.name);
  if (pattern === null) return null;
  const names = pattern.entries.flatMap((e) => (e === null ? [] : [e.name]));
  return { kind: "const", name: names.join(","), initializer: declaration.initializer, declaration, pattern };
}

/** `{ x, y: top }` or `[a, , b]` with plain names only: no defaults, rests or nested patterns. Null for anything else. */
function renderConstPattern(name: Node): RenderConstPattern | null {
  if (isObjectBindingPattern(name)) {
    const entries: { name: string; key: string; node: Node }[] = [];
    for (const element of name.elements) {
      if (element.dotDotDotToken || element.initializer || !element.name || !isIdentifier(element.name)) return null;
      const key = element.propertyName === undefined ? element.name.text : isIdentifier(element.propertyName) ? element.propertyName.text : null;
      if (key === null) return null;
      entries.push({ name: element.name.text, key, node: element });
    }
    return entries.length > 0 ? { kind: "object", entries } : null;
  }
  if (isArrayBindingPattern(name)) {
    const entries: ({ name: string; node: Node } | null)[] = [];
    for (const element of name.elements) {
      // A hole (`[a, , b]`): an omitted expression, or, as this parser gives it, an element with no name.
      if (isOmittedExpression(element) || (!element.dotDotDotToken && !element.initializer && !element.name)) entries.push(null);
      else if (element.dotDotDotToken || element.initializer || !element.name || !isIdentifier(element.name)) return null;
      else entries.push({ name: element.name.text, node: element });
    }
    return entries.some((e) => e !== null) ? { kind: "array", entries } : null;
  }
  return null;
}

/** `s.player.hp` from the selector's parameter: the path, or null when the expression is not a plain path (`s` alone is `[]`). */
function plainPath(node: Node, parameter: string): string[] | null {
  const path: string[] = [];
  let at: Node = unwrapParens(node as Expression);
  while (isPropertyAccessExpression(at) && !at.questionDotToken) {
    path.unshift(at.name.text);
    at = unwrapParens(at.expression);
  }
  return isIdentifier(at) && at.text === parameter ? path : null;
}

/**
 * Recognises a read of the game state on an imported store; null if the statement is not a call of one.
 *
 * - `const hp = useGame((s) => s.player.hp)`: a plain path, the component subscribes to exactly that path.
 * - `const selected = useGame((s) => s.cursor === id)`: any expression of the state (a computed selector). Each path it reads is
 *   subscribed to, and the expression is a derived value, worked out again when one of them changes.
 *
 * Destructuring (`const { gold, lives } = useGame((s) => s.battle)`) reaches here split into one statement per name.
 */
export function matchStoreStatement(statement: Statement, storeNames: ReadonlySet<string>): StatementMatch | null {
  if (storeNames.size === 0 || !isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || !storeNames.has(init.expression.text)) return null;
  const storeName = init.expression.text;
  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code: DiagnosticCode.InvalidUseState, message, call: init });
  const example = `const hp = ${storeName}((s) => s.player.hp);`;
  if ((list.flags & NodeFlags.Const) === 0) return invalid(`${storeName}(…) must be bound with \`const\`: \`${example}\``);
  const selector = init.arguments[0] ? unwrapParens(init.arguments[0]) : undefined;
  if (init.arguments.length !== 1 || !selector || !isArrowFunction(selector) || selector.parameters.length !== 1 || !isIdentifier(selector.parameters[0]!.name) || init.typeArguments?.length) {
    return invalid(`${storeName} takes one selector, an arrow with one parameter: \`${example}\``);
  }
  if (isBlock(selector.body)) return invalid(`The selector must be an expression, not a block: \`(s) => s.player.hp\` or \`(s) => s.cursor === id\`.`);
  const parameter = (selector.parameters[0]!.name as { text: string }).text;
  const body = unwrapParens(selector.body);
  const read = (valueName: string, expression: Expression, at: Node): UseStoreCallAnalysis | string => {
    let path = plainPath(expression, parameter);
    // The store tells readers of an array about its items, not its `length`: `s.enemies.length` is worked out from `s.enemies`.
    if (path !== null && path.length > 1 && path[path.length - 1] === "length") path = null;
    if (path !== null && path.length === 0) return `'${valueName}' selects the whole state: select a path (\`(${parameter}) => ${parameter}.player\`) or destructure names from it (\`const { coins, collect } = ${storeName}((${parameter}) => ${parameter})\`).`;
    return { kind: "useStore", storeName, valueName, path: path ?? [], body: path === null ? expression : null, parameter, selector: at, call: init, declaration };
  };

  // Destructuring (`const { gold, lives } = useGame((s) => s.battle)`) was split into one selector per name before this (hooks/inline.ts).
  if (!isIdentifier(declaration.name)) return invalid(`${storeName}(…) binds one plain name: \`${example}\``);
  const one = read(declaration.name.text, body, selector);
  return typeof one === "string" ? invalid(one) : { kind: "ok", hooks: [one] };
}

/** Recognises `const r = useRef<T>()` and `const play = useSound("a.wav")`; null if the statement is not one. */
export function matchHandleStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression)) return null;
  const hook = init.expression.text;
  if (hook !== "useRef" && hook !== "useSound") return null;

  const code = hook === "useSound" ? DiagnosticCode.InvalidUseSound : DiagnosticCode.InvalidUseRef;
  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0 || !isIdentifier(declaration.name)) {
    return invalid(`${hook} must be bound with a plain \`const\` name: \`const handle = ${hook}(...)\`.`);
  }
  const name = declaration.name.text;
  const analysis: UseRefCallAnalysis | UseSoundCallAnalysis = hook === "useSound"
    ? { kind: "useSound", name, arguments: init.arguments, call: init, declaration }
    : { kind: "useRef", name, typeArgument: init.typeArguments?.[0] ?? null, arguments: init.arguments, call: init, declaration };
  return { kind: "ok", hooks: [analysis] };
}

/** Recognises `useUpdate(arrow)`, `useInput(arrow)`, `useMount(arrow)` and `useUnmount(arrow)`; null if the statement is not a call to one of them. */
export function matchHandlerStatement(statement: Statement): StatementMatch | null {
  if (!isExpressionStatement(statement)) return null;
  const call = unwrapParens(statement.expression);
  if (!isCallExpression(call) || !isIdentifier(call.expression)) return null;
  const removed = REMOVED_HOOKS[call.expression.text];
  if (removed) return { kind: "invalid", code: DiagnosticCode.UnknownHook, message: removed, call };
  if (!HANDLER_HOOKS.has(call.expression.text)) return null;
  const name = call.expression.text as HandlerCallAnalysis["kind"];
  const handler = call.arguments.length === 1 ? unwrapParens(call.arguments[0]!) : undefined;
  if (!handler || !isArrowFunction(handler)) {
    return { kind: "invalid", code: DiagnosticCode.InvalidHandler, message: `${name} takes exactly one arrow function: \`${name}(() => { ... })\`.`, call };
  }
  return { kind: "ok", hooks: [{ kind: name, handler, call, statement }] };
}
