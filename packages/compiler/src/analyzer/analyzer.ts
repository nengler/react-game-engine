import {
  ModifierFlags,
  NodeFlags,
  SyntaxKind,
  type CallExpression,
  type ArrowFunction,
  type Block,
  type Expression,
  type JsxFragment,
  type NodeArray,
  type ParameterDeclaration,
  type ImportDeclaration,
  type InterfaceDeclaration,
  type JsxElement,
  type JsxSelfClosingElement,
  type Node,
  type SourceFile,
  type Statement,
  type TypeAliasDeclaration,
  type VariableDeclaration,
} from "typescript/ast";
import {
  isArrayBindingPattern,
  isArrowFunction,
  isBlock,
  isExportAssignment,
  isJsxFragment,
  isExpressionStatement,
  isCallExpression,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedImports,
  isObjectBindingPattern,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  isStringLiteral,
  isJsxElement,
  isJsxSelfClosingElement,
  isParenthesizedExpression,
  isPropertyAccessExpression,
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
  /** Names imported from a relative `.ts` module: the project's game state (`import { useGame } from "./GameState.ts"`). Checked in the transform. */
  readonly storeImports: readonly ImportAnalysis[];
  /** Top-level `interface` / `type` declarations, which a component's props type names. */
  readonly typeDeclarations: readonly TypeDeclarationAnalysis[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/** `import { Name } from "./Name.tsx"` (a component in another source file) or `import { useState } from "@rge/runtime/jsx"`. */
export interface ImportAnalysis {
  readonly name: string;
  /** `import Enemy from "./Enemy.tsx"`: the module's default export, under a local name. */
  readonly isDefault: boolean;
  /** The specifier as written, e.g. `./WarningIcon.tsx`. */
  readonly module: string;
  /** `import { type Child } from "@rge/runtime/jsx"`: a type, erased from the output (allowed from the authoring module only). */
  readonly isTypeOnly: boolean;
  readonly node: Node;
}

/** Types the authoring module exports: written `import { type Child }`, never values. */
export const AUTHORING_TYPES: readonly string[] = ["Child"];

export type JsxRoot = JsxElement | JsxSelfClosingElement | JsxFragment;

/** `interface EnemyProps { … }` or `type EnemyProps = { … }`. The transform reads its members for the props. */
export interface TypeDeclarationAnalysis {
  readonly name: string;
  readonly node: InterfaceDeclaration | TypeAliasDeclaration;
  /** The declaration as written, without `export`. */
  readonly text: string;
}

/** A component's destructured props parameter: `function Enemy({ speed = 1, onDefeated }: EnemyProps)`. */
export interface PropsAnalysis {
  /** The name of the props type, resolved against the file's declarations in the transform. */
  readonly typeName: string;
  readonly typeNode: Node;
  /** `({ speed }: EnemyProps)`: each destructured prop. Empty for the object form. */
  readonly bindings: readonly PropBindingAnalysis[];
  /** `(props: EnemyProps)`: the name the whole props object is bound to, read as `props.speed`. Null when destructured. */
  readonly objectName: string | null;
}

export interface PropBindingAnalysis {
  readonly name: string;
  readonly defaultValue: Expression | null;
  readonly node: Node;
}

export interface ComponentAnalysis {
  readonly name: string;
  /** The function declaration, or the variable declaration of an arrow-function component. */
  readonly declaration: Node;
  readonly exported: boolean;
  /** `export default function Enemy() {}` or `export default Enemy;`. */
  readonly isDefault: boolean;
  /** Hook calls at the top level of the component, in source order. */
  readonly hooks: readonly HookCallAnalysis[];
  /** The destructured props parameter, or null for a component without props. */
  readonly props: PropsAnalysis | null;
  /** The JSX expression returned by the component. */
  readonly jsx: JsxRoot;
  /** Every element tag referenced in the returned JSX, in first-use order. */
  readonly jsxTags: readonly string[];
}

/**
 * `const hp = useGame((s) => s.player.hp)`: a read of one path of the game state, or (`useGame((s) => s.collect)`) a
 * binding of one action. The selector is a plain property path: that is all the compiler resolves.
 */
export interface UseStoreCallAnalysis {
  readonly kind: "useStore";
  /** The imported store the call is made on (`useGame`). */
  readonly storeName: string;
  readonly valueName: string;
  /** The selector's path: `["player", "hp"]`. */
  readonly path: readonly string[];
  /** The selector's parameter, and the path's node, for diagnostics. */
  readonly selector: Node;
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** Future hooks become additional variants. */
export type HookCallAnalysis = UseStoreCallAnalysis | UseStateCallAnalysis | UseRefCallAnalysis | UseSoundCallAnalysis | HandlerCallAnalysis | RenderConstAnalysis;

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

/** `const playHit = useSound("hit.wav")`. */
export interface UseSoundCallAnalysis {
  readonly kind: "useSound";
  readonly name: string;
  readonly arguments: readonly Expression[];
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration;
}

/** `useUpdate(() => ...)`, `useInput(...)`, `useMount(...)` or `useUnmount(...)` as a top-level statement. */
export interface HandlerCallAnalysis {
  readonly kind: "useUpdate" | "useInput" | "useMount" | "useUnmount";
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
const KNOWN_HOOKS = new Set(["useState", "useRef", "useSound", "useUpdate", "useInput", "useMount", "useUnmount"]);
const HANDLER_HOOKS = new Set(["useUpdate", "useInput", "useMount", "useUnmount"]);
/** Every hook the compiler understands, i.e. the hook names the authoring module must export. */
export const AUTHORING_HOOKS: readonly string[] = [...KNOWN_HOOKS, ...HANDLER_HOOKS].filter((name, i, all) => all.indexOf(name) === i);
/** Hooks that were renamed or replaced, reported with what to write instead. */
const REMOVED_HOOKS: Readonly<Record<string, string>> = {
  onUpdate: "'onUpdate' was renamed to 'useUpdate' (hooks start with `use`, as in React).",
  onInput: "'onInput' was renamed to 'useInput' (hooks start with `use`, as in React).",
  onCollisionEnter: "'onCollisionEnter' is no longer a hook: pass it to the collider, `<Collider width={16} height={24} onCollisionEnter={(other) => …} />`, so you know which collider was hit.",
};

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
  const storeImports: ImportAnalysis[] = [];
  const typeDeclarations: TypeDeclarationAnalysis[] = [];
  const defaultExports: { name: string; node: Node }[] = [];
  const span = (node: Node) => spanOf(node, sourceFile, fileName);

  // The names a relative `.ts` import binds, known before any component is read (imports may follow the components in source).
  const storeNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || !/^\.\.?\/.*\.ts$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && isNamedImports(bindings)) for (const element of bindings.elements) storeNames.add(element.name.text);
  }
  for (const statement of sourceFile.statements) {
    if (isImportDeclaration(statement)) {
      // Two kinds of import are understood: components from relative `.tsx` files, and hooks, built-ins and
      // runtime functions from the authoring module. Anything else would be silently dropped, so it is an error.
      const specifier = isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      if (specifier !== null && /^\.\.?\/.*\.tsx$/.test(specifier)) {
        analyzeNamedImport(statement, specifier, imports, diagnostics, span, "Component imports", `import { Name } from "${specifier}"`, true);
      } else if (specifier !== null && /^\.\.?\/.*\.ts$/.test(specifier)) {
        analyzeNamedImport(statement, specifier, storeImports, diagnostics, span, "Game state imports", `import { useGame } from "${specifier}"`, false);
      } else if (specifier !== null && specifier === authoringModule) {
        analyzeNamedImport(statement, specifier, authoringImports, diagnostics, span, "Imports from the authoring module", `import { useState, Entity, type Child } from "${specifier}"`, false, true);
      } else {
        diagnostics.push(
          error(
            DiagnosticCode.UnsupportedSyntax,
            `Import of ${specifier === null ? "this module" : `"${specifier}"`} is not supported: component source imports components from "./Name.tsx", the game state from "./GameState.ts"${authoringModule ? ` and hooks and built-in elements from "${authoringModule}"` : ""}.`,
            span(statement),
          ),
        );
      }
      continue;
    }
    if (isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement)) {
      if (statement.typeParameters && statement.typeParameters.length > 0) {
        diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `Type '${statement.name.text}': generic props types are not supported.`, span(statement)));
        continue;
      }
      typeDeclarations.push({ name: statement.name.text, node: statement, text: statement.getText(sourceFile).replace(/^export\s+/, "") });
      continue;
    }
    if (isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text)) {
      const isDefault = (statement.modifierFlags & ModifierFlags.Default) !== 0;
      const component = analyzeComponent(
        { name: statement.name.text, node: statement, parameters: statement.parameters, body: statement.body, exported: (statement.modifierFlags & ModifierFlags.Export) !== 0, isDefault },
        span,
        diagnostics,
        storeNames,
      );
      if (component) components.push(component);
      continue;
    }
    if (isFunctionDeclaration(statement) && (statement.modifierFlags & ModifierFlags.Default) !== 0) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, "A default-exported component needs a capitalised name: `export default function Enemy() {}`.", span(statement)));
      continue;
    }
    // `const Enemy = ({ speed }: EnemyProps) => { … }` (optionally exported): an arrow-function component.
    if (isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const declaration = statement.declarationList.declarations[0]!;
      const arrow = declaration.initializer ? unwrapParens(declaration.initializer) : undefined;
      if (isIdentifier(declaration.name) && /^[A-Z]/.test(declaration.name.text) && arrow && isArrowFunction(arrow)) {
        if ((statement.declarationList.flags & NodeFlags.Const) === 0) {
          diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `Component '${declaration.name.text}' must be declared with \`const\`.`, span(statement)));
          continue;
        }
        const component = analyzeComponent(
          { name: declaration.name.text, node: declaration, parameters: arrow.parameters, body: arrow.body, exported: (statement.modifierFlags & ModifierFlags.Export) !== 0, isDefault: false },
          span,
          diagnostics,
          storeNames,
        );
        if (component) components.push(component);
        continue;
      }
    }
    // `export default Enemy;` makes an already-declared component the module's default export.
    if (isExportAssignment(statement) && !statement.isExportEquals) {
      const target = unwrapParens(statement.expression);
      if (isIdentifier(target)) {
        defaultExports.push({ name: target.text, node: statement });
        continue;
      }
    }
    diagnostics.push(
      error(
        DiagnosticCode.UnsupportedSyntax,
        "Only imports, `interface` / `type` declarations, components (`function Name() {}` or `const Name = () => {}`, capitalised) and `export default Name;` are supported at the top level.",
        span(statement),
      ),
    );
  }

  // Resolve `export default Enemy;` against the components declared in this file.
  let resolved = components;
  for (const { name, node } of defaultExports) {
    const index = resolved.findIndex((c) => c.name === name);
    if (index === -1) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `\`export default ${name};\` must name a component declared in this file.`, span(node)));
    } else if (resolved.some((c) => c.isDefault)) {
      diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, "A module has one default export.", span(node)));
    } else {
      resolved = resolved.map((c, i) => (i === index ? { ...c, isDefault: true } : c));
    }
  }

  return { fileName, sourceFile, components: resolved, imports, authoringImports, storeImports, typeDeclarations, diagnostics };
}

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
function analyzeNamedImport(
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
    diagnostics.push(
      error(DiagnosticCode.UnsupportedSyntax, `${what} must name what they import: \`${example}\` (no side-effect${allowDefault ? "" : ", default"} or namespace imports).`, span(statement)),
    );
    return;
  }
  // `import type {…}` (and the `defer` / `source` phases) carry a phase modifier on the whole clause.
  if (clause.phaseModifier !== undefined) {
    diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(statement)));
    return;
  }
  if (clause.name) imports.push({ name: clause.name.text, isDefault: true, isTypeOnly: false, module, node: clause });
  if (bindings && isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      if ((element.isTypeOnly && !allowTypeSpecifiers) || element.propertyName) {
        diagnostics.push(
          error(DiagnosticCode.UnsupportedSyntax, `${what} must be plain \`{ Name }\`: no \`type\` modifier and no \`as\` aliases.`, span(element)),
        );
        continue;
      }
      imports.push({ name: element.name.text, isDefault: false, isTypeOnly: element.isTypeOnly, module, node: element });
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

function analyzeComponent(
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
  const mustReturn = `Component '${name}' must end by returning a built-in element or a fragment: \`return <Entity>…</Entity>;\``;

  const hooks: HookCallAnalysis[] = [];
  const acceptedHookCalls = new Set<CallExpression>();
  let jsx: JsxRoot | null = null;

  const statements: readonly Statement[] = isBlock(body) ? body.statements : [];
  if (expressionBody) {
    const returned = unwrapParens(expressionBody);
    if (isJsxElement(returned) || isJsxSelfClosingElement(returned) || isJsxFragment(returned)) jsx = returned;
    else diagnostics.push(error(DiagnosticCode.InvalidComponentBody, mustReturn, span(expressionBody)));
  }
  statements.forEach((statement, index) => {
    const isLast = index === statements.length - 1;
    if (isLast && isReturnStatement(statement)) {
      const returned = statement.expression ? unwrapParens(statement.expression) : undefined;
      if (returned && (isJsxElement(returned) || isJsxSelfClosingElement(returned) || isJsxFragment(returned))) {
        jsx = returned;
      } else {
        diagnostics.push(error(DiagnosticCode.InvalidComponentBody, mustReturn, span(statement)));
      }
      return;
    }
    const store = matchStoreStatement(statement, storeNames);
    if (store) {
      if (store.kind === "ok") {
        hooks.push(store.hook);
        acceptedHookCalls.add(store.hook.call);
      } else {
        diagnostics.push(error(DiagnosticCode.InvalidUseState, store.message, span(statement)));
        acceptedHookCalls.add(store.call);
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

type StoreMatch =
  | { readonly kind: "ok"; readonly hook: UseStoreCallAnalysis }
  | { readonly kind: "invalid"; readonly message: string; readonly call: CallExpression };

/** Recognises `const hp = useGame((s) => s.player.hp)` on an imported store; null if the statement is not a call of one. */
function matchStoreStatement(statement: Statement, storeNames: ReadonlySet<string>): StoreMatch | null {
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
function matchHandleStatement(statement: Statement): HandleMatch | null {
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
function matchHandlerStatement(statement: Statement): HandlerMatch | null {
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
