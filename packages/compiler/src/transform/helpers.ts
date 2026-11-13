// Shared declarations of the component lowering: constants, helper functions and types used by transform.ts and
// the layers (lowering.ts, expressions.ts, hooks.ts, elements.ts).
import { SyntaxKind, type JsxElement, type JsxSelfClosingElement, type JsxAttribute, type JsxAttributes, type Node } from "typescript/ast";
import { isIdentifier, isJsxAttribute, isJsxElement, isNumericLiteral, isParenthesizedTypeNode, isLiteralTypeNode, isJsxFragment, isJsxSelfClosingElement, isStringLiteral } from "typescript/ast/is";
import { type JsxRoot } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { assertNever, cycleThrough, type TypeIR, type PropTypeIR, type BinaryOperator, type ChildIR, type ComponentIR, type UnaryOperator } from "../ir/types.ts";



/** The root element that carries the game's configuration (`<Game title width …>`); it is only ever a component's root. */
export const GAME_TAG = "Game";

/** The runtime class generated code constructs for each `useSound`; a component may not take the name. */
export const SOUND_CLASS = "Sound";

export const BINARY_OPERATORS: ReadonlyMap<SyntaxKind, BinaryOperator> = new Map([
  [SyntaxKind.PlusToken, "+"], [SyntaxKind.MinusToken, "-"], [SyntaxKind.AsteriskToken, "*"],
  [SyntaxKind.SlashToken, "/"], [SyntaxKind.PercentToken, "%"], [SyntaxKind.AsteriskAsteriskToken, "**"],
  [SyntaxKind.LessThanToken, "<"], [SyntaxKind.LessThanEqualsToken, "<="],
  [SyntaxKind.GreaterThanToken, ">"], [SyntaxKind.GreaterThanEqualsToken, ">="],
  [SyntaxKind.EqualsEqualsEqualsToken, "==="], [SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [SyntaxKind.EqualsEqualsToken, "=="], [SyntaxKind.ExclamationEqualsToken, "!="],
  [SyntaxKind.AmpersandAmpersandToken, "&&"], [SyntaxKind.BarBarToken, "||"],
  [SyntaxKind.QuestionQuestionToken, "??"],
  [SyntaxKind.InstanceOfKeyword, "instanceof"], [SyntaxKind.InKeyword, "in"],
] as const);

export const UNARY_OPERATORS: ReadonlyMap<SyntaxKind, UnaryOperator> = new Map([
  [SyntaxKind.ExclamationToken, "!"], [SyntaxKind.MinusToken, "-"], [SyntaxKind.PlusToken, "+"],
] as const);

export const HANDLER_KIND = {
  useUpdate: "OnUpdate",
  useInput: "OnInput",
  useMount: "OnMount",
  useUnmount: "OnUnmount",
} as const;

/** Names imported from the authoring module, shared by every component of a file. */
export interface AuthoringImports {
  readonly names: ReadonlySet<string>;
  /** Names already reported as missing, so each is reported once. */
  readonly reported: Set<string>;
}

/** Names a component cannot declare as props: the framework reads them off the element. */
export const RESERVED_PROP_NAMES: ReadonlySet<string> = new Set(["key", "ref", "transform", "children"]);

/** The built-in a component's root is: its tag, or the host intrinsic for a fragment. */
export function rootTag(jsx: JsxRoot, hostIntrinsic: string): string {
  if (isJsxFragment(jsx) || !(isJsxElement(jsx) || isJsxSelfClosingElement(jsx))) return hostIntrinsic;
  const tag = (isJsxElement(jsx) ? jsx.openingElement : jsx).tagName;
  return isIdentifier(tag) ? tag.text : hostIntrinsic;
}

export type JsxElementNode = JsxElement | JsxSelfClosingElement;

export function unwrapTypeParens(node: Node): Node {
  let current = node;
  while (isParenthesizedTypeNode(current)) current = current.type;
  return current;
}

/** The value of a string or number literal type (`"fast"`, `3`), else null. */
export function literalValue(node: Node): string | number | null {
  if (!isLiteralTypeNode(node)) return null;
  if (isStringLiteral(node.literal)) return node.literal.text;
  if (isNumericLiteral(node.literal)) return Number(node.literal.text);
  return null;
}

/**
 * The closest of `choices` to `word`, if it is plausibly what was meant: one
 * is the start of the other (`rectangle` for `rect`), or they are at most 2
 * edits apart (and fewer than the word's length). Case is ignored.
 */
export function nearest(word: string, choices: readonly string[]): string | null {
  const distance = (a: string, b: string): number => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length]!;
  };
  let best: { choice: string; d: number } | null = null;
  const lower = word.toLowerCase();
  for (const choice of choices) {
    const prefix = lower.length >= 3 && (lower.startsWith(choice.toLowerCase()) || choice.toLowerCase().startsWith(lower));
    const d = prefix ? 0 : distance(lower, choice.toLowerCase());
    if (d <= 2 && d < word.length && (!best || d < best.d)) best = { choice, d };
  }
  return best?.choice ?? null;
}

/** `&amp;`, `&#38;`: JSX decodes these, and the compiler does not, so it asks for the character itself. */
export const HTML_ENTITY = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

/**
 * JSX text with React's whitespace rules: each line is trimmed (the first line
 * only at its end, the last only at its start), blank lines are dropped, and
 * the lines are joined with one space. So `<Text>\n  Score: {score}\n</Text>`
 * is `Score: ` and the expression, and `{a} {b}` keeps its space.
 */
export function cleanJsxText(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, " ");
    if (i !== 0) trimmed = trimmed.replace(/^ +/, "");
    if (i !== lines.length - 1) trimmed = trimmed.replace(/ +$/, "");
    if (trimmed !== "") out += i === lastNonEmpty ? trimmed : trimmed + " ";
  });
  return out;
}

/** Attributes the compiler handles itself; they never become props. */
export const SPECIAL_ATTRIBUTES: ReadonlySet<string> = new Set(["transform"]);

/** A declared prop's type as a state type (`useState(items)` takes the prop's type). */
export function propTypeToType(type: PropTypeIR): TypeIR | null {
  switch (type.kind) {
    case "Primitive": return { kind: "Primitive", name: type.name };
    case "Literals": return { kind: "SourceType", text: type.values.map((v) => JSON.stringify(v)).join(" | ") };
    case "Array": {
      const element = propTypeToType(type.element);
      return element && { kind: "Array", element };
    }
    case "Function": return null;
    case "SourceText": return { kind: "SourceType", text: type.text };
    default: return assertNever(type, "prop type");
  }
}

export function findAttribute(attributes: JsxAttributes, name: string): JsxAttribute | null {
  for (const attribute of attributes.properties) {
    if (isJsxAttribute(attribute) && isIdentifier(attribute.name) && attribute.name.text === name) return attribute;
  }
  return null;
}

/** A component that statically contains itself (directly or indirectly) would construct forever. */
export function checkStaticCycles(components: readonly ComponentIR[], diagnostics: CompilerDiagnostic[]): void {
  const edges = new Map<string, string[]>();
  for (const c of components) {
    const targets: string[] = [];
    const walk = (children: readonly ChildIR[]): void => {
      for (const child of children) {
        if (child.kind !== "StaticChild") continue;
        if (child.element.component.kind === "Local") targets.push(child.element.component.name);
        walk(child.element.children);
      }
    };
    walk(c.root.children);
    edges.set(c.name, targets);
  }
  for (const c of components) {
    if (cycleThrough(c.name, edges)) diagnostics.push(error(DiagnosticCode.ComponentCycle, `Component '${c.name}' statically contains itself.`, c.span));
  }
}
