import {
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  type CallExpression,
  type ArrowFunction,
  type Expression,
  type FunctionDeclaration,
  type ImportDeclaration,
  type JsxElement,
  type JsxSelfClosingElement,
  type Node,
  type SourceFile,
  type Statement,
  type VariableDeclaration,
} from "typescript/ast";
import {
  isArrayBindingPattern,
  isArrowFunction,
  isExpressionStatement,
  isCallExpression,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
  isJsxElement,
  isJsxSelfClosingElement,
  isParenthesizedExpression,
  isReturnStatement,
  isVariableStatement,
} from "typescript/ast/is";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { spanOf } from "../parser/parser.ts";

/**
 * Source-level understanding of a file: which functions are components, which
 * hooks they declare, and what JSX they return. Still references AST nodes; the
 * transform stage lowers this into IR.
 */
export interface SourceAnalysis {
  readonly fileName: string;
  readonly sourceFile: SourceFile;
  readonly components: readonly ComponentAnalysis[];
  /** Components imported from other `.tsx` files, by the name they have in this file. */
  readonly imports: readonly ImportAnalysis[];
  /** Hooks, built-in elements and runtime functions imported from the authoring module. Validated in the transform, which has the runtime manifest. */
  readonly authoringImports: readonly ImportAnalysis[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/** `import { Name } from "./Name.tsx"` (a component in another source file) or `import { useState } from "@rge/runtime/jsx"`. */
export interface ImportAnalysis {
  readonly name: string;
  /** The specifier as written, e.g. `./WarningIcon.tsx`. */
  readonly module: string;
  readonly node: Node;
}

export type JsxRoot = JsxElement | JsxSelfClosingElement;

export interface ComponentAnalysis {
  readonly name: string;
  readonly declaration: FunctionDeclaration;
  readonly exported: boolean;
  /** Hook calls at the top level of the component, in source order. */
  readonly hooks: readonly HookCallAnalysis[];
  /** The JSX expression returned by the component. */
  readonly jsx: JsxRoot;
  /** Every element tag referenced in the returned JSX, in first-use order. */
  readonly jsxTags: readonly string[];
}

/** Future hooks become additional variants. */
export type HookCallAnalysis = UseStateCallAnalysis | UseRefCallAnalysis | HandlerCallAnalysis | RenderConstAnalysis;

/**
 * `const hurt = health < 25;` in the component body: a value derived from
 * state, as in a React render. Not a hook, but kept in the same ordered list
 * because it may only read what is declared above it.
 */
export interface RenderConstAnalysis {
  readonly kind: "const";
  readonly name: string;
  readonly initializer: Expression;
  readonly declaration: VariableDeclaration;
}

/** `const r = useRef<Sprite>()`. */
export interface UseRefCallAnalysis {
  readonly kind: "useRef";
  readonly name: string;
  readonly typeArgument: Node | null;
  readonly arguments: readonly Expression[];
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** `useUpdate(() => ...)` / `useInput(...)` / `onCollisionEnter(...)` as a top-level statement. */
export interface HandlerCallAnalysis {
  readonly kind: "useUpdate" | "useInput" | "onCollisionEnter";
  readonly handler: ArrowFunction;
  readonly call: CallExpression;
  readonly statement: Statement;
}

export interface UseStateCallAnalysis {
  readonly kind: "useState";
  readonly valueName: string;
  readonly setterName: string | null;
  readonly initializer: Expression | null;
  readonly typeArgument: Node | null;
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

const HOOK_NAME = /^use[A-Z0-9]/;
const KNOWN_HOOKS = new Set(["useState", "useRef", "useUpdate", "useInput"]);
/** `onCollisionEnter` stays a hook until it becomes a prop on `<Collider>` (M4). */
const HANDLER_HOOKS = new Set(["useUpdate", "useInput", "onCollisionEnter"]);
/** Every hook the compiler understands, i.e. the hook names the authoring module must export. */
export const AUTHORING_HOOKS: readonly string[] = [...KNOWN_HOOKS, ...HANDLER_HOOKS].filter((name, i, all) => all.indexOf(name) === i);
/** Earlier names of the per-frame hooks, reported with their replacement. */
const RENAMED_HOOKS: Readonly<Record<string, string>> = { onUpdate: "useUpdate", onInput: "useInput" };

/**
 * @param fileName Name used in spans and diagnostics. Defaults to the parsed
 * file's (absolute, normalised) name.
 * @param authoringModule The module hooks, built-ins and runtime functions are
 * imported from (the runtime manifest's `authoringModule`). Without it, only
 * component imports are accepted.
 */
export function analyzeSourceFile(
  sourceFile: SourceFile,
  fileName: string = sourceFile.fileName,
  authoringModule: string | null = null,
): SourceAnalysis {
  const diagnostics: CompilerDiagnostic[] = [];
  const components: ComponentAnalysis[] = [];
  const imports: ImportAnalysis[] = [];
  const authoringImports: ImportAnalysis[] = [];
  const span = (node: Node) => spanOf(node, sourceFile, fileName);

  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      // Two kinds of import are understood: components from relative `.tsx` files, and hooks, built-ins and
      // runtime functions from the authoring module. Anything else would be silently dropped, so it is an error.
      const specifier = isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      if (specifier !== null && /^\.\.?\/.*\.tsx$/.test(specifier)) {
        analyzeNamedImport(statement, specifier, imports, diagnostics, span, "Component imports", `import { Name } from "${specifier}"`);
      } else if (specifier !== null && specifier === authoringModule) {
        analyzeNamedImport(statement, specifier, authoringImports, diagnostics, span, "Imports from the authoring module", `import { useState, Entity } from "${specifier}"`);
      } else {
        diagnostics.push(
          error(
            DiagnosticCode.UnsupportedSyntax,
            `Import of ${specifier === null ? "this module" : `"${specifier}"`} is not supported: component source imports components from "./Name.tsx"${authoringModule ? ` and hooks and built-in elements from "${authoringModule}"` : ""}.`,
            span(statement),
          ),
        );
      }
      continue;
    }
    if (isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text)) {
      const component = analyzeComponent(statement, statement.name.text, span, diagnostics);
      if (component) components.push(component);
      continue;
    }
    diagnostics.push(
      error(
        DiagnosticCode.UnsupportedSyntax,
        "Only imports and component function declarations (capitalised `function Name() {}`) are supported at the top level.",
        span(statement),
      ),
    );
  }

  return { fileName, sourceFile, components, imports, authoringImports, diagnostics };
}

/** `import { A, B } from "module"`: named imports only, no default, namespace, `type` or `as` forms. */
function analyzeNamedImport(
  statement: ImportDeclaration,
  module: string,
  imports: ImportAnalysis[],
  diagnostics: CompilerDiagnostic[],
  span: (node: Node) => ReturnType<typeof spanOf>,
  what: string,
  example: string,
): void {
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  if (!clause || clause.name || !bindings || !isNamedImports(bindings)) {
    diagnostics.push(
      error(DiagnosticCode.UnsupportedSyntax, `${what} must name what they import: \`${example}\` (no side-effect, default or namespace imports).`, span(statement)),
    );
    return;
  }
  // `import type {…}` (and the `defer` / `source` phases) carry a phase modifier on the whole clause.
  if (clause.phaseModifier !== undefined) {
    diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(statement)));
    return;
  }
  for (const element of bindings.elements) {
    if (element.isTypeOnly || element.propertyName) {
      diagnostics.push(
        error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(element)),
      );
      continue;
    }
    imports.push({ name: element.name.text, module, node: element });
  }
}

function analyzeComponent(
  declaration: FunctionDeclaration,
  name: string,
  span: (node: Node) => ReturnType<typeof spanOf>,
  diagnostics: CompilerDiagnostic[],
): ComponentAnalysis | null {
  const body = declaration.body;
  if (!body) {
    diagnostics.push(error(DiagnosticCode.InvalidComponentBody, `Component '${name}' has no body.`, span(declaration)));
    return null;
  }
  if (declaration.parameters.length > 0) {
    diagnostics.push(
      error(DiagnosticCode.UnsupportedSyntax, `Component '${name}': props are not supported yet.`, span(declaration.parameters[0]!)),
    );
  }

  const hooks: HookCallAnalysis[] = [];
  const acceptedHookCalls = new Set<CallExpression>();
  let jsx: JsxRoot | null = null;

  const statements = body.statements;
  statements.forEach((statement, index) => {
    const isLast = index === statements.length - 1;
    if (isLast && isReturnStatement(statement)) {
      const returned = statement.expression ? unwrapParens(statement.expression) : undefined;
      if (returned && (isJsxElement(returned) || isJsxSelfClosingElement(returned))) {
        jsx = returned;
      } else {
        diagnostics.push(
          error(DiagnosticCode.InvalidComponentBody, `Component '${name}' must end with \`return <Entity>...</Entity>\`.`, span(statement)),
        );
      }
      return;
    }
    const hook = matchUseStateStatement(statement);
    if (hook) {
      if (hook.kind === "ok") {
        hooks.push(hook.hook);
        acceptedHookCalls.add(hook.hook.call);
      } else {
        diagnostics.push(error(DiagnosticCode.InvalidUseState, hook.message, span(statement)));
        acceptedHookCalls.add(hook.call);
      }
      return;
    }
    const handle = matchHandleStatement(statement);
    if (handle) {
      if (handle.kind === "ok") {
        hooks.push(handle.hook);
        acceptedHookCalls.add(handle.hook.call);
      } else {
        diagnostics.push(error(handle.code, handle.message, span(statement)));
        acceptedHookCalls.add(handle.call);
      }
      return;
    }
    const handler = matchHandlerStatement(statement);
    if (handler) {
      if (handler.kind === "ok") {
        hooks.push(handler.hook);
        acceptedHookCalls.add(handler.hook.call);
      } else {
        diagnostics.push(error(handler.code, handler.message, span(statement)));
        if (handler.call) acceptedHookCalls.add(handler.call);
      }
      return;
    }
    const derived = matchRenderConst(statement);
    if (derived) {
      hooks.push(derived);
      return;
    }
    diagnostics.push(
      error(
        DiagnosticCode.InvalidComponentBody,
        `Component '${name}': only \`const [value, setValue] = useState(...)\`, \`const r = useRef<T>()\`, \`const name = expression\` (derived values), handler statements (\`useUpdate(...)\`, \`useInput(...)\`, \`onCollisionEnter(...)\`) and a final \`return\` are supported.`,
        span(statement),
      ),
    );
  });

  // Any other hook-shaped call anywhere in the body is misplaced or unknown.
  visit(body, (node) => {
    if (!isCallExpression(node) || acceptedHookCalls.has(node)) return;
    const callee = node.expression;
    if (!isIdentifier(callee) || !HOOK_NAME.test(callee.text)) return;
    if (callee.text === "useTransform") {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownHook,
          "useTransform was removed: keep position in state and set it with the `transform={{ x, y }}` attribute on an <Entity>.",
          span(node),
        ),
      );
    } else if (KNOWN_HOOKS.has(callee.text)) {
      diagnostics.push(
        error(DiagnosticCode.HookNotAtTopLevel, `Hook '${callee.text}' must be called at the top level of a component.`, span(node)),
      );
    } else {
      diagnostics.push(error(DiagnosticCode.UnknownHook, `Unknown hook '${callee.text}'.`, span(node)));
    }
  });

  if (jsx === null) {
    if (!statements.some((s) => isReturnStatement(s))) {
      diagnostics.push(
        error(DiagnosticCode.InvalidComponentBody, `Component '${name}' must end with \`return <Entity>...</Entity>\`.`, span(declaration)),
      );
    }
    return null;
  }

  const root: JsxRoot = jsx;
  const jsxTags: string[] = [];
  visit(root, (node) => {
    if (node.kind === SyntaxKind.JsxOpeningElement || node.kind === SyntaxKind.JsxSelfClosingElement) {
      const tag = (node as JsxSelfClosingElement).tagName;
      if (isIdentifier(tag) && !jsxTags.includes(tag.text)) jsxTags.push(tag.text);
    }
  });

  return {
    name,
    declaration,
    exported: (declaration.modifierFlags & ModifierFlags.Export) !== 0,
    hooks,
    jsx: root,
    jsxTags,
  };
}

type UseStateMatch =
  | { readonly kind: "ok"; readonly hook: UseStateCallAnalysis }
  | { readonly kind: "invalid"; readonly message: string; readonly call: CallExpression };

/** Recognises `const [value, setValue] = useState(init)`; returns null if the statement is not a useState call at all. */
function matchUseStateStatement(statement: Statement): UseStateMatch | null {
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
function matchRenderConst(statement: Statement): RenderConstAnalysis | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if ((list.flags & NodeFlags.Const) === 0 || list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  if (!isIdentifier(declaration.name) || !declaration.initializer) return null;
  return { kind: "const", name: declaration.name.text, initializer: declaration.initializer, declaration };
}

type HandleMatch =
  | { readonly kind: "ok"; readonly hook: UseRefCallAnalysis }
  | { readonly kind: "invalid"; readonly code: typeof DiagnosticCode.InvalidUseRef; readonly message: string; readonly call: CallExpression };

/** Recognises `const r = useRef<T>()`; null if the statement is not one. */
function matchHandleStatement(statement: Statement): HandleMatch | null {
  if (!isVariableStatement(statement)) return null;
  const list = statement.declarationList;
  if (list.declarations.length !== 1) return null;
  const declaration = list.declarations[0]!;
  const init = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
  if (!init || !isCallExpression(init) || !isIdentifier(init.expression)) return null;
  const hook = init.expression.text;
  if (hook !== "useRef") return null;

  const code = DiagnosticCode.InvalidUseRef;
  const invalid = (message: string): HandleMatch => ({ kind: "invalid", code, message, call: init });
  if ((list.flags & NodeFlags.Const) === 0 || !isIdentifier(declaration.name)) {
    return invalid(`${hook} must be bound with a plain \`const\` name: \`const handle = ${hook}(...)\`.`);
  }
  const name = declaration.name.text;
  return { kind: "ok", hook: { kind: "useRef", name, typeArgument: init.typeArguments?.[0] ?? null, arguments: init.arguments, call: init, declaration } };
}

type HandlerMatch =
  | { readonly kind: "ok"; readonly hook: HandlerCallAnalysis }
  | { readonly kind: "invalid"; readonly code: DiagnosticCode; readonly message: string; readonly call: CallExpression | null };

/** Recognises `useUpdate(arrow)`, `useInput(arrow)`, `onCollisionEnter(arrow)`; null if the statement is not a call to one of them. */
function matchHandlerStatement(statement: Statement): HandlerMatch | null {
  if (!isExpressionStatement(statement)) return null;
  const call = unwrapParens(statement.expression);
  if (!isCallExpression(call) || !isIdentifier(call.expression)) return null;
  const renamed = RENAMED_HOOKS[call.expression.text];
  if (renamed) {
    return { kind: "invalid", code: DiagnosticCode.UnknownHook, message: `'${call.expression.text}' was renamed to '${renamed}' (hooks start with \`use\`, as in React).`, call };
  }
  if (!HANDLER_HOOKS.has(call.expression.text)) return null;
  const name = call.expression.text as HandlerCallAnalysis["kind"];
  const handler = call.arguments.length === 1 ? unwrapParens(call.arguments[0]!) : undefined;
  if (!handler || !isArrowFunction(handler)) {
    return { kind: "invalid", code: DiagnosticCode.InvalidHandler, message: `${name} takes exactly one arrow function: \`${name}(() => { ... })\`.`, call };
  }
  return { kind: "ok", hook: { kind: name, handler, call, statement } };
}

export function unwrapParens(expression: Expression): Expression {
  let current = expression;
  while (isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** Pre-order walk. The callback's return value is ignored (forEachChild stops on truthy returns). */
function visit(node: Node, callback: (node: Node) => void): void {
  callback(node);
  node.forEachChild((child) => {
    visit(child, callback);
    return undefined;
  });
}
