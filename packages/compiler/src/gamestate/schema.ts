import { SyntaxKind } from "typescript/ast";
import type { CallExpression, Expression, ObjectLiteralExpression, SourceFile } from "typescript/ast";
import {
  isArrowFunction,
  isAsExpression,
  isBlock,
  isCallExpression,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableStatement,
} from "typescript/ast/is";

import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import type { ValueType } from "../ir/types.ts";
import { spanOf, type TsxParser } from "../parser/parser.ts";

/** A leaf of the game state: its type and the value it starts with. */
export interface GameStateLeaf {
  readonly kind: "leaf";
  readonly type: ValueType;
  readonly initial: number | string | boolean;
}

/** An object in the game state: its keys, each a leaf, another object or a value. */
export interface GameStateNode {
  readonly kind: "node";
  readonly children: Readonly<Record<string, GameStateEntry>>;
}

/**
 * Anything else in the game state: an array (`enemies: []`), or a value made by code (`run: newRun()`). The compiler does
 * not know its shape; TypeScript does, so a selector below it (`s.run.player.x`) is checked by the type-check, not here.
 */
export interface GameStateValue {
  readonly kind: "value";
}

export type GameStateEntry = GameStateLeaf | GameStateNode | GameStateValue;

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
  /** Names of the actions. */
  readonly actions: readonly string[];
}

export interface GameStateSchemaResult {
  /** Null when the file has errors, or no `createGameState` call. */
  readonly schema: Omit<GameStateDefinition, "importFrom"> | null;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

const SHAPE =
  "GameState.ts must contain `export const useGame = createGameState({ coins: 0, player: { hp: 10 } }, { collect(s) { s.coins += 1; } });`";

/**
 * Reads `GameState.ts`: `createGameState(creator)` or `createGameState<State>()(creator)`, exported under a name
 * components import. The creator is an arrow or function whose result is an object literal: the state. Its leaves are
 * number, string or boolean literals (a negative number is fine; a leaf's type is its literal's: `0` is a `number`),
 * objects of those nested as deep as you like, and, at the top level, functions: the actions. Any other value (an array,
 * a call such as `newRun()`) is a `GameStateValue`: its type comes from TypeScript. Spreads and computed keys are `RGE1109`.
 */
export function parseGameState(parser: TsxParser, fileName: string, text: string): GameStateSchemaResult {
  const parsed = parser.parse(fileName, text);
  try {
    const sourceFile = parsed.sourceFile;
    const diagnostics: CompilerDiagnostic[] = [];
    const fail: Fail = (message, node) => {
      diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, message, spanOf(node as never, sourceFile, fileName)));
    };
    let result: Omit<GameStateDefinition, "importFrom"> | null = null;
    let found = 0;
    for (const statement of sourceFile.statements) {
      if (!isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer ? unwrap(declaration.initializer) : undefined;
        const split = init && isCallExpression(init) ? dataAndActions(init) : undefined;
        const creatorCall = split ? split.data : init && isCallExpression(init) ? creatorOf(init) : undefined;
        if (!creatorCall) continue;
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
        if (split) {
          const before = diagnostics.length;
          if (!isObjectLiteralExpression(split.data)) {
            fail(
              `The game state's data is an object literal: \`createGameState({ coins: 0, player: { hp: 10 } }, { … })\`. ${SHAPE}`,
              split.data
            );
            continue;
          }
          if (!isObjectLiteralExpression(split.actions)) {
            fail(
              `The game state's actions are an object literal of functions: \`{ collect(s) { s.coins += 1; } }\`. ${SHAPE}`,
              split.actions
            );
            continue;
          }
          const tree = readNode(split.data, fail, null, "data");
          const actions = readActions(split.actions, fail, tree);
          if (diagnostics.length === before) result = { name: declaration.name.text, tree, actions };
          continue;
        }
        const object = stateObject(creatorCall);
        if (!object) {
          fail(
            `The creator must be an arrow function (or function) that returns the state as an object literal: \`(set) => ({ coins: 0, … })\`. ${SHAPE}`,
            creatorCall
          );
          continue;
        }
        const before = diagnostics.length;
        const actions: string[] = [];
        const tree = readNode(object, fail, actions);
        if (diagnostics.length === before) result = { name: declaration.name.text, tree, actions };
      }
    }
    if (found === 0)
      diagnostics.push(error(DiagnosticCode.InvalidGameStateSchema, `${SHAPE}.`, { fileName, start: 0, end: 0, line: 1, column: 1 }));
    return { schema: diagnostics.length === 0 ? result : null, diagnostics };
  } finally {
    parsed.dispose();
  }
}

type Fail = (message: string, node: { getStart(sf: SourceFile): number; getEnd(): number }) => void;

/** The creator argument of `createGameState(creator)` or `createGameState<State>()(creator)`; undefined if the call is neither. */
function creatorOf(call: CallExpression): Expression | undefined {
  const callee = unwrap(call.expression);
  if (isIdentifier(callee) && callee.text === "createGameState") return call.arguments[0] ? unwrap(call.arguments[0]) : undefined;
  if (
    isCallExpression(callee) &&
    isIdentifier(callee.expression) &&
    callee.expression.text === "createGameState" &&
    callee.arguments.length === 0
  ) {
    return call.arguments[0] ? unwrap(call.arguments[0]) : undefined;
  }
  return undefined;
}

/** `createGameState(data, actions)`: its two arguments; undefined if the call is not that form. */
function dataAndActions(call: CallExpression): { data: Expression; actions: Expression } | undefined {
  const callee = unwrap(call.expression);
  if (!isIdentifier(callee) || callee.text !== "createGameState" || call.arguments.length !== 2) return undefined;
  return { data: unwrap(call.arguments[0]!), actions: unwrap(call.arguments[1]!) };
}

/** The names of `createGameState`'s actions: each `name(s, …) {}` or `name: (s, …) => …`, not a name the data has. */
function readActions(object: ObjectLiteralExpression, fail: Fail, tree: GameStateNode): string[] {
  const names: string[] = [];
  for (const p of object.properties) {
    const name =
      (isPropertyAssignment(p) || isMethodDeclaration(p)) && (isIdentifier(p.name) || isStringLiteral(p.name)) ? p.name.text : null;
    const value = isPropertyAssignment(p) ? unwrap(p.initializer) : null;
    if (name === null || (!isMethodDeclaration(p) && !(value !== null && (isArrowFunction(value) || isFunctionExpression(value))))) {
      fail("Each action is `name(s, …) { … }` or `name: (s, …) => …`: no spreads, computed keys or values.", p);
      continue;
    }
    if (names.includes(name) || Object.hasOwn(tree.children, name)) {
      fail(`'${name}' is declared twice: an action cannot share a name with another action or a value of the data.`, p);
      continue;
    }
    names.push(name);
  }
  return names;
}

/** The object literal a creator returns: an arrow's expression body, or the one `return` of a block. */
function stateObject(creator: Expression): ObjectLiteralExpression | null {
  if (!isArrowFunction(creator) && !isFunctionExpression(creator)) return null;
  const body = creator.body;
  if (!body) return null;
  if (!isBlock(body)) {
    const expression = unwrap(body);
    return isObjectLiteralExpression(expression) ? expression : null;
  }
  const returns = body.statements.filter(isReturnStatement);
  const only = body.statements.length === 1 ? returns[0] : undefined;
  const expression = only?.expression ? unwrap(only.expression) : undefined;
  return expression && isObjectLiteralExpression(expression) ? expression : null;
}

function readNode(
  object: ObjectLiteralExpression,
  fail: Fail,
  actions: string[] | null,
  form: "creator" | "data" = "creator"
): GameStateNode {
  const children: Record<string, GameStateEntry> = {};
  for (const p of object.properties) {
    const named =
      (isPropertyAssignment(p) || isMethodDeclaration(p) || isShorthandPropertyAssignment(p)) &&
      (isIdentifier(p.name) || isStringLiteral(p.name))
        ? p.name.text
        : null;
    if (named === null) {
      fail("Each state entry is `key: value` or an action `name() {}`: no spreads or computed keys.", p);
      continue;
    }
    const key = named;
    if (key.includes(".")) {
      fail(`'${key}': a state key cannot contain a dot (paths are written with dots).`, p);
      continue;
    }
    if (Object.hasOwn(children, key) || actions?.includes(key)) {
      fail(`'${key}' is declared twice.`, p);
      continue;
    }
    if (isShorthandPropertyAssignment(p)) {
      children[key] = { kind: "value" };
      continue;
    }
    const value = isPropertyAssignment(p) ? unwrap(p.initializer) : null;
    if (value === null || isArrowFunction(value) || isFunctionExpression(value)) {
      if (form === "data")
        fail(
          `'${key}' is a function in the game state's data: actions go in the second argument, \`createGameState(data, { ${key}(s) { … } })\`.`,
          p
        );
      else if (actions === null)
        fail(`'${key}' is a function inside a nested object: actions live at the top level of the state, next to the objects.`, p);
      else actions.push(key);
      continue;
    }
    if (isObjectLiteralExpression(value)) {
      children[key] = readNode(value, fail, null, form);
      continue;
    }
    children[key] = literalLeaf(value) ?? { kind: "value" };
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
  if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.MinusToken && isNumericLiteral(node.operand))
    return { kind: "leaf", type: "number", initial: -Number(node.operand.text) };
  if (isStringLiteral(node)) return { kind: "leaf", type: "string", initial: node.text };
  if (node.kind === SyntaxKind.TrueKeyword) return { kind: "leaf", type: "boolean", initial: true };
  if (node.kind === SyntaxKind.FalseKeyword) return { kind: "leaf", type: "boolean", initial: false };
  return null;
}
