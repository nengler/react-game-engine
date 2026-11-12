// Analysis of one component and of the props it declares, and of its named imports.
import { SyntaxKind, type CallExpression, type Block, type Expression, type NodeArray, type ParameterDeclaration, type ImportDeclaration, type JsxSelfClosingElement, type Node, type Statement } from "typescript/ast";
import { isBinaryExpression, isConditionalExpression, isBlock, isJsxFragment, isCallExpression, isIdentifier, isNamedImports, isObjectBindingPattern, isTypeReferenceNode, isJsxElement, isJsxSelfClosingElement, isReturnStatement } from "typescript/ast/is";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { spanOf } from "../parser/parser.ts";
import { type ImportAnalysis, type JsxRoot, type PropsAnalysis, type PropBindingAnalysis, type ComponentAnalysis, type HookCallAnalysis, HOOK_NAME, KNOWN_HOOKS } from "./model.ts";
import { unwrapParens, visit } from "./util.ts";
import { matchUseStateStatement, matchRenderConst, matchStoreStatement, matchHandleStatement, matchHandlerStatement, type StatementMatch } from "./matchers.ts";



/** What the analyzer reads from a component, whether it is a function declaration or an arrow assigned to a `const`. */
interface ComponentFunction {
  readonly name: string;
  /** The node spans point at: the declaration, or the variable declaration of an arrow. */
  readonly node: Node;
  readonly parameters: NodeArray<ParameterDeclaration>;
  /** A block, or (for an arrow) the returned expression itself. */
  readonly body: Block | Expression | undefined;
  readonly exported: boolean;
  readonly isDefault: boolean;
}

/**
 * `import { A, B } from "module"`: named imports, no namespace, `type` or `as`
 * forms. A component module may also be imported by its default export
 * (`import Enemy from "./Enemy.tsx"`, optionally with named imports too).
 */
export function analyzeNamedImport(
  statement: ImportDeclaration,
  module: string,
  imports: ImportAnalysis[],
  diagnostics: CompilerDiagnostic[],
  span: (node: Node) => ReturnType<typeof spanOf>,
  what: string,
  example: string,
  allowDefault = false,
  allowTypeSpecifiers = false,
): void {
  const clause = statement.importClause;
  const bindings = clause?.namedBindings;
  const wellFormed = clause && (clause.name ? allowDefault : true) && (bindings ? isNamedImports(bindings) : clause.name !== undefined);
  if (!clause || !wellFormed) {
    // A component file only declares; code that runs when a module loads (`registerTilemaps(…)`) belongs to a plain .ts file.
    const sideEffect = !clause
      ? ` To run a module for what it does when loaded (registering maps, say), import it from a plain .ts file the components use, such as the game state (\`import "./tilemaps.ts";\` in GameState.ts), or from the game's entry (game.ts).`
      : "";
    diagnostics.push(
      error(DiagnosticCode.UnsupportedSyntax, `${what} must name what they import: \`${example}\` (no side-effect${allowDefault ? "" : ", default"} or namespace imports).${sideEffect}`, span(statement)),
    );
    return;
  }
  // `import type {…}` (and the `defer` / `source` phases) carry a phase modifier on the whole clause. Where types may be
  // imported, `import type { Tower }` is every name as a type.
  const typeClause = clause.phaseModifier === SyntaxKind.TypeKeyword && allowTypeSpecifiers && !clause.name && module.endsWith(".ts");
  if (clause.phaseModifier !== undefined && !typeClause) {
    diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(statement)));
    return;
  }
  if (clause.name) imports.push({ name: clause.name.text, isDefault: true, isTypeOnly: false, module, node: clause });
  if (bindings && isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      const typeOnly = typeClause || element.isTypeOnly;
      // A type may be renamed (`type Tower as TowerData`): the generated module imports it the same way.
      if ((element.isTypeOnly && !allowTypeSpecifiers) || (element.propertyName && !(typeOnly && allowTypeSpecifiers && module.endsWith(".ts")))) {
        diagnostics.push(
          error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(element)),
        );
        continue;
      }
      const importedName = element.propertyName && isIdentifier(element.propertyName) ? element.propertyName.text : undefined;
      imports.push({ name: element.name.text, isDefault: false, isTypeOnly: typeOnly, module, node: element, ...(importedName !== undefined ? { importedName } : {}) });
    }
  }
}

/**
 * A component takes at most one parameter, annotated with the name of a props
 * type declared in the same file: destructured, defaults allowed
 * (`function Enemy({ speed = 1, onDefeated }: EnemyProps)`), or a plain
 * object read as `props.speed` (`function Enemy(props: EnemyProps)`).
 */
function analyzeProps(
  fn: ComponentFunction,
  span: (node: Node) => ReturnType<typeof spanOf>,
  diagnostics: CompilerDiagnostic[],
): PropsAnalysis | null {
  const name = fn.name;
  const invalid = (message: string, at: Node): null => {
    diagnostics.push(error(DiagnosticCode.InvalidProps, `Component '${name}': ${message}`, span(at)));
    return null;
  };
  const [param, ...extra] = fn.parameters;
  if (!param) return null;
  if (extra.length > 0) return invalid("a component takes one props parameter.", extra[0]!);
  if (param.dotDotDotToken || param.initializer || param.questionToken) {
    return invalid("the props parameter must be a plain name or destructuring, without a rest, default or `?`.", param);
  }
  const type = param.type;
  if (!type || !isTypeReferenceNode(type) || !isIdentifier(type.typeName) || type.typeArguments) {
    return invalid("annotate the props parameter with the name of a props type declared in this file: `({ speed }: EnemyProps)`.", type ?? param);
  }
  if (isIdentifier(param.name)) {
    return { typeName: type.typeName.text, typeNode: type, bindings: [], objectName: param.name.text };
  }
  if (!isObjectBindingPattern(param.name)) {
    return invalid("destructure the props in the parameter (`{ speed }: EnemyProps`) or take them as one object (`props: EnemyProps`).", param.name);
  }
  const bindings: PropBindingAnalysis[] = [];
  for (const element of param.name.elements) {
    if (element.dotDotDotToken || element.propertyName || !element.name || !isIdentifier(element.name)) {
      invalid("props are destructured by plain name: no rest (`...rest`), renaming (`a: b`) or nesting.", element);
      continue;
    }
    bindings.push({ name: element.name.text, defaultValue: element.initializer ?? null, node: element });
  }
  return { typeName: type.typeName.text, typeNode: type, bindings, objectName: null };
}

/** What a component may return: an element or fragment, `null`, or `cond ? <A /> : <B />` / `cond && <A />` (a branch may be `null`). */
function isRoot(node: Expression): node is JsxRoot {
  const jsx = (n: Node): boolean => isJsxElement(n) || isJsxSelfClosingElement(n) || isJsxFragment(n);
  if (jsx(node) || node.kind === SyntaxKind.NullKeyword) return true;
  if (isConditionalExpression(node)) {
    const branches = [unwrapParens(node.whenTrue), unwrapParens(node.whenFalse)];
    return branches.some(jsx) && branches.every((b) => jsx(b) || b.kind === SyntaxKind.NullKeyword);
  }
  return isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken && jsx(unwrapParens(node.right));
}

export function analyzeComponent(
  fn: ComponentFunction,
  span: (node: Node) => ReturnType<typeof spanOf>,
  diagnostics: CompilerDiagnostic[],
  storeNames: ReadonlySet<string>,
): ComponentAnalysis | null {
  const { name, node: declaration, body } = fn;
  if (!body) {
    diagnostics.push(error(DiagnosticCode.InvalidComponentBody, `Component '${name}' has no body.`, span(declaration)));
    return null;
  }
  const props = analyzeProps(fn, span, diagnostics);
  // An arrow with an expression body (`() => <Entity />`) is just its return; it cannot hold hooks.
  const expressionBody = isBlock(body) ? null : body;
  const mustReturn = `Component '${name}' must end by returning an element, a fragment, a condition of them (\`open ? <Menu /> : null\`, \`open && <Menu />\`) or \`null\`: \`return <Entity>…</Entity>;\``;

  const hooks: HookCallAnalysis[] = [];
  const acceptedHookCalls = new Set<CallExpression>();
  let jsx: JsxRoot | null = null;

  const statements: readonly Statement[] = isBlock(body) ? body.statements : [];
  // Tried in order; the first that recognises a statement owns it.
  const matchers: readonly ((statement: Statement) => StatementMatch | null)[] = [
    (statement) => matchStoreStatement(statement, storeNames),
    matchUseStateStatement,
    matchHandleStatement,
    matchHandlerStatement,
  ];
  if (expressionBody) {
    const returned = unwrapParens(expressionBody);
    if (isRoot(returned)) jsx = returned;
    else diagnostics.push(error(DiagnosticCode.InvalidComponentBody, mustReturn, span(expressionBody)));
  }
  statements.forEach((statement, index) => {
    const isLast = index === statements.length - 1;
    if (isLast && isReturnStatement(statement)) {
      const returned = statement.expression ? unwrapParens(statement.expression) : undefined;
      if (returned && isRoot(returned)) {
        jsx = returned;
      } else {
        diagnostics.push(error(DiagnosticCode.InvalidComponentBody, mustReturn, span(statement)));
      }
      return;
    }
    const matched = matchers.reduce<StatementMatch | null>((found, match) => found ?? match(statement), null);
    if (matched) {
      if (matched.kind === "ok") {
        hooks.push(...matched.hooks);
        for (const hook of matched.hooks) if (hook.kind !== "const") acceptedHookCalls.add(hook.call);
      } else {
        diagnostics.push(error(matched.code, matched.message, span(statement)));
        if (matched.call) acceptedHookCalls.add(matched.call);
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
        `Component '${name}': only \`const [value, setValue] = useState(...)\`, \`const r = useRef<T>()\`, \`const play = useSound("a.wav")\`, \`const name = expression\` (derived values), handler statements (\`useUpdate(...)\`, \`useInput(...)\`, \`useMount(...)\`, \`useUnmount(...)\`) and a final \`return\` are supported.`,
        span(statement),
      ),
    );
  });

  // Any other hook-shaped call anywhere in the body is misplaced or unknown.
  visit(body, (node) => {
    if (!isCallExpression(node) || acceptedHookCalls.has(node)) return;
    const callee = node.expression;
    if (!isIdentifier(callee) || !(HOOK_NAME.test(callee.text) || storeNames.has(callee.text))) return;
    if (storeNames.has(callee.text)) {
      diagnostics.push(
        error(DiagnosticCode.HookNotAtTopLevel, `'${callee.text}' (the game state) must be called at the top level of a component: \`const hp = ${callee.text}((s) => s.player.hp);\`.`, span(node)),
      );
    } else if (callee.text === "useTransform") {
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
    if (!expressionBody && !statements.some((s) => isReturnStatement(s))) {
      diagnostics.push(error(DiagnosticCode.InvalidComponentBody, mustReturn, span(declaration)));
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
    exported: fn.exported,
    isDefault: fn.isDefault,
    hooks,
    props,
    jsx: root,
    jsxTags,
  };
}
