// Recognisers for the statements of a component body: state, render constants, stores, refs, sounds and handlers.
import { NodeFlags, type CallExpression, type Node, type Statement } from "typescript/ast";
import { isArrayBindingPattern, isArrowFunction, isBlock, isExpressionStatement, isCallExpression, isIdentifier, isPropertyAccessExpression, isVariableStatement } from "typescript/ast/is";
import { DiagnosticCode } from "../diagnostics/diagnostics.ts";
import { type UseStoreCallAnalysis, type RenderConstAnalysis, type UseRefCallAnalysis, type UseSoundCallAnalysis, type HandlerCallAnalysis, type UseStateCallAnalysis, HANDLER_HOOKS, REMOVED_HOOKS } from "./model.ts";
import { unwrapParens } from "./util.ts";



type UseStateMatch =
  | { readonly kind: "ok"; readonly hook: UseStateCallAnalysis }
  | { readonly kind: "invalid"; readonly message: string; readonly call: CallExpression };

/** Recognises `const [value, setValue] = useState(init)`; returns null if the statement is not a useState call at all. */
export function matchUseStateStatement(statement: Statement): UseStateMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "useState") return null;

  const invalid = (message: string): UseStateMatch => ({ kind: "invalid", message, call: init });
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

  return {
    kind: "ok",
    hook: {
      kind: "useState",
      valueName,
      setterName: names[1] ?? null,
      initializer: init.arguments[0] ?? null,
      typeArgument: init.typeArguments?.[0] ?? null,
      call: init,
      declaration,
    },
  };
}

/** `const name = expression;` that is not a hook call (hooks are matched first). */
export function matchRenderConst(statement: Statement): RenderConstAnalysis | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if ((list.flags & NodeFlags.Const) === 0 || list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  if (!isIdentifier(declaration.name) || !declaration.initializer) return null;
  return { kind: "const", name: declaration.name.text, initializer: declaration.initializer, declaration };
}

type StoreMatch =
  | { readonly kind: "ok"; readonly hook: UseStoreCallAnalysis }
  | { readonly kind: "invalid"; readonly message: string; readonly call: CallExpression };

/** Recognises `const hp = useGame((s) => s.player.hp)` on an imported store; null if the statement is not a call of one. */
export function matchStoreStatement(statement: Statement, storeNames: ReadonlySet<string>): StoreMatch | null {
  if (storeNames.size === 0 || !isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || !storeNames.has(init.expression.text)) return null;
  const storeName = init.expression.text;
  const invalid = (message: string): StoreMatch => ({ kind: "invalid", message, call: init });
  const example = `const hp = ${storeName}((s) => s.player.hp);`;
  if ((list.flags & NodeFlags.Const) === 0) return invalid(`${storeName}(…) must be bound with \`const\`: \`${example}\``);
  if (!isIdentifier(declaration.name)) return invalid(`${storeName}(…) binds one plain name: \`${example}\``);
  const selector = init.arguments[0] ? unwrapParens(init.arguments[0]) : undefined;
  if (init.arguments.length !== 1 || !selector || !isArrowFunction(selector) || selector.parameters.length !== 1 || !isIdentifier(selector.parameters[0]!.name) || init.typeArguments?.length) {
    return invalid(`${storeName} takes one selector, an arrow with one parameter: \`${example}\``);
  }
  const parameter = (selector.parameters[0]!.name as { text: string }).text;
  const path: string[] = [];
  let at: Node = isBlock(selector.body) ? selector.body : unwrapParens(selector.body);
  while (isPropertyAccessExpression(at)) {
    path.unshift(at.name.text);
    at = unwrapParens(at.expression);
  }
  if (!isIdentifier(at) || (at as { text: string }).text !== parameter || path.length === 0) {
    return invalid(`The selector must be a plain path from its parameter, like \`(${parameter}) => ${parameter}.player.hp\`: the compiler subscribes the component to exactly that path.`);
  }
  return { kind: "ok", hook: { kind: "useStore", storeName, valueName: declaration.name.text, path, selector, call: init, declaration } };
}

type HandleMatch =
  | { readonly kind: "ok"; readonly hook: UseRefCallAnalysis | UseSoundCallAnalysis }
  | { readonly kind: "invalid"; readonly code: typeof DiagnosticCode.InvalidUseRef | typeof DiagnosticCode.InvalidUseSound; readonly message: string; readonly call: CallExpression };

/** Recognises `const r = useRef<T>()` and `const play = useSound("a.wav")`; null if the statement is not one. */
export function matchHandleStatement(statement: Statement): HandleMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression)) return null;
  const hook = init.expression.text;
  if (hook !== "useRef" && hook !== "useSound") return null;

  const code = hook === "useSound" ? DiagnosticCode.InvalidUseSound : DiagnosticCode.InvalidUseRef;
  const invalid = (message: string): HandleMatch => ({ kind: "invalid", code, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0 || !isIdentifier(declaration.name)) {
    return invalid(`${hook} must be bound with a plain \`const\` name: \`const handle = ${hook}(...)\`.`);
  }
  const name = declaration.name.text;
  if (hook === "useSound") return { kind: "ok", hook: { kind: "useSound", name, arguments: init.arguments, call: init, declaration } };
  return { kind: "ok", hook: { kind: "useRef", name, typeArgument: init.typeArguments?.[0] ?? null, arguments: init.arguments, call: init, declaration } };
}

type HandlerMatch =
  | { readonly kind: "ok"; readonly hook: HandlerCallAnalysis }
  | { readonly kind: "invalid"; readonly code: DiagnosticCode; readonly message: string; readonly call: CallExpression | null };

/** Recognises `useUpdate(arrow)`, `useInput(arrow)`, `useMount(arrow)` and `useUnmount(arrow)`; null if the statement is not a call to one of them. */
export function matchHandlerStatement(statement: Statement): HandlerMatch | null {
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
  return { kind: "ok", hook: { kind: name, handler, call, statement } };
}
