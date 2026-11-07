import {
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type JsxElement,
  type JsxSelfClosingElement,
  type Node,
  type SourceFile,
  type Statement,
  type VariableDeclaration,
} from "typescript/ast";
import {
  isArrayBindingPattern,
  isCallExpression,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
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
  readonly diagnostics: readonly CompilerDiagnostic[];
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
export type HookCallAnalysis = UseStateCallAnalysis;

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
const KNOWN_HOOKS = new Set(["useState"]);

/**
 * @param fileName Name used in spans and diagnostics. Defaults to the parsed
 * file's (absolute, normalised) name.
 */
export function analyzeSourceFile(sourceFile: SourceFile, fileName: string = sourceFile.fileName): SourceAnalysis {
  const diagnostics: CompilerDiagnostic[] = [];
  const components: ComponentAnalysis[] = [];
  const span = (node: Node) => spanOf(node, sourceFile, fileName);

  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) continue; // imports (e.g. of useState / intrinsics) are authoring-only
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

  return { fileName, sourceFile, components, diagnostics };
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
    diagnostics.push(
      error(
        DiagnosticCode.InvalidComponentBody,
        `Component '${name}': only \`const [value, setValue] = useState(...)\` statements and a final \`return\` are supported.`,
        span(statement),
      ),
    );
  });

  // Any other hook-shaped call anywhere in the body is misplaced or unknown.
  visit(body, (node) => {
    if (!isCallExpression(node) || acceptedHookCalls.has(node)) return;
    const callee = node.expression;
    if (!isIdentifier(callee) || !HOOK_NAME.test(callee.text)) return;
    if (KNOWN_HOOKS.has(callee.text)) {
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
