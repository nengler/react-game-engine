/**
 * Scene validation: a scene file against the prefab schema, as compiler
 * diagnostics. The scene is parsed into an AST (not `JSON.parse`d), so each
 * problem points at the real line and column of the offending value, and the
 * message carries its JSON path (`entities[1].props.speed`).
 */
import { SyntaxKind, type Expression, type Node, type ObjectLiteralExpression, type SourceFile } from "typescript/ast";
import { isArrayLiteralExpression, isNumericLiteral, isObjectLiteralExpression, isPrefixUnaryExpression, isPropertyAssignment, isStringLiteral } from "typescript/ast/is";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import type { PropTypeIR } from "../ir/types.ts";
import { spanOf, type TsxParser } from "../parser/parser.ts";
import type { PrefabSchema } from "../prefabs/prefabs.ts";

export const SCENE_VERSION = 1;
const ENTITY_KEYS = ["id", "prefab", "props", "transform", "children"];
const TRANSFORM_NUMBERS = ["x", "y", "z", "rotation", "scaleX", "scaleY"];

type Code = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export function validateScene(parser: TsxParser, fileName: string, text: string, prefabs: ReadonlyMap<string, PrefabSchema>): CompilerDiagnostic[] {
  try {
    JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const where = /line (\d+) column (\d+)/.exec(message);
    const line = where ? Number(where[1]) : 1;
    const column = where ? Number(where[2]) : 1;
    return [error(DiagnosticCode.SceneSyntax, `Invalid JSON: ${message}`, { fileName, start: 0, end: 0, line, column })];
  }
  const parsed = parser.parseJson(fileName, text);
  try {
    return new SceneValidator(parsed.sourceFile, fileName, prefabs).validate();
  } finally {
    parsed.dispose();
  }
}

class SceneValidator {
  readonly #sf: SourceFile;
  readonly #fileName: string;
  readonly #prefabs: ReadonlyMap<string, PrefabSchema>;
  readonly #diagnostics: CompilerDiagnostic[] = [];
  readonly #ids = new Map<string, string>();

  constructor(sourceFile: SourceFile, fileName: string, prefabs: ReadonlyMap<string, PrefabSchema>) {
    this.#sf = sourceFile;
    this.#fileName = fileName;
    this.#prefabs = prefabs;
  }

  validate(): CompilerDiagnostic[] {
    const statement = this.#sf.statements[0];
    const root = statement && statement.kind === SyntaxKind.ExpressionStatement ? (statement as unknown as { expression: Expression }).expression : null;
    if (!root || !isObjectLiteralExpression(root)) {
      this.#report(DiagnosticCode.SceneShape, "A scene is an object: { \"version\": 1, \"entities\": [ … ] }.", statement ?? this.#sf, "$");
      return this.#diagnostics;
    }
    let sawEntities = false;
    for (const [key, value] of this.#members(root, ["version", "entities"], "$")) {
      if (key === "version") {
        if (!isNumericLiteral(value) || Number(value.text) !== SCENE_VERSION) this.#report(DiagnosticCode.SceneShape, `Unsupported scene version ${value.getText(this.#sf)}: this compiler reads version ${SCENE_VERSION}.`, value, "version");
      } else {
        sawEntities = true;
        this.#entities(value, "entities");
      }
    }
    if (!sawEntities) this.#report(DiagnosticCode.SceneShape, "A scene needs an `entities` array.", root, "$");
    return this.#diagnostics;
  }

  #entities(node: Expression, path: string): void {
    if (!isArrayLiteralExpression(node)) {
      this.#report(DiagnosticCode.SceneShape, `${path} must be an array of entities.`, node, path);
      return;
    }
    node.elements.forEach((element, index) => this.#entity(element, `${path}[${index}]`));
  }

  #entity(node: Expression, path: string): void {
    if (!isObjectLiteralExpression(node)) {
      this.#report(DiagnosticCode.SceneShape, "An entity is an object: { \"id\": …, \"prefab\": … }.", node, path);
      return;
    }
    const members = new Map(this.#members(node, ENTITY_KEYS, path));
    const id = members.get("id");
    if (!id) this.#report(DiagnosticCode.SceneShape, "An entity needs an `id`: a string that stays the same when the scene is edited.", node, path);
    else if (!isStringLiteral(id) || id.text === "") this.#report(DiagnosticCode.SceneShape, `${path}.id must be a non-empty string.`, id, `${path}.id`);
    else if (this.#ids.has(id.text)) this.#report(DiagnosticCode.DuplicateSceneId, `Duplicate id '${id.text}' (first used at ${this.#ids.get(id.text)}).`, id, `${path}.id`);
    else this.#ids.set(id.text, `${path}.id`);

    const prefabNode = members.get("prefab");
    let prefab: PrefabSchema | undefined;
    if (!prefabNode) this.#report(DiagnosticCode.SceneShape, "An entity needs a `prefab`: the name of an exported component.", node, path);
    else if (!isStringLiteral(prefabNode)) this.#report(DiagnosticCode.SceneShape, `${path}.prefab must be a string.`, prefabNode, `${path}.prefab`);
    else {
      prefab = this.#prefabs.get(prefabNode.text);
      if (!prefab) {
        const known = [...this.#prefabs.keys()].sort();
        this.#report(DiagnosticCode.UnknownPrefab, `Unknown prefab '${prefabNode.text}'. Prefabs: ${known.join(", ") || "none (export a component)"}.`, prefabNode, `${path}.prefab`);
      }
    }

    const props = members.get("props");
    if (props) this.#props(props, prefab, `${path}.props`);
    else if (prefab) this.#missing(prefab, new Set(), node, path);
    const transform = members.get("transform");
    if (transform) this.#transform(transform, `${path}.transform`);
    const children = members.get("children");
    if (children) this.#entities(children, `${path}.children`);
  }

  #props(node: Expression, prefab: PrefabSchema | undefined, path: string): void {
    if (!isObjectLiteralExpression(node)) {
      this.#report(DiagnosticCode.SceneShape, `${path} must be an object of prop values.`, node, path);
      return;
    }
    const given = new Set<string>();
    for (const [name, value] of this.#members(node, null, path)) {
      given.add(name);
      if (!prefab) continue;
      const prop = prefab.props.find((p) => p.name === name);
      if (!prop) {
        this.#report(DiagnosticCode.UnknownPrefabProp, `${prefab.name} has no prop '${name}'${prefab.props.length ? ` (props: ${prefab.props.map((p) => p.name).join(", ")})` : " (it takes no props)"}. Callback props cannot be set from data.`, value, `${path}.${name}`);
      } else if (!prop.settable) {
        this.#report(DiagnosticCode.PropNotSettable, `Prop '${name}' of ${prefab.name} is typed ${describeType(prop.type)}, which data cannot express, so it can only be set from code.`, value, `${path}.${name}`);
      } else {
        this.#value(value, prop.type, `${path}.${name}`);
      }
    }
    if (prefab) this.#missing(prefab, given, node, path);
  }

  #missing(prefab: PrefabSchema, given: ReadonlySet<string>, at: Node, path: string): void {
    for (const prop of prefab.props) {
      if (!prop.optional && !given.has(prop.name)) this.#report(DiagnosticCode.MissingPrefabProp, `${prefab.name} needs the prop '${prop.name}' (${describeType(prop.type)}).`, at, path);
    }
  }

  #transform(node: Expression, path: string): void {
    if (!isObjectLiteralExpression(node)) {
      this.#report(DiagnosticCode.SceneShape, `${path} must be an object: { "x": 0, "y": 0 }.`, node, path);
      return;
    }
    for (const [name, value] of this.#members(node, [...TRANSFORM_NUMBERS, "global"], path)) {
      this.#value(value, name === "global" ? { kind: "Primitive", name: "boolean" } : { kind: "Primitive", name: "number" }, `${path}.${name}`);
    }
  }

  /** A JSON value against a prop type, reporting on the offending node. */
  #value(node: Expression, type: PropTypeIR, path: string): void {
    const wrong = (expected: string): void => this.#report(DiagnosticCode.WrongPropType, `Expected ${expected}, got ${this.#describe(node)}.`, node, path);
    switch (type.kind) {
      case "Primitive":
        if (type.name === "number" ? numberValue(node) === null : type.name === "string" ? !isStringLiteral(node) : node.kind !== SyntaxKind.TrueKeyword && node.kind !== SyntaxKind.FalseKeyword) wrong(type.name === "number" ? "a number" : type.name === "string" ? "a string" : "true or false");
        return;
      case "Literals": {
        const value = isStringLiteral(node) ? node.text : numberValue(node);
        if (value === null || !type.values.includes(value)) wrong(`one of ${type.values.map((v) => JSON.stringify(v)).join(", ")}`);
        return;
      }
      case "Array":
        if (!isArrayLiteralExpression(node)) wrong(`an array of ${describeType(type.element)}`);
        else node.elements.forEach((element, i) => this.#value(element, type.element, `${path}[${i}]`));
        return;
      case "Function":
      case "SourceText":
        return; // not settable: reported by the caller
    }
  }

  /** The members of an object, as [name, value]; reports non-property members and (given `allowed`) unknown or repeated keys. */
  #members(node: ObjectLiteralExpression, allowed: readonly string[] | null, path: string): [string, Expression][] {
    const out: [string, Expression][] = [];
    const seen = new Set<string>();
    for (const member of node.properties) {
      if (!isPropertyAssignment(member) || !isStringLiteral(member.name)) {
        this.#report(DiagnosticCode.SceneShape, "Expected a \"name\": value pair.", member, path);
        continue;
      }
      const name = member.name.text;
      if (seen.has(name)) {
        this.#report(DiagnosticCode.SceneShape, `Duplicate key '${name}'.`, member.name, `${path}.${name}`);
        continue;
      }
      seen.add(name);
      if (allowed && !allowed.includes(name)) {
        this.#report(DiagnosticCode.SceneShape, `Unknown key '${name}' (expected: ${allowed.join(", ")}).`, member.name, `${path}.${name}`);
        continue;
      }
      out.push([name, member.initializer]);
    }
    return out;
  }

  #describe(node: Expression): string {
    if (isStringLiteral(node)) return `the string ${JSON.stringify(node.text)}`;
    if (numberValue(node) !== null) return `the number ${node.getText(this.#sf)}`;
    if (node.kind === SyntaxKind.TrueKeyword || node.kind === SyntaxKind.FalseKeyword) return node.getText(this.#sf);
    if (node.kind === SyntaxKind.NullKeyword) return "null";
    if (isArrayLiteralExpression(node)) return "an array";
    if (isObjectLiteralExpression(node)) return "an object";
    return node.getText(this.#sf);
  }

  #report(code: Code, message: string, at: Node, path: string): void {
    this.#diagnostics.push(error(code, `${path === "$" ? "" : `${path}: `}${message}`, spanOf(at, this.#sf, this.#fileName)));
  }
}

/** A JSON number literal, including a negative one (`-3` is a prefix operator and a literal). */
function numberValue(node: Expression): number | null {
  if (isNumericLiteral(node)) return Number(node.text);
  if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.MinusToken && isNumericLiteral(node.operand)) return -Number(node.operand.text);
  return null;
}

function describeType(type: PropTypeIR): string {
  switch (type.kind) {
    case "Primitive": return type.name;
    case "Literals": return type.values.map((v) => JSON.stringify(v)).join(" | ");
    case "Array": return `${describeType(type.element)}[]`;
    case "Function": return "a function";
    case "SourceText": return type.text;
  }
}
