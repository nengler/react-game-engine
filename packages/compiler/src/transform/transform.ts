import { NodeFlags, SyntaxKind, type ArrowFunction, type Expression, type Statement, type JsxAttributes, type JsxChild, type Node, type SourceFile } from "typescript/ast";
import {
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isExpressionStatement,
  isIfStatement,
  isVariableStatement,
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
import { unwrapParens, type ComponentAnalysis, type HandlerCallAnalysis, type JsxRoot, type SourceAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import {
  collectDependencies,
  elementId,
  stateId,
  type BinaryOperator,
  type ChildIR,
  type ComponentIR,
  type ComponentRef,
  type ElementIR,
  type ExprIR,
  type HookIR,
  type HostElementIR,
  type IRModule,
  type PropIR,
  type SourceSpan,
  type StmtIR,
  type StateId,
  type StateIR,
  type UnaryOperator,
  type ValueType,
} from "../ir/types.ts";
import { spanOf } from "../parser/parser.ts";

export interface TransformOptions {
  /** Tag names provided by the runtime package. */
  readonly intrinsics: readonly string[];
  /** The intrinsic every component root must use. */
  readonly hostIntrinsic: string;
}

export interface TransformResult {
  readonly module: IRModule;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/**
 * Members of the runtime base classes (GameObject / Entity) that generated
 * fields and setters must not shadow.
 */
const RESERVED_MEMBERS = new Set([
  "constructor", "parent", "children", "world", "name", "isDirty", "hasPendingStructure",
  "addChild", "removeChild", "queueAddChild", "queueRemoveChild", "commitStructure",
  "markDirty", "runRender", "render", "attachToWorld", "detachFromWorld",
  "onUpdate", "onCollisionEnter", "update", "collide",
]);

type Binding =
  | { readonly kind: "state"; readonly id: StateId }
  | { readonly kind: "setter"; readonly state: StateId; readonly name: string }
  | { readonly kind: "local" };

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
  const intrinsics = new Set(options.intrinsics);

  const locals = new Set<string>();
  for (const c of analysis.components) {
    if (intrinsics.has(c.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Component '${c.name}' conflicts with a runtime intrinsic.`, span(c.declaration)));
    } else if (locals.has(c.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Component '${c.name}' is declared more than once.`, span(c.declaration)));
    }
    locals.add(c.name);
  }

  const components: ComponentIR[] = [];
  for (const c of analysis.components) {
    const lowered = new ComponentLowering(c, sourceFile, analysis.fileName, intrinsics, locals, options.hostIntrinsic, diagnostics).lower();
    if (lowered) components.push(lowered);
  }

  checkStaticCycles(components, diagnostics);

  return { module: { kind: "Module", sourceFile: analysis.fileName, components }, diagnostics };
}

class ComponentLowering {
  readonly #scope = new Map<string, Binding>();
  readonly #usedNames = new Set<string>(RESERVED_MEMBERS);
  readonly #component: ComponentAnalysis;
  readonly #sourceFile: SourceFile;
  readonly #fileName: string;
  readonly #intrinsics: ReadonlySet<string>;
  readonly #locals: ReadonlySet<string>;
  readonly #hostIntrinsic: string;
  readonly #diagnostics: CompilerDiagnostic[];
  #errorCount = 0;

  constructor(
    component: ComponentAnalysis,
    sourceFile: SourceFile,
    fileName: string,
    intrinsics: ReadonlySet<string>,
    locals: ReadonlySet<string>,
    hostIntrinsic: string,
    diagnostics: CompilerDiagnostic[],
  ) {
    this.#component = component;
    this.#sourceFile = sourceFile;
    this.#fileName = fileName;
    this.#intrinsics = intrinsics;
    this.#locals = locals;
    this.#hostIntrinsic = hostIntrinsic;
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
    const seenHandlers = new Set<string>();
    for (const hook of this.#component.hooks) {
      switch (hook.kind) {
        case "onUpdate":
        case "onCollisionEnter": {
          if (seenHandlers.has(hook.kind)) {
            this.#error(DiagnosticCode.DuplicateHandler, `${hook.kind} may be declared only once per component.`, hook.statement);
            continue;
          }
          seenHandlers.add(hook.kind);
          const lowered = this.#lowerHandler(hook);
          if (lowered) hooks.push(lowered);
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
          hooks.push({ kind: "UseState", state: id, setterName: hook.setterName, span: this.#span(hook.declaration) });
          this.#scope.set(hook.valueName, { kind: "state", id });
          if (hook.setterName !== null) this.#scope.set(hook.setterName, { kind: "setter", state: id, name: hook.setterName });
          break;
        }
      }
    }
    return { hooks, state };
  }

  // -- handlers -------------------------------------------------------------

  #lowerHandler(hook: HandlerCallAnalysis): HookIR | null {
    const fn = hook.handler;
    const span = this.#span(hook.statement);
    const params = fn.parameters;
    let deltaParam: string | null = null;
    const bound: string[] = [];
    if (hook.kind === "onCollisionEnter") {
      if (params.length > 0) {
        this.#error(DiagnosticCode.InvalidHandler, "onCollisionEnter handlers take no parameters yet.", params[0]!);
        return null;
      }
    } else if (params.length > 1 || (params[0] && !isIdentifier(params[0].name))) {
      this.#error(DiagnosticCode.InvalidHandler, "onUpdate handlers take at most one plain parameter: the delta time.", params[1] ?? params[0]!);
      return null;
    } else if (params[0]) {
      deltaParam = (params[0].name as { text: string }).text;
      if (!this.#declareLocal(deltaParam, params[0])) return null;
      bound.push(deltaParam);
    }
    const body = this.#lowerHandlerBody(fn);
    for (const name of bound) this.#scope.delete(name);
    if (!body) return null;
    return hook.kind === "onUpdate"
      ? { kind: "OnUpdate", deltaParam, body, span }
      : { kind: "OnCollisionEnter", body, span };
  }

  #lowerHandlerBody(fn: ArrowFunction): StmtIR[] | null {
    if (isBlock(fn.body)) return this.#lowerBlock(fn.body.statements);
    // Expression body: `() => setX(1)` is a single expression statement.
    const stmt = this.#lowerCall(fn.body, fn.body);
    return stmt && [stmt];
  }

  /** Lowers statements in a fresh scope: locals declared inside do not leak out. */
  #lowerBlock(statements: readonly Statement[]): StmtIR[] | null {
    const declared: string[] = [];
    const out: StmtIR[] = [];
    let ok = true;
    for (const statement of statements) {
      const lowered = this.#lowerStatement(statement, declared);
      if (lowered) out.push(lowered);
      else ok = false;
    }
    for (const name of declared) this.#scope.delete(name);
    return ok ? out : null;
  }

  #lowerStatement(statement: Statement, declared: string[]): StmtIR | null {
    if (isExpressionStatement(statement)) return this.#lowerCall(statement.expression, statement);
    if (isIfStatement(statement)) {
      const test = this.#lowerExpression(statement.expression);
      const thenBranch = this.#lowerBranch(statement.thenStatement);
      const elseBranch = statement.elseStatement ? this.#lowerBranch(statement.elseStatement) : [];
      return test && thenBranch && elseBranch && { kind: "If", test, then: thenBranch, else: elseBranch };
    }
    if (isVariableStatement(statement)) {
      const list = statement.declarationList;
      const decl = list.declarations[0]!;
      if ((list.flags & NodeFlags.Const) === 0 || list.declarations.length !== 1 || !isIdentifier(decl.name) || !decl.initializer) {
        this.#error(DiagnosticCode.UnsupportedStatement, "Only `const name = expression;` declarations are supported in handlers.", statement);
        return null;
      }
      const value = this.#lowerExpression(decl.initializer);
      if (!value || !this.#declareLocal(decl.name.text, decl.name)) return null;
      declared.push(decl.name.text);
      return { kind: "LocalDecl", name: decl.name.text, value };
    }
    this.#error(
      DiagnosticCode.UnsupportedStatement,
      "Unsupported statement in handler (supported: setter calls, `if`/`else`, and `const` declarations).",
      statement,
    );
    return null;
  }

  #lowerBranch(statement: Statement): StmtIR[] | null {
    return this.#lowerBlock(isBlock(statement) ? statement.statements : [statement]);
  }

  /** `setX(value)` or `setX(prev => expr)`, where the updater's parameter is a read of that state. */
  #lowerCall(expression: Expression, at: Node): StmtIR | null {
    const call = unwrapParens(expression);
    const callee = isCallExpression(call) && isIdentifier(call.expression) ? this.#scope.get(call.expression.text) : undefined;
    if (!isCallExpression(call) || callee?.kind !== "setter") {
      this.#error(DiagnosticCode.UnsupportedStatement, "Handler statements must call a state setter, e.g. `setHealth(health - 1)`.", at);
      return null;
    }
    if (call.arguments.length !== 1) {
      this.#error(DiagnosticCode.UnsupportedStatement, "State setters take exactly one argument.", call);
      return null;
    }
    const arg = unwrapParens(call.arguments[0]!);
    let value: ExprIR | null;
    if (isArrowFunction(arg)) {
      const param = arg.parameters[0];
      if (arg.parameters.length !== 1 || !param || !isIdentifier(param.name) || isBlock(arg.body)) {
        this.#error(DiagnosticCode.UnsupportedStatement, "Updater functions must look like `prev => expression`.", arg);
        return null;
      }
      const name = param.name.text;
      const shadowed = this.#scope.get(name);
      this.#scope.set(name, { kind: "state", id: callee.state });
      value = this.#lowerExpression(arg.body);
      if (shadowed) this.#scope.set(name, shadowed);
      else this.#scope.delete(name);
    } else {
      value = this.#lowerExpression(arg);
    }
    return value && { kind: "SetState", state: callee.state, setterName: callee.name, value };
  }

  #declareLocal(name: string, at: Node): boolean {
    if (this.#scope.has(name)) {
      this.#error(DiagnosticCode.InvalidHandler, `'${name}' is already declared in this component.`, at);
      return false;
    }
    this.#scope.set(name, { kind: "local" });
    return true;
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
    else {
      this.#error(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>. Declare it in this file or use a runtime intrinsic.`, tag);
      return null;
    }

    const props = this.#lowerProps(opening.attributes);
    const children = isJsxElement(jsx) ? this.#lowerChildren(jsx.children, path) : [];
    if (component.kind === "Local") {
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
      const binding = this.#scope.get(node.text);
      if (!binding) {
        this.#error(DiagnosticCode.UnknownIdentifier, `'${node.text}' is not a state value of this component.`, node);
        return null;
      }
      if (binding.kind === "setter") {
        this.#error(DiagnosticCode.UnsupportedExpression, `State setter '${node.text}' cannot be used in an expression yet.`, node);
        return null;
      }
      if (binding.kind === "local") return { kind: "LocalRead", name: node.text };
      return { kind: "StateRead", state: binding.id };
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
    this.#error(DiagnosticCode.UnsupportedExpression, `Unsupported expression (${SyntaxKind[node.kind]}).`, node);
    return null;
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
