/**
 * From `useState` to `useMutable` (docs/MUTABLE_STATE.md): every `const [x, setX] = useState(init)` at the top of a component or
 * hook becomes a field of one `useMutable` per function, each read of `x` becomes `s.x`, and each call of `setX` an assignment
 * (`setX(v)` → `s.x = v`, `setX((p) => p + 1)` → `s.x += 1`). It does what is mechanical and says where it stopped: an updater
 * with a block body, a hook that returns a setter, an initial value that reads a name declared later in the body.
 *
 * Behaviour is not always the same afterwards: a handler now reads its own writes (`setX(x + 1); setY(x)` read the old `x`;
 * `s.x += 1; s.y = s.x` reads the new one). `Compiler.convertToMutable` runs it with the compiler's parser; the editor's quick fix
 * for a `useState` and `tools/codemod-mutable.ts` (files and folders) use it.
 */
import { NodeFlags, SyntaxKind, type Node, type SourceFile } from "typescript/ast";
import {
  isArrayBindingPattern,
  isArrowFunction,
  isBindingElement,
  isBlock,
  isCallExpression,
  isCaseClause,
  isCatchClause,
  isDefaultClause,
  isExpressionStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isJsxAttribute,
  isMethodDeclaration,
  isNamedImports,
  isObjectBindingPattern,
  isParameterDeclaration,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSourceFile,
  isVariableDeclaration,
  isVariableStatement,
} from "typescript/ast/is";
import { type TsxParser } from "../parser/parser.ts";
import { applyEdits, type Edit } from "../hooks/edits.ts";

export interface Converted {
  readonly text: string;
  readonly changed: boolean;
  /** Where it stopped, for a person to finish: `line: what`. */
  readonly problems: readonly string[];
}

interface StateDecl {
  readonly value: string;
  readonly setter: string | null;
  readonly field: string;
  readonly comment: string;
  readonly statement: Node;
}

/** Each child of `node`, in order. */
function children(node: Node): Node[] {
  const out: Node[] = [];
  node.forEachChild((child) => {
    out.push(child);
    return undefined;
  });
  return out;
}

/** The names a binding name declares (`x`, `{ a, b: c }`, `[d, ...e]`). */
function boundNames(name: Node): string[] {
  if (isIdentifier(name)) return [name.text];
  if (isObjectBindingPattern(name) || isArrayBindingPattern(name)) return children(name).flatMap((e) => (isBindingElement(e) && e.name !== undefined ? boundNames(e.name) : []));
  return [];
}

/** The names a node declares for its own scope: a function's parameters, a block's `const` / `let` / functions, a loop's variable. */
function declaredBy(node: Node): Set<string> {
  const names = new Set<string>();
  if (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node) || isMethodDeclaration(node)) {
    for (const p of node.parameters) for (const n of boundNames(p.name)) names.add(n);
  }
  if (isBlock(node) || isSourceFile(node) || isCaseClause(node) || isDefaultClause(node)) {
    for (const s of node.statements) {
      if (isVariableStatement(s)) for (const d of s.declarationList.declarations) for (const n of boundNames(d.name)) names.add(n);
      if (isFunctionDeclaration(s) && s.name) names.add(s.name.text);
    }
  }
  if ((isForStatement(node) || isForOfStatement(node) || isForInStatement(node)) && node.initializer && !isIdentifier(node.initializer)) {
    const list = node.initializer as unknown as { declarations?: readonly { name: Node }[] };
    for (const d of list.declarations ?? []) for (const n of boundNames(d.name)) names.add(n);
  }
  if (isCatchClause(node) && node.variableDeclaration) for (const n of boundNames(node.variableDeclaration.name)) names.add(n);
  return names;
}

/** `const [x, setX] = useState(init)` (or `useState<T>(init)`), as a component body's statement; null if it is not one. */
function useStateOf(statement: Node, text: string, sf: SourceFile): { value: string; setter: string | null; init: Node | null; type: string | null; call: Node } | null {
  if (!isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return null;
  if ((statement.declarationList.flags & NodeFlags.Const) === 0) return null;
  const d = statement.declarationList.declarations[0]!;
  const call = d.initializer;
  if (!call || !isCallExpression(call) || !isIdentifier(call.expression) || call.expression.text !== "useState") return null;
  if (!isArrayBindingPattern(d.name)) return null;
  const elements = children(d.name);
  const names = elements.map((e) => (isBindingElement(e) && e.name !== undefined && isIdentifier(e.name) ? e.name.text : null));
  if (names[0] === null || names[0] === undefined) return null;
  const typeArgument = call.typeArguments?.[0];
  return { value: names[0], setter: names[1] ?? null, init: call.arguments[0] ?? null, type: typeArgument ? text.slice(typeArgument.getStart(sf), typeArgument.getEnd()) : null, call };
}

const MUTABLE_NAMES = ["s", "st", "state", "local", "mutable"];

/** Convert one TSX source. `lineOffset` is added to reported lines (a snippet's line in the file that holds it). */
export function convertToMutable(parser: TsxParser, fileName: string, text: string, lineOffset = 0): Converted {
  const parsed = parser.parse(fileName, text);
  try {
    const sf = parsed.sourceFile;
    const edits: Edit[] = [];
    const problems: string[] = [];
    const lineOf = (pos: number): number => text.slice(0, pos).split("\n").length + lineOffset;
    const src = (n: Node): string => text.slice(n.getStart(sf), n.getEnd());
    let converted = 0;

    // Each function whose body declares state at the top: a component or a custom hook.
    const functions: { fn: Node; body: Node; name: string }[] = [];
    const findFunctions = (node: Node): void => {
      if ((isFunctionDeclaration(node) || isArrowFunction(node) || isFunctionExpression(node)) && node.body && isBlock(node.body)) {
        if (node.body.statements.some((s) => useStateOf(s, text, sf) !== null)) {
          const name = isFunctionDeclaration(node) && node.name ? node.name.text : "(arrow)";
          functions.push({ fn: node, body: node.body, name });
          return;
        }
      }
      for (const c of children(node)) findFunctions(c);
    };
    findFunctions(sf);

    for (const { fn, body, name: fnName } of functions) {
      const statements = (body as unknown as { statements: readonly Node[] }).statements;
      const decls: StateDecl[] = [];
      const fail = (at: Node, why: string): void => {
        problems.push(`${lineOf(at.getStart(sf))}: ${fnName}: ${why}`);
      };
      let ok = true;
      for (const statement of statements) {
        const found = useStateOf(statement, text, sf);
        if (found === null) continue;
        if (found.init === null) {
          fail(statement, `useState(${found.value}) has no initial value`);
          ok = false;
          continue;
        }
        let init = found.init;
        if (isArrowFunction(init)) {
          if (init.parameters.length > 0 || isBlock(init.body)) {
            fail(statement, `the lazy initial value of '${found.value}' is not \`() => expression\``);
            ok = false;
            continue;
          }
          init = init.body;
        }
        let field = src(init);
        if (found.type !== null) {
          const simple = isIdentifier(init) || init.kind === SyntaxKind.NullKeyword || init.kind === SyntaxKind.ArrayLiteralExpression || init.kind === SyntaxKind.ObjectLiteralExpression || init.kind === SyntaxKind.NumericLiteral || init.kind === SyntaxKind.StringLiteral || isCallExpression(init) || isPropertyAccessExpression(init) || isParenthesizedExpression(init);
          field = `${simple ? field : `(${field})`} as ${found.type}`;
        }
        const leading = text.slice(statement.pos, statement.getStart(sf));
        const comment = leading.includes("/") ? leading.trim() : "";
        decls.push({ value: found.value, setter: found.setter, field, comment, statement });
      }
      if (!ok || decls.length === 0) continue;

      // The mutable's name: one the function does not use.
      const used = new Set<string>();
      const collect = (n: Node): void => {
        if (isIdentifier(n)) used.add(n.text);
        for (const c of children(n)) collect(c);
      };
      collect(fn);
      const m = MUTABLE_NAMES.find((n) => !used.has(n));
      if (m === undefined) {
        fail(fn, "no free name for the useMutable");
        continue;
      }

      // An initial value is evaluated where the first useState was: it may not read state, or a name declared after that.
      const firstIndex = statements.indexOf(decls[0]!.statement);
      const later = new Set<string>();
      statements.forEach((s, i) => {
        if (i <= firstIndex) return;
        if (isVariableStatement(s)) for (const d of s.declarationList.declarations) for (const n of boundNames(d.name)) later.add(n);
      });
      const values = new Set(decls.map((d) => d.value));
      const setters = new Map(decls.filter((d) => d.setter !== null).map((d) => [d.setter!, d.value]));
      for (const d of decls) {
        const init = d.statement;
        let bad: string | null = null;
        const check = (n: Node): void => {
          if (isIdentifier(n) && (later.has(n.text) && !values.has(n.text))) bad = n.text;
          if (isIdentifier(n) && values.has(n.text) && n.text !== d.value) bad = n.text;
          for (const c of children(n)) check(c);
        };
        const call = (useStateOf(init, text, sf)!.call as unknown as { arguments: readonly Node[] }).arguments[0]!;
        check(call);
        if (bad !== null) {
          fail(init, `the initial value of '${d.value}' reads '${bad}', which is not there yet where the useMutable goes`);
          ok = false;
        }
      }
      if (!ok) continue;

      // A hook that hands back a setter: its callers change too, by hand.
      for (const s of statements) {
        if (s.kind !== SyntaxKind.ReturnStatement) continue;
        let returnsSetter = false;
        // A setter handed back as a value (`return [x, setX]`), not one called in the JSX (`onPress={() => setX(1)}`).
        const look = (n: Node, parent: Node | null): void => {
          const called = parent !== null && isCallExpression(parent) && parent.expression === n;
          if (isIdentifier(n) && setters.has(n.text) && !called) returnsSetter = true;
          for (const c of children(n)) look(c, n);
        };
        look(s, null);
        if (returnsSetter) {
          fail(s, "returns a setter: return the useMutable instead (`return s`), and change its callers");
          ok = false;
        }
      }
      if (!ok) continue;

      // Every read and every setter call, with the scopes between it and the function, so a parameter or local of the same name
      // (`setX((x) => x + 1)`) is left alone.
      const local: Edit[] = [];
      const calls: { start: number; end: number; build: () => string | null; at: Node }[] = [];
      const walk = (node: Node, ancestors: readonly Node[], shadowed: ReadonlySet<string>): void => {
        if (decls.some((d) => d.statement === node)) return;
        let inner = shadowed;
        if (node !== body && node !== fn) {
          const own = declaredBy(node);
          if (own.size > 0) inner = new Set([...shadowed, ...[...own].filter((n) => values.has(n) || setters.has(n))]);
        }
        if (isIdentifier(node)) {
          const parent = ancestors[ancestors.length - 1];
          const name = node.text;
          if ((values.has(name) || setters.has(name)) && !shadowed.has(name) && parent !== undefined) {
            const isMember = isPropertyAccessExpression(parent) && parent.name === node;
            const isKey = (isPropertyAssignment(parent) && parent.name === node) || (isJsxAttribute(parent) && parent.name === node);
            const isDeclaration = (isVariableDeclaration(parent) || isBindingElement(parent) || isParameterDeclaration(parent) || isFunctionDeclaration(parent)) && (parent as unknown as { name: Node }).name === node;
            if (!isMember && !isKey && !isDeclaration) {
              if (values.has(name)) {
                const replacement = isShorthandPropertyAssignment(parent) ? `${name}: ${m}.${name}` : `${m}.${name}`;
                local.push({ start: node.getStart(sf), end: node.getEnd(), text: replacement });
              } else {
                const field = setters.get(name)!;
                if (parent !== undefined && isCallExpression(parent) && parent.expression === node) {
                  const callNode = parent;
                  const statementPosition = ancestors.length >= 2 && isExpressionStatement(ancestors[ancestors.length - 2]!);
                  // `() => setX(1)`: the arrow's whole body, so it becomes a block (`() => { s.x = 1; }`), which returns nothing.
                  const holder = ancestors[ancestors.length - 2];
                  const arrowBody = holder !== undefined && isArrowFunction(holder) && holder.body === callNode;
                  const arg = callNode.arguments[0];
                  if (callNode.arguments.length !== 1 || arg === undefined) {
                    fail(callNode, `${name} is called with ${callNode.arguments.length} arguments`);
                  } else if ((isArrowFunction(arg) || isFunctionExpression(arg)) && (arg.parameters.length !== 1 || isBlock(arg.body) || !isIdentifier(arg.parameters[0]!.name))) {
                    fail(callNode, `${name} takes an updater that is not \`(previous) => expression\`: write the assignment by hand`);
                  } else {
                    const updater = isArrowFunction(arg) || isFunctionExpression(arg) ? arg : null;
                    if (updater !== null) {
                      // The updater's parameter is the field as it is now.
                      const param = (updater.parameters[0]!.name as unknown as { text: string }).text;
                      const sub = (n: Node, hidden: boolean): void => {
                        if (n !== updater && declaredBy(n).has(param)) hidden = true;
                        if (isIdentifier(n) && n.text === param && !hidden) {
                          const p = parentOf(updater.body as Node, n);
                          const member = p !== null && isPropertyAccessExpression(p) && p.name === n;
                          const key = p !== null && isPropertyAssignment(p) && p.name === n;
                          if (!member && !key) local.push({ start: n.getStart(sf), end: n.getEnd(), text: p !== null && isShorthandPropertyAssignment(p) ? `${param}: ${m}.${field}` : `${m}.${field}` });
                        }
                        for (const c of children(n)) sub(c, hidden);
                      };
                      sub(updater.body as Node, false);
                    }
                    const valueNode = updater !== null ? (updater.body as Node) : arg;
                    calls.push({
                      start: callNode.getStart(sf),
                      end: callNode.getEnd(),
                      at: callNode,
                      build: () => {
                        const inside = local.filter((e) => e.start >= valueNode.getStart(sf) && e.end <= valueNode.getEnd());
                        const shifted = inside.map((e) => ({ start: e.start - valueNode.getStart(sf), end: e.end - valueNode.getStart(sf), text: e.text }));
                        const value = applyEdits(src(valueNode), shifted);
                        // `s.x = s.x + d` reads better as `s.x += d` (only where the whole right side follows the operator).
                        const target = `${m}.${field}`;
                        const compound = /^(\+|-|\*|\/) (.+)$/s.exec(value.startsWith(`${target} `) ? value.slice(target.length + 1) : "");
                        const top = valueNode as unknown as { kind: SyntaxKind; operatorToken?: { kind: SyntaxKind }; left?: Node };
                        const leftmost = top.kind === SyntaxKind.BinaryExpression && top.left !== undefined && isIdentifier(top.left) && [SyntaxKind.PlusToken, SyntaxKind.MinusToken, SyntaxKind.AsteriskToken, SyntaxKind.SlashToken].includes(top.operatorToken!.kind);
                        const assignment = compound !== null && leftmost ? `${target} ${compound[1]}= ${compound[2]}` : `${target} = ${value}`;
                        return statementPosition ? assignment : arrowBody ? `{ ${assignment}; }` : `(${assignment})`;
                      },
                    });
                  }
                } else {
                  // Passed as a value (`onChange={setX}`): a function that assigns.
                  local.push({ start: node.getStart(sf), end: node.getEnd(), text: `(value) => (${m}.${field} = value)` });
                }
              }
            }
          }
        }
        for (const c of children(node)) walk(c, [...ancestors, node], inner);
      };
      walk(body, [fn], new Set());

      /** The parent of `target` under `root`, or null. */
      function parentOf(root: Node, target: Node): Node | null {
        let found: Node | null = null;
        const go = (n: Node): void => {
          for (const c of children(n)) {
            if (c === target) found = n;
            else go(c);
          }
        };
        go(root);
        return found;
      }

      // A call replaces everything inside it: the edits within it go into its own text.
      const callEdits: Edit[] = [];
      for (const c of calls.sort((a, b) => b.start - a.start)) {
        const built = c.build();
        if (built !== null) callEdits.push({ start: c.start, end: c.end, text: built });
      }
      const kept = local.filter((e) => !callEdits.some((c) => e.start >= c.start && e.end <= c.end));
      // Calls nested in calls: keep the outermost only (its text was built from the inner edits' targets, not the inner calls).
      const outer = callEdits.filter((c) => !callEdits.some((o) => o !== c && c.start >= o.start && c.end <= o.end));
      if (outer.length !== callEdits.length) {
        fail(fn, "a setter call inside another setter call: finish it by hand");
        continue;
      }

      // The declaration: one useMutable where the first useState was, each state a field with its comment.
      const first = decls[0]!.statement;
      const indent = /[ \t]*$/.exec(text.slice(0, first.getStart(sf)))![0];
      const multiline = decls.length > 3 || decls.some((d) => d.comment !== "") || decls.map((d) => d.field).join("").length > 70;
      const fields = decls.map((d) => `${d.value}: ${d.field}`);
      const declaration = multiline
        ? `const ${m} = useMutable({\n${decls.map((d, i) => `${d.comment !== "" ? `${indent}  ${d.comment.split("\n").map((l) => l.trim()).join(`\n${indent}  `)}\n` : ""}${indent}  ${fields[i]},`).join("\n")}\n${indent}});`
        : `const ${m} = useMutable({ ${fields.join(", ")} });`;
      // From the first state's comment, which moves into the field list, to the end of its statement.
      const leading = text.slice(first.pos, first.getStart(sf));
      const from = decls[0]!.comment !== "" ? first.pos + leading.search(/\S/) : first.getStart(sf);
      edits.push({ start: from, end: first.getEnd(), text: declaration });
      for (const d of decls.slice(1)) edits.push({ start: d.statement.pos, end: d.statement.getEnd(), text: "" });
      edits.push(...kept, ...outer);
      converted++;
    }

    if (converted === 0) return { text, changed: false, problems };

    // The import: `useMutable` in place of `useState`, or beside it while a function the codemod stopped at still uses it.
    const allConverted = converted === functions.length;
    for (const statement of sf.statements) {
      if (!isImportDeclaration(statement) || !statement.importClause?.namedBindings || !isNamedImports(statement.importClause.namedBindings)) continue;
      const specifiers = statement.importClause.namedBindings.elements;
      const state = specifiers.find((s) => isImportSpecifier(s) && s.name.text === "useState");
      if (state === undefined) continue;
      const hasMutable = specifiers.some((s) => s.name.text === "useMutable");
      if (!allConverted) {
        if (!hasMutable) edits.push({ start: state.getEnd(), end: state.getEnd(), text: ", useMutable" });
      } else if (!hasMutable) {
        edits.push({ start: state.getStart(sf), end: state.getEnd(), text: "useMutable" });
      } else {
        const index = specifiers.indexOf(state);
        const start = index < specifiers.length - 1 ? state.getStart(sf) : specifiers[index - 1]!.getEnd();
        const end = index < specifiers.length - 1 ? specifiers[index + 1]!.getStart(sf) : state.getEnd();
        edits.push({ start, end, text: "" });
      }
    }
    return { text: applyEdits(text, edits), changed: true, problems };
  } finally {
    parsed.dispose();
  }
}
