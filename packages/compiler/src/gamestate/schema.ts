import { SyntaxKind } from "typescript/ast";
import {
  isIdentifier,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableStatement,
  isAsExpression,
  isSatisfiesExpression,
} from "typescript/ast/is";
import type { Expression } from "typescript/ast";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import type { ValueType } from "../ir/types.ts";
import { spanOf, type TsxParser } from "../parser/parser.ts";

/** One key of the game's global state: its type and the value it starts with. */
export interface GameStateEntry {
  readonly type: ValueType;
  readonly initial: number | string | boolean;
}

/** The project's global state, by key (`GameState.ts`). */
export type GameStateDefinition = Readonly<Record<string, GameStateEntry>>;

export interface GameStateSchemaResult {
  readonly schema: GameStateDefinition;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/**
 * Reads `GameState.ts`: `export const gameState = { coins: 0, name: "Ada", muted: false }`. Every value is a number,
 * string or boolean literal (a negative number is fine), and its type is the literal's: `0` is a `number`. Anything
 * else is `RGE1109`, saying what to write instead. Arrays and records are not supported yet.
 */
export function parseGameState(parser: TsxParser, fileName: string, text: string): GameStateSchemaResult {
  const parsed = parser.parse(fileName, text);
  try {
    const sourceFile = parsed.sourceFile;
    const diagnostics: CompilerDiagnostic[] = [];
    const schema: Record<string, GameStateEntry> = {};
    const shape = "GameState.ts must contain `export const gameState = { coins: 0, playerName: \"Ada\", muted: false };`";
    let found = false;
    for (const statement of sourceFile.statements) {
      if (!isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!isIdentifier(declaration.name) || declaration.name.text !== "gameState") continue;
        found = true;
        const exported = statement.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false;
        const init = declaration.initializer ? unwrap(declaration.initializer) : undefined;
        if (!exported || !init || !isObjectLiteralExpression(init)) {
          diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `${shape}.`, spanOf(declaration, sourceFile, fileName)));
          continue;
        }
        for (const property of init.properties) {
          const at = spanOf(property, sourceFile, fileName);
          if (!isPropertyAssignment(property) || !(isIdentifier(property.name) || isStringLiteral(property.name))) {
            diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, "Each game state entry is `key: literal`: no spreads, methods, shorthand or computed keys.", at));
            continue;
          }
          const key = property.name.text;
          if (Object.hasOwn(schema, key)) {
            diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `'${key}' is declared twice.`, at));
            continue;
          }
          const entry = literalEntry(unwrap(property.initializer));
          if (!entry) {
            diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `'${key}' must start as a number, string or boolean literal (arrays and records are not supported yet).`, spanOf(property.initializer, sourceFile, fileName)));
            continue;
          }
          schema[key] = entry;
        }
      }
    }
    if (!found) diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `${shape}.`, { fileName, start: 0, end: 0, line: 1, column: 1 }));
    return { schema, diagnostics };
  } finally {
    parsed.dispose();
  }
}

/** `as const` and `satisfies` are fine around a literal; they do not change it. */
function unwrap(expression: Expression): Expression {
  let current = expression;
  for (;;) {
    if (isParenthesizedExpression(current) || isAsExpression(current) || isSatisfiesExpression(current)) current = current.expression;
    else return current;
  }
}

function literalEntry(node: Expression): GameStateEntry | null {
  if (isNumericLiteral(node)) return { type: "number", initial: Number(node.text) };
  if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.MinusToken && isNumericLiteral(node.operand)) return { type: "number", initial: -Number(node.operand.text) };
  if (isStringLiteral(node)) return { type: "string", initial: node.text };
  if (node.kind === SyntaxKind.TrueKeyword) return { type: "boolean", initial: true };
  if (node.kind === SyntaxKind.FalseKeyword) return { type: "boolean", initial: false };
  return null;
}

/**
 * The declaration that gives `useGameState("key")` its types while authored components are type-checked: it adds each
 * key to the authoring module's `GameStateSchema`. A virtual file, never written.
 */
export function gameStateDeclarations(schema: GameStateDefinition, authoringModule: string): string {
  const members = Object.entries(schema).map(([key, entry]) => `    ${JSON.stringify(key)}: ${entry.type};`);
  return `export {};\ndeclare module ${JSON.stringify(authoringModule)} {\n  interface GameStateSchema {\n${members.join("\n")}\n  }\n}\n`;
}
