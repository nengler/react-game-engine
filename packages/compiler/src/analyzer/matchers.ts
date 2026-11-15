// Recognisers for the statements of a component body: state, render constants, stores, refs, sounds and handlers.
import { NodeFlags, SyntaxKind, type CallExpression, type Expression, type Node, type Statement } from "typescript/ast";
import { isAsExpression, isTypeReferenceNode, isArrayBindingPattern, isBindingElement, isObjectBindingPattern, isOmittedExpression, isArrowFunction, isBlock, isExpressionStatement, isCallExpression, isIdentifier, isObjectLiteralExpression, isPropertyAccessExpression, isPropertyAssignment, isTypeLiteralNode, isVariableStatement } from "typescript/ast/is";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import { type UseStoreCallAnalysis, type RenderConstAnalysis, type RenderConstPattern, type UseSoundCallAnalysis, type HandlerCallAnalysis, type HookCallAnalysis, HANDLER_HOOKS, REMOVED_HOOKS } from "./model.ts";
import { unwrapParens } from "./util.ts";



/**
 * What a matcher makes of a component-body statement: the hooks it declares, or why it is malformed (reported at the
 * statement; `call` is the hook call, so it is not reported again as misplaced). A matcher returns null for a statement that
 * is not its kind at all.
 */
export type StatementMatch =
  | { readonly kind: "ok"; readonly hooks: readonly HookCallAnalysis[] }
  | { readonly kind: "invalid"; readonly code: DiagnosticCode; readonly message: string; readonly call: CallExpression | null };

/**
 * `const [hp, setHp] = useState(3)`: `useState` is replaced by `useMutable` (docs/MUTABLE_STATE.md). Reported with the conversion
 * written out in the author's names; null if the statement is not a `useState` call at all.
 */
export function matchUseStateStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useState") return null;
  const names = isArrayBindingPattern(declaration.name)
    ? declaration.name.elements.map((e) => (isBindingElement(e) && e.name !== undefined && isIdentifier(e.name) ? e.name.text : null))
    : [];
  const value = names[0] ?? "value";
  const setter = names[1] ?? null;
  const initial = init.arguments[0]?.getText() ?? "…";
  const message =
    `\`useState\` is replaced by \`useMutable\`, state you write directly: \`const s = useMutable({ ${value}: ${initial} })\`, read as \`s.${value}\`` +
    (setter !== null ? `, and \`${setter}(v)\` becomes \`s.${value} = v\`` : "") +
    ". A handler reads its own writes at once. `node tools/codemod-mutable.ts <file>` converts a file.";
  return { kind: "invalid", code: DiagnosticCode.UnknownHook, message, call: init };
}

/**
 * `const timer = useRef(0)`: `useRef` is replaced by `useMutable` (docs/MUTABLE_STATE_FOLLOWUPS.md). Reported with the conversion
 * written out in the author's names; null if the statement is not a `useRef` call at all.
 */
export function matchUseRefStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useRef") return null;
  const name = isIdentifier(declaration.name) ? declaration.name.text : "value";
  const initial = init.arguments[0]?.getText() ?? "…";
  const message =
    `\`useRef\` is replaced by \`useMutable\`: a value that persists and never renders is a field the JSX does not read: \`const s = useMutable({ ${name}: ${initial} })\`, ` +
    `read and written as \`s.${name}\` where \`${name}.current\` was. A render only redoes what reads a changed field, so such a field costs a comparison, not a redraw. ` +
    "`node tools/codemod-mutable.ts <file>` converts a file.";
  return { kind: "invalid", code: DiagnosticCode.UnknownHook, message, call: init };
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
  if (!init || !isCallExpression(init)) return null;
  // `useGame(…)`, or one of the spellings the destructuring split writes: `useGame.$actions(…)` (from `useGame.actions()`) and
  // `useGame.$whole(…)` (a name picked from `(s) => s`).
  const callee = init.expression;
  const marked = isPropertyAccessExpression(callee) && isIdentifier(callee.expression) && /^\$(actions|whole\d+)$/.test(callee.name.text);
  const storeIdentifier = marked ? (callee as { expression: Node }).expression : callee;
  if (!isIdentifier(storeIdentifier) || !storeNames.has(storeIdentifier.text)) return null;
  const storeName = storeIdentifier.text;
  const mark = marked ? (callee as { name: { text: string } }).name.text : "";
  const via: UseStoreCallAnalysis["via"] = !marked ? "select" : mark === "$actions" ? "actions" : "whole";
  const group = via === "whole" ? Number(mark.slice("$whole".length)) : null;
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
    if (path !== null && path.length === 0) return `'${valueName}' selects the whole state: select a path (\`(${parameter}) => ${parameter}.player\`), destructure values from one, or take actions with \`const { collect } = ${storeName}.actions()\`.`;
    return { kind: "useStore", storeName, valueName, path: path ?? [], body: path === null ? expression : null, parameter, selector: at, call: init, declaration, via, group };
  };

  // Destructuring (`const { gold, lives } = useGame((s) => s.battle)`) was split into one selector per name before this (hooks/inline.ts).
  if (!isIdentifier(declaration.name)) return invalid(`${storeName}(…) binds one plain name: \`${example}\``);
  const one = read(declaration.name.text, body, selector);
  return typeof one === "string" ? invalid(one) : { kind: "ok", hooks: [one] };
}

/** Recognises `const s = useMutable({ a: 0, b: 0 })` (optionally `useMutable<{ a: number; b: number }>({ … })`); null if the statement is not one. */
export function matchMutableStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useMutable") return null;
  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code: DiagnosticCode.InvalidUseState, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0 || !isIdentifier(declaration.name)) return invalid("useMutable must be bound with a plain `const` name: `const s = useMutable({ x: 0 })`.");
  const arg = init.arguments[0] ? unwrapParens(init.arguments[0]) : undefined;
  if (init.arguments.length !== 1 || !arg || !isObjectLiteralExpression(arg)) return invalid("useMutable takes one object literal of initial values: `const s = useMutable({ x: 0, y: 0 })`.");
  const typeArgument = init.typeArguments?.[0];
  const typed = typeArgument && isTypeLiteralNode(typeArgument) ? typeArgument : null;
  const fields: { name: string; initializer: Expression; typeNode: Node | null }[] = [];
  for (const property of arg.properties) {
    if (!isPropertyAssignment(property) || !isIdentifier(property.name)) return invalid("useMutable's fields are written `name: value`, with plain names (no shorthand, spreads or computed keys).");
    const key = property.name.text;
    const member = typed?.members.map((m) => m as unknown as { kind: SyntaxKind; name?: Node; type?: Node }).find((m) => m.kind === SyntaxKind.PropertySignature && m.name !== undefined && isIdentifier(m.name) && m.name.text === key);
    // `enemies: [] as readonly Foe[]`: the field's type, where the value alone does not say it.
    const written = unwrapParens(property.initializer);
    const asserted = isAsExpression(written) && !(isTypeReferenceNode(written.type) && isIdentifier(written.type.typeName) && written.type.typeName.text === "const");
    fields.push({ name: key, initializer: asserted ? written.expression : property.initializer, typeNode: member?.type ?? (asserted ? written.type : null) });
  }
  if (fields.length === 0) return invalid("useMutable needs at least one field.");
  return { kind: "ok", hooks: [{ kind: "useMutable", name: declaration.name.text, fields, call: init, declaration }] };
}

/** Recognises `const play = useSound("a.wav")`; null if the statement is not one. */
export function matchHandleStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression)) return null;
  const hook = init.expression.text;
  if (hook !== "useSound") return null;

  const code = DiagnosticCode.InvalidUseSound;
  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0 || !isIdentifier(declaration.name)) {
    return invalid(`${hook} must be bound with a plain \`const\` name: \`const handle = ${hook}(...)\`.`);
  }
  const name = declaration.name.text;
  const analysis: UseSoundCallAnalysis = { kind: "useSound", name, arguments: init.arguments, call: init, declaration };
  return { kind: "ok", hooks: [analysis] };
}

/** Recognises `const theme = useContext(Theme)` and `const { accent } = useContext(Theme)`; null if the statement is not one. */
export function matchContextStatement(statement: Statement): StatementMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useContext") return null;
  const invalid = (message: string): StatementMatch => ({ kind: "invalid", code: DiagnosticCode.InvalidUseState, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0) return invalid("useContext must be bound with `const`: `const theme = useContext(Theme)`.");
  if (init.arguments.length !== 1) return invalid("useContext takes one context, made with `createContext` in a `.ts` file: `useContext(Theme)`.");
  const context = init.arguments[0]!;
  if (isIdentifier(declaration.name)) {
    return { kind: "ok", hooks: [{ kind: "useContext", name: declaration.name.text, entries: null, context, call: init, declaration }] };
  }
  if (isObjectBindingPattern(declaration.name)) {
    const entries: { name: string; key: string }[] = [];
    for (const element of declaration.name.elements) {
      const key = element.propertyName === undefined ? (element.name && isIdentifier(element.name) ? element.name.text : null) : isIdentifier(element.propertyName) ? element.propertyName.text : null;
      if (element.dotDotDotToken || element.initializer || !element.name || !isIdentifier(element.name) || key === null) {
        return invalid("Each value picked from useContext is a plain name: `const { accent, text: ink } = useContext(Theme)`.");
      }
      entries.push({ name: element.name.text, key });
    }
    return { kind: "ok", hooks: [{ kind: "useContext", name: null, entries, context, call: init, declaration }] };
  }
  return invalid("useContext is bound to a name or `{ a, b }`: `const theme = useContext(Theme)`.");
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
