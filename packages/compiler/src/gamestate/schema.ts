import { SyntaxKind } from "typescript/ast";
import {
  isAsExpression,
  isCallExpression,
  isIdentifier,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/ast/is";
import type { Expression, ObjectLiteralExpression, SourceFile } from "typescript/ast";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import type { ValueType } from "../ir/types.ts";
import { spanOf, type TsxParser } from "../parser/parser.ts";

/** A leaf of the game state: its type and the value it starts with. */
export interface GameStateLeaf {
  readonly kind: "leaf";
  readonly type: ValueType;
  readonly initial: number | string | boolean;
}

/** An object in the game state: its keys, each a leaf or another object. */
export interface GameStateNode {
  readonly kind: "node";
  readonly children: Readonly<Record<string, GameStateLeaf | GameStateNode>>;
}

/**
 * The project's game state, as the compiler needs it: what `GameState.ts`'s `createGameState({ state, actions })`
 * declares. The compiler never runs that file (generated code imports it); it reads it to check selectors against the
 * state tree and to tell an action from a value.
 */
export interface GameStateDefinition {
  /** The exported name components import (`useGame`). */
  readonly name: string;
  /** What generated code writes in its `import … from`: the module, relative to the generated file (`../src/GameState.ts`). */
  readonly importFrom: string;
  readonly tree: GameStateNode;
}

export interface GameStateSchemaResult {
  /** Null when the file has errors, or no `createGameState` call. */
  readonly schema: Omit<GameStateDefinition, "importFrom"> | null;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

const SHAPE = "GameState.ts must contain `export const useGame = createGameState({ coins: 0, player: { hp: 10 } });`";

/**
 * Reads `GameState.ts`. The argument of `createGameState` is an object literal, nested as deep as you like, whose
 * leaves are number, string or boolean literals (a negative number is fine); a leaf's type is its literal's (`0` is a
 * `number`). Anything else is `RGE1109`, saying what to write instead. Arrays are not supported yet.
 */
export function parseGameState(parser: TsxParser, fileName: string, text: string): GameStateSchemaResult {
  const parsed = parser.parse(fileName, text);
  try {
    const sourceFile = parsed.sourceFile;
    const diagnostics: CompilerDiagnostic[] = [];
    const fail = (message: string, node: { getStart(sf: SourceFile): number; getEnd(): number }): void => {
      diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, message, spanOf(node as never, sourceFile, fileName)));
    };
    let result: Omit<GameStateDefinition, "importFrom"> | null = null;
    let found = 0;
    for (const statement of sourceFile.statements) {
      if (!isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer ? unwrap(declaration.initializer) : undefined;
        if (!init || !isCallExpression(init) || !isIdentifier(init.expression) || init.expression.text !== "createGameState") continue;
        found++;
        if (found > 1) {
          fail("A project has one game state: `createGameState` is called more than once.", declaration);
          continue;
        }
        const exported = statement.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false;
        if (!exported || !isIdentifier(declaration.name)) {
          fail(`${SHAPE}: export it, under a name (\`useGame\`) components import.`, declaration);
          continue;
        }
        const config = init.arguments[0] ? unwrap(init.arguments[0]) : undefined;
        if (!config || !isObjectLiteralExpression(config)) {
          fail(`${SHAPE}.`, init);
          continue;
        }
        const before = diagnostics.length;
        const tree = readNode(config, fail);
        if (diagnostics.length === before) result = { name: declaration.name.text, tree };
      }
    }
    if (found === 0) diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `${SHAPE}.`, { fileName, start: 0, end: 0, line: 1, column: 1 }));
    return { schema: diagnostics.length === 0 ? result : null, diagnostics };
  } finally {
    parsed.dispose();
  }
}

type Fail = (message: string, node: { getStart(sf: SourceFile): number; getEnd(): number }) => void;

function readNode(object: ObjectLiteralExpression, fail: Fail): GameStateNode {
  const children: Record<string, GameStateLeaf | GameStateNode> = {};
  for (const p of object.properties) {
    if (!isPropertyAssignment(p) || !(isIdentifier(p.name) || isStringLiteral(p.name))) {
      fail("Each state entry is `key: value`: no spreads, methods, shorthand or computed keys.", p);
      continue;
    }
    const key = p.name.text;
    if (key.includes(".")) {
      fail(`'${key}': a state key cannot contain a dot (paths are written with dots).`, p);
      continue;
    }
    if (Object.hasOwn(children, key)) {
      fail(`'${key}' is declared twice.`, p);
      continue;
    }
    const value = unwrap(p.initializer);
    if (isObjectLiteralExpression(value)) {
      children[key] = readNode(value, fail);
      continue;
    }
    const leaf = literalLeaf(value);
    if (!leaf) {
      fail(`'${key}' must start as a number, string or boolean literal, or an object of them (arrays are not supported yet).`, p.initializer);
      continue;
    }
    children[key] = leaf;
  }
  return { kind: "node", children };
}

/** `as const`, `satisfies` and parentheses are fine around a value; they do not change it. */
function unwrap(expression: Expression): Expression {
  let current = expression;
  for (;;) {
    if (isParenthesizedExpression(current) || isAsExpression(current) || isSatisfiesExpression(current)) current = current.expression;
    else return current;
  }
}

function literalLeaf(node: Expression): GameStateLeaf | null {
  if (isNumericLiteral(node)) return { kind: "leaf", type: "number", initial: Number(node.text) };
  if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.MinusToken && isNumericLiteral(node.operand)) return { kind: "leaf", type: "number", initial: -Number(node.operand.text) };
  if (isStringLiteral(node)) return { kind: "leaf", type: "string", initial: node.text };
  if (node.kind === SyntaxKind.TrueKeyword) return { kind: "leaf", type: "boolean", initial: true };
  if (node.kind === SyntaxKind.FalseKeyword) return { kind: "leaf", type: "boolean", initial: false };
  return null;
}
