import { SyntaxKind, type CallExpression, type Expression, type PropertyAccessExpression, type JsxAttributes, type JsxChild, type Node, type SourceFile } from "typescript/ast";
import {
  isBinaryExpression,
  isCallExpression,
  isPropertyAccessExpression,
  isTemplateExpression,
  isConditionalExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isJsxText,
  isNumericLiteral,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isStringLiteral,
  isNoSubstitutionTemplateLiteral,
} from "typescript/ast/is";
import { unwrapParens, type ComponentAnalysis, type JsxRoot, type SourceAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import {
  assertNever,
  collectDependencies,
  elementId,
  stateId,
  type BinaryOperator,
  type ChildIR,
  type ComponentIR,
  type ComponentRef,
  type ElementIR,
  type CalleeIR,
  type ExprIR,
  type ParamReadIR,
  type HookIR,
  type HostElementIR,
  type IRModule,
  type PropIR,
  type SourceSpan,
  type StateId,
  type StateIR,
  type UnaryOperator,
  type ValueType,
} from "../ir/types.ts";
import { spanOf } from "../parser/parser.ts";
import { HANDLER_SIGNATURES } from "../ir/handlers.ts";
import { MATH_FUNCTIONS } from "./handles.ts";
import type { RuntimeManifest } from "@rge/runtime";
import { Scope } from "./scope.ts";
import { lowerFunction, type LoweringContext } from "./statements.ts";

export interface TransformOptions {
  /** What the runtime provides: intrinsic tags, the host class, reserved member names, handle types, functions. */
  readonly manifest: RuntimeManifest;
}

export interface TransformResult {
  readonly module: IRModule;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

const BINARY_OPERATORS: ReadonlyMap<SyntaxKind, BinaryOperator> = new Map([
  [SyntaxKind.PlusToken, "+"], [SyntaxKind.MinusToken, "-"], [SyntaxKind.AsteriskToken, "*"],
  [SyntaxKind.SlashToken, "/"], [SyntaxKind.PercentToken, "%"],
  [SyntaxKind.LessThanToken, "<"], [SyntaxKind.LessThanEqualsToken, "<="],
  [SyntaxKind.GreaterThanToken, ">"], [SyntaxKind.GreaterThanEqualsToken, ">="],
  [SyntaxKind.EqualsEqualsEqualsToken, "==="], [SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [SyntaxKind.EqualsEqualsToken, "=="], [SyntaxKind.ExclamationEqualsToken, "!="],
  [SyntaxKind.AmpersandAmpersandToken, "&&"], [SyntaxKind.BarBarToken, "||"],
  [SyntaxKind.QuestionQuestionToken, "??"],
] as const);

const UNARY_OPERATORS: ReadonlyMap<SyntaxKind, UnaryOperator> = new Map([
  [SyntaxKind.ExclamationToken, "!"], [SyntaxKind.MinusToken, "-"], [SyntaxKind.PlusToken, "+"],
] as const);

export function buildModuleIR(analysis: SourceAnalysis, options: TransformOptions): TransformResult {
  const diagnostics: CompilerDiagnostic[] = [];
  const sourceFile = analysis.sourceFile;
  const span = (node: Node): SourceSpan => spanOf(node, sourceFile, analysis.fileName);
  const manifest = options.manifest;
  const intrinsics = new Set(manifest.intrinsics);

  const locals = new Set<string>();
  for (const c of analysis.components) {
    if (intrinsics.has(c.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Component '${c.name}' conflicts with a runtime intrinsic.`, span(c.declaration)));
    } else if (locals.has(c.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Component '${c.name}' is declared more than once.`, span(c.declaration)));
    }
    locals.add(c.name);
  }
  const imported = new Map<string, string>();
  for (const i of analysis.imports) {
    if (intrinsics.has(i.name) || locals.has(i.name) || imported.has(i.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Imported component '${i.name}' conflicts with another component or a runtime intrinsic.`, span(i.node)));
    } else {
      imported.set(i.name, i.module);
    }
  }

  const components: ComponentIR[] = [];
  for (const c of analysis.components) {
    const lowered = new ComponentLowering(c, sourceFile, analysis.fileName, manifest, locals, imported, diagnostics).lower();
    if (lowered) components.push(lowered);
  }

  checkStaticCycles(components, diagnostics);

  return { module: { kind: "Module", sourceFile: analysis.fileName, components }, diagnostics };
}

const HANDLER_KIND = {
  onUpdate: "OnUpdate",
  onInput: "OnInput",
  onCollisionEnter: "OnCollisionEnter",
} as const;

class ComponentLowering implements LoweringContext {
  readonly componentName: string;
  /** Component scope; function lowering nests scopes beneath it via `scope`. */
  readonly #componentScope = new Scope();
  readonly #stateTypes = new Map<StateId, ValueType>();
  #serial = 0;
  scope: Scope = this.#componentScope;
  readonly #usedNames: Set<string>;
  readonly #component: ComponentAnalysis;
  readonly #sourceFile: SourceFile;
  readonly #fileName: string;
  readonly #manifest: RuntimeManifest;
  readonly #intrinsics: ReadonlySet<string>;
  readonly #locals: ReadonlySet<string>;
  readonly #imported: ReadonlyMap<string, string>;
  readonly #hostIntrinsic: string;
  readonly #diagnostics: CompilerDiagnostic[];
  #errorCount = 0;

  constructor(
    component: ComponentAnalysis,
    sourceFile: SourceFile,
    fileName: string,
    manifest: RuntimeManifest,
    locals: ReadonlySet<string>,
    imported: ReadonlyMap<string, string>,
    diagnostics: CompilerDiagnostic[],
  ) {
    this.#component = component;
    this.componentName = component.name;
    this.#sourceFile = sourceFile;
    this.#fileName = fileName;
    this.#manifest = manifest;
    this.#intrinsics = new Set(manifest.intrinsics);
    this.#imported = imported;
    this.#usedNames = new Set(manifest.reservedMembers);
    this.#locals = locals;
    this.#hostIntrinsic = manifest.hostIntrinsic;
    this.#diagnostics = diagnostics;
  }

  lower(): ComponentIR | null {
    const name = this.#component.name;
    const { hooks, state } = this.#lowerHooks();
    const root = this.#lowerRoot(this.#component.jsx);
    if (!root || this.#errorCount > 0) return null;
    return { kind: "Component", name, span: this.#span(this.#component.declaration), hooks, state, root };
  }

  #lowerHooks(): { hooks: HookIR[]; state: StateIR[] } {
    const hooks: HookIR[] = [];
    const state: StateIR[] = [];
    for (const hook of this.#component.hooks) {
      switch (hook.kind) {
        case "onUpdate":
        case "onInput":
        case "onCollisionEnter": {
          const kind = HANDLER_KIND[hook.kind];
          const signature = HANDLER_SIGNATURES[kind];
          const handler = lowerFunction(this, hook.handler, {
            paramTypes: signature.params.map((p) => p.type),
            returns: "void",
            what: `${signature.method} handler`,
          });
          if (handler) hooks.push({ kind, handler, span: this.#span(hook.statement) });
          break;
        }
        case "useState": {
          if (!this.#claimName(hook.valueName, hook.declaration)) continue;
          if (hook.setterName !== null && !this.#claimName(hook.setterName, hook.declaration)) continue;
          const id = stateId(this.#component.name, hook.valueName);
          if (!hook.initializer) {
            this.#error(DiagnosticCode.InvalidUseState, "useState requires an initial value.", hook.call);
            continue;
          }
          // Initial values are evaluated before any state exists: lower with the scope as it is so far,
          // then reject any state reads.
          const initialValue = this.#lowerExpression(hook.initializer);
          if (!initialValue) continue;
          if (collectDependencies(initialValue).length > 0) {
            this.#error(DiagnosticCode.NonConstantInitialState, "useState initial value must not read other state.", hook.initializer);
            continue;
          }
          const type = this.#stateType(hook.typeArgument, initialValue, hook.call);
          if (!type) continue;
          state.push({ kind: "State", id, name: hook.valueName, type, initialValue });
          this.#stateTypes.set(id, type);
          hooks.push({ kind: "UseState", state: id, setterName: hook.setterName, span: this.#span(hook.declaration) });
          this.#componentScope.declare(hook.valueName, { kind: "state", id });
          if (hook.setterName !== null) this.#componentScope.declare(hook.setterName, { kind: "setter", state: id, name: hook.setterName });
          break;
        }
      }
    }
    return { hooks, state };
  }

  #stateType(typeArgument: Node | null, initial: ExprIR, at: Node): ValueType | null {
    if (typeArgument) {
      switch (typeArgument.kind) {
        case SyntaxKind.NumberKeyword: return "number";
        case SyntaxKind.StringKeyword: return "string";
        case SyntaxKind.BooleanKeyword: return "boolean";
        default:
          this.#error(DiagnosticCode.UnsupportedStateType, "useState type argument must be number, string or boolean.", typeArgument);
          return null;
      }
    }
    const inferred = inferLiteralType(initial);
    if (!inferred) {
      this.#error(DiagnosticCode.UnsupportedStateType, "Cannot infer state type; use a number/string/boolean literal or `useState<T>(...)`.", at);
    }
    return inferred;
  }

  #lowerRoot(jsx: JsxRoot): HostElementIR | null {
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag) || tag.text !== this.#hostIntrinsic) {
      this.#error(DiagnosticCode.RootMustBeEntity, `The root element of component '${this.#component.name}' must be <${this.#hostIntrinsic}>.`, tag);
      return null;
    }
    const props = this.#lowerProps(opening.attributes);
    const children = isJsxElement(jsx) ? this.#lowerChildren(jsx.children, []) : [];
    return {
      kind: "HostElement",
      component: { kind: "Intrinsic", name: tag.text },
      props,
      children,
      span: this.#span(jsx),
    };
  }

  #lowerElement(jsx: JsxRoot, path: readonly number[]): ElementIR | null {
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag)) {
      this.#error(DiagnosticCode.UnsupportedSyntax, "Only simple identifier tag names are supported.", tag);
      return null;
    }
    let component: ComponentRef;
    if (this.#intrinsics.has(tag.text)) component = { kind: "Intrinsic", name: tag.text };
    else if (this.#locals.has(tag.text)) component = { kind: "Local", name: tag.text };
    else if (this.#imported.has(tag.text)) component = { kind: "Imported", name: tag.text, module: this.#imported.get(tag.text)! };
    else {
      this.#error(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>. Declare it in this file, import it from a .tsx file, or use a runtime intrinsic.`, tag);
      return null;
    }

    const props = this.#lowerProps(opening.attributes);
    const children = isJsxElement(jsx) ? this.#lowerChildren(jsx.children, path) : [];
    if (component.kind !== "Intrinsic") {
      if (props.length > 0) {
        this.#error(DiagnosticCode.LocalComponentProps, `Passing props to component <${tag.text}> is not supported yet.`, opening.attributes);
      }
      if (children.length > 0) {
        this.#error(DiagnosticCode.LocalComponentProps, `Passing children to component <${tag.text}> is not supported yet.`, jsx);
      }
    }

    return {
      kind: "Element",
      id: elementId(this.#component.name, path),
      fieldName: this.#allocateFieldName(tag.text),
      component,
      props,
      children,
      span: this.#span(jsx),
    };
  }

  #lowerProps(attributes: JsxAttributes): PropIR[] {
    const props: PropIR[] = [];
    const seen = new Set<string>();
    for (const attribute of attributes.properties) {
      if (!isJsxAttribute(attribute) || !isIdentifier(attribute.name)) {
        this.#error(DiagnosticCode.UnsupportedAttribute, "Only plain `name={value}` attributes are supported.", attribute);
        continue;
      }
      const name = attribute.name.text;
      if (seen.has(name)) {
        this.#error(DiagnosticCode.UnsupportedAttribute, `Duplicate attribute '${name}'.`, attribute);
        continue;
      }
      seen.add(name);
      const init = attribute.initializer;
      let value: ExprIR | null;
      if (!init) value = { kind: "BooleanLiteral", value: true };
      else if (isStringLiteral(init)) value = { kind: "StringLiteral", value: init.text };
      else if (isJsxExpression(init) && init.expression && !init.dotDotDotToken) value = this.#lowerExpression(init.expression);
      else {
        this.#error(DiagnosticCode.UnsupportedAttribute, `Unsupported value for attribute '${name}'.`, init);
        continue;
      }
      if (!value) continue;
      const dependencies = collectDependencies(value);
      props.push(dependencies.length > 0 ? { kind: "DynamicProp", name, value, dependencies } : { kind: "StaticProp", name, value });
    }
    return props;
  }

  #lowerChildren(children: readonly JsxChild[], parentPath: readonly number[]): ChildIR[] {
    const out: ChildIR[] = [];
    let index = 0;
    for (const child of children) {
      if (isJsxText(child)) {
        if (!child.containsOnlyTriviaWhiteSpaces) {
          this.#error(DiagnosticCode.UnsupportedJsxChild, "Text children are not supported.", child);
        }
        continue;
      }
      if (isJsxExpression(child) && !child.expression) continue; // `{/* comment */}`
      const path = [...parentPath, index++];

      if (isJsxElement(child) || isJsxSelfClosingElement(child)) {
        const element = this.#lowerElement(child, path);
        if (element) out.push({ kind: "StaticChild", element });
        continue;
      }
      if (isJsxExpression(child) && child.expression) {
        const expression = unwrapParens(child.expression);
        if (isBinaryExpression(expression) && expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
          const right = unwrapParens(expression.right);
          if (isJsxElement(right) || isJsxSelfClosingElement(right)) {
            const condition = this.#lowerExpression(expression.left);
            const element = this.#lowerElement(right, path);
            if (condition && element) {
              out.push({ kind: "ConditionalChild", condition, dependencies: collectDependencies(condition), element });
            }
            continue;
          }
        }
        this.#error(DiagnosticCode.UnsupportedJsxChild, "Expression children must have the form `{condition && <Element />}`.", child);
        continue;
      }
      this.#error(DiagnosticCode.UnsupportedJsxChild, `Unsupported JSX child (${SyntaxKind[child.kind]}).`, child);
    }
    return out;
  }

  #lowerExpression(node: Expression): ExprIR | null {
    if (isParenthesizedExpression(node)) return this.#lowerExpression(node.expression);
    if (isNumericLiteral(node)) return { kind: "NumberLiteral", value: Number(node.text) };
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return { kind: "StringLiteral", value: node.text };
    switch (node.kind) {
      case SyntaxKind.TrueKeyword: return { kind: "BooleanLiteral", value: true };
      case SyntaxKind.FalseKeyword: return { kind: "BooleanLiteral", value: false };
      case SyntaxKind.NullKeyword: return { kind: "NullLiteral" };
    }
    if (isIdentifier(node)) {
      const binding = this.scope.get(node.text);
      if (!binding) {
        this.#error(DiagnosticCode.UnknownIdentifier, `'${node.text}' is not a state value of this component.`, node);
        return null;
      }
      if (binding.kind === "setter") {
        this.#error(DiagnosticCode.UnsupportedExpression, `State setter '${node.text}' cannot be used in an expression yet.`, node);
        return null;
      }
      switch (binding.kind) {
        case "local": return { kind: "LocalRead", local: binding.id, name: binding.name };
        case "param": return { kind: "ParamRead", param: binding.id, name: binding.name };
        case "state": return { kind: "StateRead", state: binding.id };
        default: return assertNever(binding, "binding");
      }
    }
    if (isPrefixUnaryExpression(node)) {
      const operator = UNARY_OPERATORS.get(node.operator);
      if (!operator) {
        this.#error(DiagnosticCode.UnsupportedExpression, `Unsupported unary operator.`, node);
        return null;
      }
      const operand = this.#lowerExpression(node.operand);
      return operand && { kind: "Unary", operator, operand };
    }
    if (isBinaryExpression(node)) {
      const operator = BINARY_OPERATORS.get(node.operatorToken.kind);
      if (!operator) {
        this.#error(DiagnosticCode.UnsupportedExpression, `Unsupported binary operator '${node.operatorToken.getText(this.#sourceFile)}'.`, node);
        return null;
      }
      const left = this.#lowerExpression(node.left);
      const right = this.#lowerExpression(node.right);
      return left && right && { kind: "Binary", operator, left, right };
    }
    if (isConditionalExpression(node)) {
      const test = this.#lowerExpression(node.condition);
      const whenTrue = this.#lowerExpression(node.whenTrue);
      const whenFalse = this.#lowerExpression(node.whenFalse);
      return test && whenTrue && whenFalse && { kind: "Conditional", test, whenTrue, whenFalse };
    }
    if (isTemplateExpression(node)) {
      const quasis = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      const expressions: ExprIR[] = [];
      for (const span of node.templateSpans) {
        const e = this.#lowerExpression(span.expression);
        if (!e) return null;
        expressions.push(e);
      }
      return { kind: "TemplateLiteral", quasis, expressions };
    }
    if (isPropertyAccessExpression(node)) return this.#lowerPropertyRead(node);
    if (isCallExpression(node)) return this.#lowerCall(node);
    this.#error(DiagnosticCode.UnsupportedExpression, `Unsupported expression (${SyntaxKind[node.kind]}).`, node);
    return null;
  }

  /** `param.name`, where `param` is a handler parameter of a runtime handle type. */
  #lowerPropertyRead(node: PropertyAccessExpression): ExprIR | null {
    const receiver = this.#lowerHandle(node.expression);
    if (!receiver) return null;
    const name = node.name.text;
    if (!this.#manifest.handleTypes[receiver.type]!.properties.includes(name)) {
      this.#error(DiagnosticCode.UnsupportedExpression, `'${receiver.type}' has no readable property '${name}'.`, node.name);
      return null;
    }
    return { kind: "PropertyRead", object: receiver.read, name };
  }

  /** `Math.max(...)`, `clamp(...)`, or `param.method(...)` on a runtime handle parameter. */
  #lowerCall(node: CallExpression): ExprIR | null {
    const callee = node.expression;
    let result: { callee: CalleeIR; expected: number; label: string } | null = null;
    if (isPropertyAccessExpression(callee) && isIdentifier(callee.expression) && callee.expression.text === "Math" && !this.scope.has("Math")) {
      const name = `Math.${callee.name.text}`;
      const expected = MATH_FUNCTIONS[name];
      if (expected !== undefined) result = { callee: { kind: "Function", name }, expected, label: name };
    } else if (isIdentifier(callee) && this.#manifest.functions[callee.text] !== undefined && !this.scope.has(callee.text)) {
      result = { callee: { kind: "Function", name: callee.text }, expected: this.#manifest.functions[callee.text]!, label: callee.text };
    } else if (isPropertyAccessExpression(callee)) {
      const receiver = this.#lowerHandle(callee.expression);
      if (!receiver) return null;
      const expected = this.#manifest.handleTypes[receiver.type]!.methods[callee.name.text];
      if (expected === undefined) {
        this.#error(DiagnosticCode.UnsupportedExpression, `'${receiver.type}' has no callable method '${callee.name.text}'.`, callee.name);
        return null;
      }
      result = { callee: { kind: "Method", receiver: receiver.read, name: callee.name.text }, expected, label: callee.name.text };
    }
    if (!result) {
      this.#error(DiagnosticCode.UnsupportedExpression, "Only allowlisted calls are supported: Math.abs/floor/ceil/round/sign/sqrt/sin/cos/min/max, runtime functions from the manifest, and methods of handler parameters.", node);
      return null;
    }
    const count = node.arguments.length;
    if (result.expected === -1 ? count < 1 : count !== result.expected) {
      this.#error(DiagnosticCode.UnsupportedExpression, `${result.label} expects ${result.expected === -1 ? "at least one" : result.expected} argument(s).`, node);
      return null;
    }
    const args: ExprIR[] = [];
    for (const argument of node.arguments) {
      const lowered = this.#lowerExpression(argument);
      if (!lowered) return null;
      args.push(lowered);
    }
    return { kind: "Call", callee: result.callee, args };
  }

  /** Resolves an expression that must be a handler parameter of a named runtime type. */
  #lowerHandle(node: Expression): { type: string; read: ParamReadIR } | null {
    const target = unwrapParens(node);
    const binding = isIdentifier(target) ? this.scope.get(target.text) : undefined;
    if (binding?.kind !== "param" || binding.type.kind !== "Named") {
      this.#error(DiagnosticCode.UnsupportedExpression, "Members can only be accessed on handler parameters of a runtime type (e.g. `input`).", node);
      return null;
    }
    return { type: binding.type.name, read: { kind: "ParamRead", param: binding.id, name: binding.name } };
  }

  #claimName(name: string, at: Node): boolean {
    if (this.#usedNames.has(name)) {
      this.#error(DiagnosticCode.InvalidUseState, `'${name}' is already declared or is reserved by the runtime.`, at);
      return false;
    }
    this.#usedNames.add(name);
    return true;
  }

  #allocateFieldName(tag: string): string {
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    let candidate = base;
    for (let n = 2; this.#usedNames.has(candidate); n++) candidate = `${base}${n}`;
    this.#usedNames.add(candidate);
    return candidate;
  }

  // -- LoweringContext --------------------------------------------------------

  lowerExpression(node: Expression): ExprIR | null {
    return this.#lowerExpression(node);
  }

  stateType(state: StateId): ValueType {
    const type = this.#stateTypes.get(state);
    if (!type) throw new Error(`Unknown state ${state}`);
    return type;
  }

  isCallableName(name: string): boolean {
    return name === "Math" || this.#manifest.functions[name] !== undefined;
  }

  nextSerial(): number {
    return ++this.#serial;
  }

  error(code: CompilerDiagnostic["code"], message: string, node: Node): void {
    this.#error(code, message, node);
  }

  #span(node: Node): SourceSpan {
    return spanOf(node, this.#sourceFile, this.#fileName);
  }

  #error(code: CompilerDiagnostic["code"], message: string, node: Node): void {
    this.#errorCount++;
    this.#diagnostics.push(error(code, message, this.#span(node)));
  }
}

function inferLiteralType(expr: ExprIR): ValueType | null {
  switch (expr.kind) {
    case "NumberLiteral": return "number";
    case "StringLiteral": return "string";
    case "BooleanLiteral": return "boolean";
    case "Unary":
      if (expr.operator === "!") return "boolean";
      return inferLiteralType(expr.operand) === "number" ? "number" : null;
    default: return null;
  }
}

/** A component that statically contains itself (directly or indirectly) would construct forever. */
function checkStaticCycles(components: readonly ComponentIR[], diagnostics: CompilerDiagnostic[]): void {
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
  const reported = new Set<string>();
  for (const c of components) {
    const stack: string[] = [];
    const dfs = (name: string): boolean => {
      if (stack.includes(name)) return name === c.name;
      stack.push(name);
      const found = (edges.get(name) ?? []).some(dfs);
      stack.pop();
      return found;
    };
    if (!reported.has(c.name) && (edges.get(c.name) ?? []).some(dfs)) {
      reported.add(c.name);
      diagnostics.push(error(DiagnosticCode.ComponentCycle, `Component '${c.name}' statically contains itself.`, c.span));
    }
  }
}
