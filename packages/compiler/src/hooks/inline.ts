/**
 * Custom hooks, inlined at compile time. A hook is an ordinary function whose name starts with `use`, whose body is what a
 * component body may hold (`useState`, `useRef`, `useSound`, `useInput`, `useUpdate`, `useMount`, `useUnmount`, a selector on the
 * game state, derived constants, other custom hooks) and that ends in an optional `return`:
 *
 *     function usePlatformerBody(speed: number) {
 *       const [x, setX] = useState(0);
 *       useUpdate((dt) => { setX((x) => x + speed * dt); });
 *       return { x };
 *     }
 *     function Player() {
 *       const { x } = usePlatformerBody(90);
 *       return <Entity name="Player" transform={{ x }} />;
 *     }
 *
 * "Hooks are compiler intrinsics": the call does not exist at run time. Before a file is compiled, each call that is a statement
 * of a component body is replaced by the hook's own statements, with the names the hook declares given a prefix that is
 * unique to that call (so two calls make two separate states), its parameters bound by `const` to the arguments, and the
 * `return` turned into the declarations the call site asked for (`const v = …`, `const { a, b } = …`). The result is the
 * component the author could have written by hand, and goes through the same compiler, so every rule of a component body
 * applies to it, and every diagnostic is the usual one.
 *
 * Where hooks may be: in the same file as the component, or in a relative `.tsx` file (`import { useThing } from "./hooks.tsx"`).
 * Not supported, each with a diagnostic: a hook call that is not a statement of the component body (in a condition, a
 * callback, an expression), a return that is not a value, an object literal or an array literal, and a parameter that is
 * destructured. Recursion (a hook that calls itself) stops at a depth limit.
 *
 * It is text to text: the replaced file is what the rest of the compiler sees, so positions in later diagnostics are those of the
 * expanded source.
 */
import { NodeFlags, SyntaxKind, type Block, type CallExpression, type FunctionDeclaration, type Node, type SourceFile, type Statement } from "typescript/ast";
import {
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isBindingElement,
  isCallExpression,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isJsxAttribute,
  isNamedImports,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isVariableStatement,
} from "typescript/ast/is";
import { AUTHORING_HOOKS } from "../analyzer/model.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { spanOf, type TsxParser } from "../parser/parser.ts";
import { LIBRARY_FILE, LIBRARY_HOOKS, LIBRARY_SOURCE } from "./library.ts";

/** Where components import built-in hooks from; the engine's own custom hooks (`useSquash`) are imported from there too. */
const AUTHORING_MODULE = "@rge/runtime/jsx";

export interface HookSource {
  readonly fileName: string;
  readonly text: string;
}

/** Finds the source of a relative `.tsx` module (`"./hooks.tsx"`) imported by `fromFile`, or null. */
export type HookResolver = (specifier: string, fromFile: string) => HookSource | null;

const HOOK = /^use[A-Z0-9]/;
const MAX_DEPTH = 6;

interface Hook {
  readonly name: string;
  readonly fileName: string;
  readonly text: string;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Is a name one an author may have defined (so not a built-in hook, and not the game state's own `useGame`)? */
function isCustomName(name: string, stores: ReadonlySet<string>): boolean {
  return HOOK.test(name) && !AUTHORING_HOOKS.includes(name) && !stores.has(name);
}

/** The names bound by relative `.ts` imports: the game state's store, which looks like a hook and is not one. */
function storeNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || !/^\.\.?\/.*\.ts$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && isNamedImports(bindings)) for (const element of bindings.elements) names.add(element.name.text);
  }
  return names;
}

/**
 * Inline the custom hooks used in `text`. Returns the text unchanged when it uses none. Problems are pushed to `diagnostics`
 * and leave the text as it was, for the compiler to report on as it would.
 */
export function inlineCustomHooks(parser: TsxParser, fileName: string, text: string, resolve: HookResolver | null, diagnostics: CompilerDiagnostic[]): string {
  let current = splitStoreSelections(parser, fileName, text, diagnostics);
  let counter = 0;
  // What a hook from another file imports from the authoring module (`useState`, `useUpdate`): its expansion needs those here.
  const needed = new Map<string, Set<string>>();
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const parsed = parser.parse(fileName, current);
    try {
      const sf = parsed.sourceFile;
      const stores = storeNames(sf);
      const hooks = collectHooks(parser, sf, fileName, current, resolve, stores);
      const edits: Edit[] = [];
      let found = false;
      for (const statement of sf.statements) {
        for (const body of componentBodies(statement)) {
          for (const stmt of body.statements) {
            const call = hookCall(stmt, stores);
            if (call === null) {
              reportNested(stmt, sf, fileName, stores, diagnostics);
              continue;
            }
            const hook = hooks.get(call.name);
            // A name that is no hook of this file is left for the compiler's own report (it knows the retired hooks and suggests the nearest).
            if (hook === undefined) continue;
            found = true;
            const expanded = expandCall(parser, stmt, call, hook, sf, fileName, `_${call.name}${++counter}_`, diagnostics);
            if (hook.fileName !== fileName) collectImports(parser, hook, needed);
            if (expanded !== null) edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: expanded });
          }
        }
      }
      if (!found) {
        // No call is left to expand: the hook declarations and their imports were only for the calls.
        return addImports(removeHookDeclarations(sf, current, stores), sf, needed);
      }
      if (edits.length === 0) return current; // every call failed; the diagnostics say why
      current = applyEdits(current, edits);
    } finally {
      parsed.dispose();
    }
  }
  diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `Custom hooks call each other more than ${MAX_DEPTH} levels deep, or a hook calls itself: hooks are inlined, so they cannot recurse.`, null));
  return text;
}

/**
 * Several values from the game state at once, as Zustand allows, each becoming its own selector (so its own subscription, and
 * a component re-renders only for the values it reads):
 *
 *     const { originX, room } = useGame((s) => s.run);              → const originX = useGame((s) => s.run.originX); …
 *     const { a, b: c } = useGame((s) => ({ a: s.x, b: s.y.z }));   → const a = useGame((s) => s.x); const c = useGame((s) => s.y.z);
 *     const [a, b] = useGame((s) => [s.x, s.y]);                    → const a = useGame((s) => s.x); const b = …
 */
function splitStoreSelections(parser: TsxParser, fileName: string, text: string, diagnostics: CompilerDiagnostic[]): string {
  const parsed = parser.parse(fileName, text);
  try {
    const sf = parsed.sourceFile;
    const stores = storeNames(sf);
    const edits: Edit[] = [];
    const src = (n: Node): string => text.slice(n.getStart(sf), n.getEnd());
    for (const statement of sf.statements) {
      for (const body of componentBodies(statement)) {
        for (const stmt of body.statements) {
          if (!isVariableStatement(stmt) || stmt.declarationList.declarations.length !== 1) continue;
          const d = stmt.declarationList.declarations[0]!;
          const init = d.initializer;
          if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || !stores.has(init.expression.text) || !HOOK.test(init.expression.text)) continue;
          if (!isObjectBindingPattern(d.name) && !isArrayBindingPattern(d.name)) continue;
          const store = init.expression.text;
          const selector = init.arguments[0];
          const fn = selector !== undefined ? unwrap(selector) : undefined;
          if (fn === undefined || fn.kind !== SyntaxKind.ArrowFunction) continue;
          const arrow = fn as unknown as { parameters: readonly { name: Node }[]; body: Node };
          const param = arrow.parameters[0];
          if (arrow.parameters.length !== 1 || param === undefined || !isIdentifier(param.name)) continue;
          const p = param.name.text;
          const body = unwrap(arrow.body);
          const lines: string[] = [];
          const fail = (message: string): void => {
            diagnostics.push(error(DiagnosticCode.InvalidGameState, message, spanOf(stmt, sf, fileName)));
          };
          if (isObjectBindingPattern(d.name)) {
            const picked = isObjectLiteralExpression(body) ? new Map<string, string>() : null;
            if (picked !== null && isObjectLiteralExpression(body)) {
              for (const property of body.properties) {
                if (isPropertyAssignment(property) && isIdentifier(property.name)) picked.set(property.name.text, src(property.initializer));
                else if (isShorthandPropertyAssignment(property)) {
                  const n = (property.name as unknown as { text: string }).text;
                  picked.set(n, n);
                }
              }
            }
            for (const element of d.name.elements) {
              if (element.name === undefined || !isIdentifier(element.name) || element.dotDotDotToken) {
                fail(`Each value picked from ${store} is a plain name: \`const { a, b: c } = ${store}(…)\`.`);
                continue;
              }
              const key = element.propertyName !== undefined ? (element.propertyName as unknown as { text: string }).text : element.name.text;
              const path = picked !== null ? picked.get(key) : `${src(body)}.${key}`;
              if (path === undefined) {
                fail(`The selector does not pick '${key}'.`);
                continue;
              }
              lines.push(`const ${element.name.text} = ${store}((${p}) => ${path});`);
            }
          } else {
            const items = body.kind === SyntaxKind.ArrayLiteralExpression ? (body as unknown as { elements: readonly Node[] }).elements : null;
            if (items === null) {
              fail(`\`const [a, b] = ${store}(…)\` needs a selector that returns an array of paths: \`(${p}) => [${p}.a, ${p}.b]\`.`);
              continue;
            }
            d.name.elements.forEach((element, i) => {
              const item = items[i];
              if (!isBindingElement(element) || element.name === undefined || !isIdentifier(element.name) || item === undefined) return;
              lines.push(`const ${element.name.text} = ${store}((${p}) => ${src(item)});`);
            });
          }
          edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: lines.join("\n  ") });
        }
      }
    }
    return edits.length === 0 ? text : applyEdits(text, edits);
  } finally {
    parsed.dispose();
  }
}

/** Parentheses (and `as`) around an expression do not change it. */
function unwrap(node: Node): Node {
  let at = node;
  while (at.kind === SyntaxKind.ParenthesizedExpression || at.kind === SyntaxKind.AsExpression) at = (at as unknown as { expression: Node }).expression;
  return at;
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** The blocks that are component bodies: a capitalised function, or an arrow assigned to a capitalised const, at the top level. */
function componentBodies(statement: Statement): Block[] {
  if (isFunctionDeclaration(statement) && statement.name && /^[A-Z]/.test(statement.name.text) && statement.body) return [statement.body];
  if (isVariableStatement(statement)) {
    const out: Block[] = [];
    for (const d of statement.declarationList.declarations) {
      if (isIdentifier(d.name) && /^[A-Z]/.test(d.name.text) && d.initializer && d.initializer.kind === SyntaxKind.ArrowFunction) {
        const body = (d.initializer as unknown as { body: Node }).body;
        if (body.kind === SyntaxKind.Block) out.push(body as Block);
      }
    }
    return out;
  }
  return [];
}

interface HookCall {
  readonly name: string;
  readonly call: CallExpression;
  /** How the result is bound: not at all, `const v = …`, `const { a, b } = …` or `const [a, b] = …`. */
  readonly binding: { readonly kind: "none" } | { readonly kind: "name"; readonly name: string; readonly keyword: string } | { readonly kind: "object" | "array"; readonly node: Node; readonly keyword: string };
}

/** A statement that is a call of a custom hook (alone, or as the initializer of one `const`), or null. */
function hookCall(statement: Statement, stores: ReadonlySet<string>): HookCall | null {
  if (isExpressionStatement(statement) && isCallExpression(statement.expression) && isIdentifier(statement.expression.expression) && isCustomName(statement.expression.expression.text, stores)) {
    return { name: statement.expression.expression.text, call: statement.expression, binding: { kind: "none" } };
  }
  if (isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const d = statement.declarationList.declarations[0]!;
    const init = d.initializer;
    if (init && isCallExpression(init) && isIdentifier(init.expression) && isCustomName(init.expression.text, stores)) {
      const keyword = (statement.declarationList.flags & NodeFlags.Const) !== 0 ? "const" : "let";
      if (isIdentifier(d.name)) return { name: init.expression.text, call: init, binding: { kind: "name", name: d.name.text, keyword } };
      if (isObjectBindingPattern(d.name)) return { name: init.expression.text, call: init, binding: { kind: "object", node: d.name, keyword } };
      if (isArrayBindingPattern(d.name)) return { name: init.expression.text, call: init, binding: { kind: "array", node: d.name, keyword } };
    }
  }
  return null;
}

/** A custom hook called somewhere a hook cannot be (in a condition, a callback, an expression) is reported where it is. */
function reportNested(statement: Statement, sf: SourceFile, fileName: string, stores: ReadonlySet<string>, diagnostics: CompilerDiagnostic[]): void {
  const stack: Node[] = [statement];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (isCallExpression(node) && isIdentifier(node.expression) && isCustomName(node.expression.text, stores) && node !== (statement as unknown as { expression?: Node }).expression) {
      // A call that is the whole initializer of a `const` is a hook call; anything else is nested.
      const direct = isVariableStatement(statement) && statement.declarationList.declarations.some((d) => d.initializer === node);
      if (!direct) {
        diagnostics.push(error(DiagnosticCode.HookNotAtTopLevel, `The custom hook '${node.expression.text}' must be a statement of the component body (\`${node.expression.text}(…);\` or \`const v = ${node.expression.text}(…);\`): hooks are inlined into the component, so they cannot be called in a condition, a callback or an expression.`, spanOf(node, sf, fileName)));
      }
    }
    node.forEachChild((child) => {
      stack.push(child);
      return undefined;
    });
  }
}

/** The custom hooks visible in this file: declared here, or imported from a relative `.tsx` file (their source read through `resolve`). */
function collectHooks(parser: TsxParser, sf: SourceFile, fileName: string, text: string, resolve: HookResolver | null, stores: ReadonlySet<string>): Map<string, Hook> {
  const hooks = new Map<string, Hook>();
  for (const statement of sf.statements) {
    if (isFunctionDeclaration(statement) && statement.name && isCustomName(statement.name.text, stores)) hooks.set(statement.name.text, { name: statement.name.text, fileName, text });
    // The engine's own hooks, imported from the authoring module.
    if (isImportDeclaration(statement) && isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === AUTHORING_MODULE) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && isNamedImports(bindings)) {
        for (const element of bindings.elements) if (LIBRARY_HOOKS.includes(element.name.text)) hooks.set(element.name.text, { name: element.name.text, fileName: LIBRARY_FILE, text: LIBRARY_SOURCE });
      }
    }
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || !/^\.\.?\/.*\.tsx$/.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !isNamedImports(bindings)) continue;
    const wanted = bindings.elements.map((e) => e.name.text).filter((n) => isCustomName(n, stores));
    if (wanted.length === 0 || resolve === null) continue;
    const source = resolve(statement.moduleSpecifier.text, fileName);
    if (source === null) continue;
    const parsed = parser.parse(source.fileName, source.text);
    try {
      for (const s of parsed.sourceFile.statements) {
        if (isFunctionDeclaration(s) && s.name && wanted.includes(s.name.text)) hooks.set(s.name.text, { name: s.name.text, fileName: source.fileName, text: source.text });
      }
    } finally {
      parsed.dispose();
    }
  }
  return hooks;
}

/** Take hook declarations out of the file, and the hooks out of imports (and an import that is left empty), once nothing calls them. */
function removeHookDeclarations(sf: SourceFile, text: string, stores: ReadonlySet<string>): string {
  const edits: Edit[] = [];
  for (const statement of sf.statements) {
    if (isFunctionDeclaration(statement) && statement.name && isCustomName(statement.name.text, stores)) {
      edits.push({ start: statement.getFullStart(), end: statement.getEnd(), text: "" });
    } else if (isImportDeclaration(statement) && isStringLiteral(statement.moduleSpecifier) && (/^\.\.?\/.*\.tsx$/.test(statement.moduleSpecifier.text) || statement.moduleSpecifier.text === AUTHORING_MODULE)) {
      const library = statement.moduleSpecifier.text === AUTHORING_MODULE;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !isNamedImports(bindings)) continue;
      const keep = bindings.elements.filter((e) => (library ? !LIBRARY_HOOKS.includes(e.name.text) : !isCustomName(e.name.text, stores)));
      if (keep.length === bindings.elements.length) continue;
      if (keep.length === 0 && !statement.importClause?.name) edits.push({ start: statement.getFullStart(), end: statement.getEnd(), text: "" });
      else edits.push({ start: bindings.getStart(sf), end: bindings.getEnd(), text: `{ ${keep.map((e) => e.name.text).join(", ")} }` });
    }
  }
  return edits.length === 0 ? text : applyEdits(text, edits);
}

/** The text that replaces a hook call, or null (with a diagnostic) when it cannot be expanded. */
function expandCall(parser: TsxParser, statement: Statement, call: HookCall, hook: Hook, callSf: SourceFile, callFile: string, prefix: string, diagnostics: CompilerDiagnostic[]): string | null {
  const at = spanOf(statement, callSf, callFile);
  const parsed = parser.parse(hook.fileName, hook.text);
  try {
    const sf = parsed.sourceFile;
    const declaration = sf.statements.find((s): s is FunctionDeclaration => isFunctionDeclaration(s) && s.name?.text === hook.name);
    if (declaration === undefined || declaration.body === undefined) {
      diagnostics.push(error(DiagnosticCode.UnknownHook, `The hook '${hook.name}' has no body to inline.`, at));
      return null;
    }
    // What the hook declares at its top level, which is renamed so two calls (or the component's own names) cannot meet.
    const declared = new Set<string>();
    const params = declaration.parameters;
    for (const p of params) {
      if (!isIdentifier(p.name)) {
        diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}': a parameter must be a plain name (not destructured), since the call's argument is bound to it.`, spanOf(p, sf, hook.fileName)));
        return null;
      }
      declared.add(p.name.text);
    }
    const bodyStatements = declaration.body.statements;
    let returnStatement: Statement | null = null;
    const kept: Statement[] = [];
    for (let i = 0; i < bodyStatements.length; i++) {
      const s = bodyStatements[i] as Statement;
      if (isReturnStatement(s)) {
        if (i !== bodyStatements.length - 1) {
          diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}': a \`return\` must be the last statement of the hook.`, spanOf(s, sf, hook.fileName)));
          return null;
        }
        returnStatement = s;
      } else kept.push(s);
    }
    for (const s of kept) if (isVariableStatement(s)) for (const d of s.declarationList.declarations) bindingNames(d.name, declared);
    // A literal argument is written into the hook where its parameter is used, so what needs a literal (a `useSound` path) gets
    // one; any other argument is bound to a constant.
    const literals = new Map<string, string>();
    {
      const given = call.call.arguments;
      for (let i = 0; i < params.length && i < given.length; i++) {
        const arg = given[i] as Node;
        if (isStringLiteral(arg) || arg.kind === SyntaxKind.NumericLiteral || arg.kind === SyntaxKind.TrueKeyword || arg.kind === SyntaxKind.FalseKeyword) {
          literals.set((params[i]!.name as { text: string }).text, callSf.text.slice(arg.getStart(callSf), arg.getEnd()));
        }
      }
    }
    // A name the hook returns as it is (`return [squash, setSquash]`) takes the caller's name instead of a copy, so a hook can
    // return a setter, as in React, and its value is the caller's own state.
    const aliases = new Map<string, string>();
    const returned = returnStatement !== null && isReturnStatement(returnStatement) ? returnStatement.expression : undefined;
    if (returned !== undefined && call.binding.kind === "array" && isArrayLiteralExpression(returned)) {
      const targets = (call.binding.node as unknown as { elements: readonly Node[] }).elements;
      returned.elements.forEach((value, i) => {
        const target = targets[i] as unknown as { name?: Node } | undefined;
        if (target?.name !== undefined && isIdentifier(target.name) && isIdentifier(value) && declared.has(value.text) && !params.some((p) => isIdentifier(p.name) && p.name.text === value.text) && !aliases.has(value.text)) {
          aliases.set(value.text, target.name.text);
        }
      });
    } else if (returned !== undefined && call.binding.kind === "object" && isObjectLiteralExpression(returned)) {
      const wanted = new Map<string, string>();
      for (const element of (call.binding.node as unknown as { elements: readonly { name: Node; propertyName?: Node }[] }).elements) {
        if (!isIdentifier(element.name)) continue;
        wanted.set(element.propertyName !== undefined ? (element.propertyName as unknown as { text: string }).text : element.name.text, element.name.text);
      }
      for (const property of returned.properties) {
        const key = isShorthandPropertyAssignment(property) || (isPropertyAssignment(property) && isIdentifier(property.name)) ? (property.name as unknown as { text: string }).text : null;
        const value = isShorthandPropertyAssignment(property) ? property.name : isPropertyAssignment(property) ? property.initializer : null;
        const target = key === null ? undefined : wanted.get(key);
        if (target !== undefined && value !== null && isIdentifier(value) && declared.has(value.text) && !params.some((p) => isIdentifier(p.name) && p.name.text === value.text) && !aliases.has(value.text)) {
          aliases.set(value.text, target);
        }
      }
    }
    const rename = (name: string): string => aliases.get(name) ?? literals.get(name) ?? `${prefix}${name}`;

    const args = call.call.arguments;
    if (args.length > params.length) {
      diagnostics.push(error(DiagnosticCode.InvalidProps, `The hook '${hook.name}' takes ${params.length} argument${params.length === 1 ? "" : "s"}, but the call passes ${args.length}.`, at));
      return null;
    }
    const lines: string[] = [`// ${hook.name}, inlined`];
    for (let i = 0; i < params.length; i++) {
      const p = params[i]!;
      const arg = args[i];
      const valueText = arg !== undefined ? `(${callSf.text.slice(arg.getStart(callSf), arg.getEnd())})` : p.initializer ? renameIn(p.initializer, sf, hook.text, declared, rename) : null;
      if (valueText === null) {
        diagnostics.push(error(DiagnosticCode.InvalidProps, `The hook '${hook.name}' needs an argument for '${(p.name as { text: string }).text}'.`, at));
        return null;
      }
      if (!literals.has((p.name as { text: string }).text)) lines.push(`const ${rename((p.name as { text: string }).text)} = ${valueText};`);
    }
    for (const s of kept) lines.push(renameIn(s, sf, hook.text, declared, rename));

    if (call.binding.kind !== "none") {
      const expr = returnStatement !== null && isReturnStatement(returnStatement) ? returnStatement.expression : undefined;
      if (expr === undefined) {
        diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}' returns nothing, but its result is used.`, at));
        return null;
      }
      const renamed = (n: Node): string => renameIn(n, sf, hook.text, declared, rename);
      if (call.binding.kind === "name") lines.push(`${call.binding.keyword} ${call.binding.name} = ${renamed(expr)};`);
      else if (call.binding.kind === "object") {
        if (!isObjectLiteralExpression(expr)) {
          diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}' must return an object literal (\`return { a, b };\`) to be used as \`const { a, b } = ${hook.name}()\`.`, at));
          return null;
        }
        const values = new Map<string, string>();
        for (const property of expr.properties) {
          if (isShorthandPropertyAssignment(property)) values.set((property.name as unknown as { text: string }).text, renamed(property.name));
          else if (isPropertyAssignment(property) && isIdentifier(property.name)) values.set(property.name.text, renamed(property.initializer));
          else {
            diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}': the returned object may only have \`name\` and \`name: value\` entries.`, spanOf(property, sf, hook.fileName)));
            return null;
          }
        }
        for (const element of (call.binding.node as unknown as { elements: readonly { name: Node; propertyName?: Node; initializer?: Node }[] }).elements) {
          const key = element.propertyName !== undefined ? (element.propertyName as unknown as { text: string }).text : (element.name as unknown as { text: string }).text;
          const value = values.get(key);
          if (value === (element.name as unknown as { text: string }).text) continue; // the hook's own name, renamed to this one
          if (value === undefined) {
            diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}' does not return '${key}'.`, at));
            return null;
          }
          lines.push(`${call.binding.keyword} ${(element.name as unknown as { text: string }).text} = ${value};`);
        }
      } else {
        if (!isArrayLiteralExpression(expr)) {
          diagnostics.push(error(DiagnosticCode.UnsupportedSyntax, `The hook '${hook.name}' must return an array literal (\`return [a, b];\`) to be used as \`const [a, b] = ${hook.name}()\`.`, at));
          return null;
        }
        const elements = (call.binding.node as unknown as { elements: readonly Node[] }).elements;
        for (let i = 0; i < elements.length; i++) {
          const target = elements[i] as unknown as { name?: { text: string } };
          const value = expr.elements[i];
          if (target.name === undefined || value === undefined) continue;
          if (isIdentifier(value) && aliases.get(value.text) === target.name.text) continue; // renamed in place
          lines.push(`${call.binding.keyword} ${target.name.text} = ${renameIn(value, sf, hook.text, declared, rename)};`);
        }
      }
    }
    return lines.join("\n  ");
  } finally {
    parsed.dispose();
  }
}

/** Every name a binding declares (a plain name, or those inside a destructuring pattern). */
function bindingNames(name: Node, out: Set<string>): void {
  if (isIdentifier(name)) out.add(name.text);
  else if (isObjectBindingPattern(name) || isArrayBindingPattern(name)) {
    for (const element of name.elements) if (isBindingElement(element) && element.name !== undefined) bindingNames(element.name, out);
  }
}

/** The source of `node`, with each identifier in `names` that refers to a binding renamed: property names and attribute names are left alone. */
function renameIn(node: Node, sf: SourceFile, text: string, names: ReadonlySet<string>, rename: (name: string) => string): string {
  const base = node.getStart(sf);
  const edits: Edit[] = [];
  const walk = (n: Node, parent: Node | null): void => {
    if (isIdentifier(n) && names.has(n.text) && !isNotAReference(n, parent)) {
      if (parent !== null && isShorthandPropertyAssignment(parent)) edits.push({ start: n.getStart(sf) - base, end: n.getEnd() - base, text: `${n.text}: ${rename(n.text)}` });
      else edits.push({ start: n.getStart(sf) - base, end: n.getEnd() - base, text: rename(n.text) });
    }
    n.forEachChild((child) => {
      walk(child, n);
      return undefined;
    });
  };
  walk(node, null);
  return applyEdits(text.slice(base, node.getEnd()), edits);
}

/** Is this identifier a name that only looks like the variable: `o.x`'s `x`, `{ x: 1 }`'s key, `<A x={…} />`'s attribute? */
function isNotAReference(id: Node, parent: Node | null): boolean {
  if (parent === null) return false;
  if (isPropertyAccessExpression(parent) && parent.name === id) return true;
  if (isPropertyAssignment(parent) && parent.name === id) return true;
  if (isJsxAttribute(parent) && parent.name === id) return true;
  if (isBindingElement(parent) && parent.propertyName === id) return true;
  return false;
}

/** The names a hook's file imports from non-relative modules, by module. */
function collectImports(parser: TsxParser, hook: Hook, into: Map<string, Set<string>>): void {
  const parsed = parser.parse(hook.fileName, hook.text);
  try {
    for (const statement of parsed.sourceFile.statements) {
      if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier) || /^\.\.?\//.test(statement.moduleSpecifier.text)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !isNamedImports(bindings)) continue;
      const set = into.get(statement.moduleSpecifier.text) ?? new Set<string>();
      for (const element of bindings.elements) if (!element.isTypeOnly) set.add(element.name.text);
      into.set(statement.moduleSpecifier.text, set);
    }
  } finally {
    parsed.dispose();
  }
}

/** Add to the file the imports its inlined hooks need and it lacks, as one line at the top. */
function addImports(text: string, sf: SourceFile, needed: ReadonlyMap<string, ReadonlySet<string>>): string {
  if (needed.size === 0) return text;
  const have = new Set<string>();
  for (const statement of sf.statements) {
    if (!isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && isNamedImports(bindings)) for (const element of bindings.elements) have.add(element.name.text);
  }
  const lines: string[] = [];
  for (const [specifier, names] of needed) {
    const missing = [...names].filter((n) => !have.has(n));
    if (missing.length > 0) lines.push(`import { ${missing.join(", ")} } from ${JSON.stringify(specifier)};`);
  }
  return lines.length === 0 ? text : `${lines.join(" ")} ${text}`;
}
