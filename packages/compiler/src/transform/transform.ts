import { SyntaxKind, type CallExpression, type Expression, type JsxAttribute, type PropertyAccessExpression, type JsxAttributes, type JsxChild, type Node, type SourceFile } from "typescript/ast";
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
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isArrowFunction,
  isFunctionTypeNode,
  isParenthesizedTypeNode,
  isArrayTypeNode,
  isUnionTypeNode,
  isLiteralTypeNode,
  isTypeLiteralNode,
  isInterfaceDeclaration,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isStringLiteral,
  isNoSubstitutionTemplateLiteral,
} from "typescript/ast/is";
import { AUTHORING_HOOKS, unwrapParens, type TypeDeclarationAnalysis, type ComponentAnalysis, type JsxRoot, type SourceAnalysis, type UseRefCallAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import {
  assertNever,
  collectDependencies,
  stateReads,
  elementId,
  refId,
  stateId,
  TRANSFORM_FIELDS,
  type AssignTargetIR,
  type RefId,
  type RefIR,
  type TransformField,
  type TransformPropIR,
  type PropDeclIR,
  type PropTypeIR,
  type CallbackPropIR,
  type TypeDeclarationIR,
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

  // Names imported from the authoring module must be ones the compiler understands.
  const authored = new Set([...manifest.intrinsics, ...AUTHORING_HOOKS, ...Object.keys(manifest.functions)]);
  for (const i of analysis.authoringImports) {
    if (!authored.has(i.name)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownImport,
          `'${i.name}' is not exported by "${manifest.authoringModule}". It exports: ${[...authored].sort().join(", ")}.`,
          span(i.node),
        ),
      );
    }
  }

  // Hooks, built-in elements and runtime functions must be imported, as in React. Each missing name is reported once per file.
  const authoring: AuthoringImports = { names: new Set(analysis.authoringImports.map((i) => i.name)), reported: new Set() };

  const typeDecls = new Map(analysis.typeDeclarations.map((t) => [t.name, t] as const));
  const typeDeclarations: TypeDeclarationIR[] = analysis.typeDeclarations.map((t) => ({ kind: "TypeDeclaration", name: t.name, text: t.text }));

  const components: ComponentIR[] = [];
  for (const c of analysis.components) {
    const lowered = new ComponentLowering(c, sourceFile, analysis.fileName, manifest, locals, imported, authoring, typeDecls, diagnostics).lower();
    if (lowered) components.push(lowered);
  }

  checkStaticCycles(components, diagnostics);

  return { module: { kind: "Module", sourceFile: analysis.fileName, typeDeclarations, components }, diagnostics };
}

const HANDLER_KIND = {
  useUpdate: "OnUpdate",
  useInput: "OnInput",
  onCollisionEnter: "OnCollisionEnter",
} as const;

/** Names imported from the authoring module, shared by every component of a file. */
interface AuthoringImports {
  readonly names: ReadonlySet<string>;
  /** Names already reported as missing, so each is reported once. */
  readonly reported: Set<string>;
}

/** Names a component cannot declare as props: the framework reads them off the element. */
const RESERVED_PROP_NAMES: ReadonlySet<string> = new Set(["key", "ref", "transform", "children"]);

function unwrapTypeParens(node: Node): Node {
  let current = node;
  while (isParenthesizedTypeNode(current)) current = current.type;
  return current;
}

/** The value of a string or number literal type (`"fast"`, `3`), else null. */
function literalValue(node: Node): string | number | null {
  if (!isLiteralTypeNode(node)) return null;
  if (isStringLiteral(node.literal)) return node.literal.text;
  if (isNumericLiteral(node.literal)) return Number(node.literal.text);
  return null;
}

/** Attributes the compiler handles itself; they never become props. */
const SPECIAL_ATTRIBUTES: ReadonlySet<string> = new Set(["transform"]);

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
  readonly #authoring: AuthoringImports;
  readonly #typeDecls: ReadonlyMap<string, TypeDeclarationAnalysis>;
  #propDecls: readonly PropDeclIR[] = [];
  /** True while lowering the value of `onX={onX}`, where a callback prop may be forwarded whole. */
  #allowCallbackRead = false;
  readonly #diagnostics: CompilerDiagnostic[];
  #errorCount = 0;
  /** Greater than zero while lowering a handler body: the only place `ref.current` is allowed. */
  #functionDepth = 0;
  readonly #refs: RefIR[] = [];

  constructor(
    component: ComponentAnalysis,
    sourceFile: SourceFile,
    fileName: string,
    manifest: RuntimeManifest,
    locals: ReadonlySet<string>,
    imported: ReadonlyMap<string, string>,
    authoring: AuthoringImports,
    typeDecls: ReadonlyMap<string, TypeDeclarationAnalysis>,
    diagnostics: CompilerDiagnostic[],
  ) {
    this.#typeDecls = typeDecls;
    this.#authoring = authoring;
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
    const props = this.#lowerPropDecls();
    this.#propDecls = props;
    const { hooks, state } = this.#lowerHooks();
    const root = this.#lowerRoot(this.#component.jsx);
    if (!root || this.#errorCount > 0) return null;
    return {
      kind: "Component",
      name,
      span: this.#span(this.#component.declaration),
      hooks,
      state,
      refs: this.#refs,
      props,
      propsType: this.#component.props?.typeName ?? null,
      root,
    };
  }

  /**
   * Resolve the props parameter against the props type declared in this file,
   * declare each destructured prop in scope, and describe every member of the
   * type (destructured or not) for the prefab registry.
   */
  #lowerPropDecls(): PropDeclIR[] {
    const analysis = this.#component.props;
    if (!analysis) return [];
    const code = DiagnosticCode.InvalidProps;
    const decl = this.#typeDecls.get(analysis.typeName);
    if (!decl) {
      this.#error(code, `Props type '${analysis.typeName}' is not declared in this file (declare an \`interface ${analysis.typeName} { … }\`).`, analysis.typeNode);
      return [];
    }
    const members = this.#propMembers(decl);
    if (!members) return [];

    const bindings = new Map(analysis.bindings.map((b) => [b.name, b] as const));
    for (const binding of analysis.bindings) {
      if (!members.has(binding.name)) {
        this.#error(code, `'${binding.name}' is not a prop of ${analysis.typeName}.`, binding.node);
      }
    }

    const out: PropDeclIR[] = [];
    for (const [name, member] of members) {
      if (RESERVED_PROP_NAMES.has(name)) {
        this.#error(code, `'${name}' is reserved by the framework and cannot be a prop name.`, member.node);
        continue;
      }
      const binding = bindings.get(name);
      let defaultValue: ExprIR | null = null;
      if (binding?.defaultValue) {
        if (member.role === "callback") {
          this.#error(code, `Callback prop '${name}' cannot have a default value; call it with \`${name}?.()\` instead.`, binding.node);
        } else {
          defaultValue = this.#lowerExpression(binding.defaultValue);
          if (defaultValue && collectDependencies(defaultValue).length > 0) {
            this.#error(code, `The default for '${name}' must be a constant: it cannot read state or other props.`, binding.defaultValue);
            defaultValue = null;
          }
        }
      }
      out.push({ kind: "PropDecl", name, optional: member.optional || binding?.defaultValue != null, defaultValue, role: member.role, type: member.type });
      if (binding) {
        if (this.#componentScope.hasOwn(name)) {
          this.#error(code, `'${name}' is already declared in this component.`, binding.node);
        } else {
          this.#componentScope.declare(name, { kind: "prop", name, role: member.role });
        }
      }
    }
    return out;
  }

  /** The members of a props type: an `interface` or a `type` alias of an object type, with plain named members. */
  #propMembers(decl: TypeDeclarationAnalysis): Map<string, { optional: boolean; role: "value" | "callback"; type: PropTypeIR; node: Node }> | null {
    const code = DiagnosticCode.InvalidProps;
    const node = decl.node;
    let elements: readonly Node[];
    if (isInterfaceDeclaration(node)) {
      if (node.heritageClauses && node.heritageClauses.length > 0) {
        this.#error(code, `Props type '${decl.name}' cannot extend another type: list the props in one interface.`, node);
        return null;
      }
      elements = node.members;
    } else if (isTypeLiteralNode(node.type)) {
      elements = node.type.members;
    } else {
      this.#error(code, `Props type '${decl.name}' must be an object type: \`type ${decl.name} = { … }\`.`, node);
      return null;
    }
    const out = new Map<string, { optional: boolean; role: "value" | "callback"; type: PropTypeIR; node: Node }>();
    for (const element of elements) {
      const member = element as unknown as { kind: SyntaxKind; name?: Node; type?: Node; postfixToken?: Node };
      const isProperty = member.kind === SyntaxKind.PropertySignature;
      const isMethod = member.kind === SyntaxKind.MethodSignature;
      if ((!isProperty && !isMethod) || !member.name || !isIdentifier(member.name)) {
        this.#error(code, `Props type '${decl.name}': members must be plain \`name: type\` or \`name(): void\`.`, element);
        continue;
      }
      const optional = member.postfixToken?.kind === SyntaxKind.QuestionToken;
      const typeNode = member.type ? unwrapTypeParens(member.type) : null;
      const role = isMethod || (typeNode !== null && isFunctionTypeNode(typeNode)) ? "callback" : "value";
      const type: PropTypeIR = role === "callback" ? { kind: "Function" } : this.#propType(typeNode);
      out.set(member.name.text, { optional, role, type, node: element });
    }
    return out;
  }

  /** A prop type as the compiler understands it; anything else is carried as source text. */
  #propType(node: Node | null): PropTypeIR {
    if (node === null) return { kind: "SourceText", text: "unknown" };
    const t = unwrapTypeParens(node);
    switch (t.kind) {
      case SyntaxKind.NumberKeyword: return { kind: "Primitive", name: "number" };
      case SyntaxKind.StringKeyword: return { kind: "Primitive", name: "string" };
      case SyntaxKind.BooleanKeyword: return { kind: "Primitive", name: "boolean" };
    }
    if (isArrayTypeNode(t)) {
      const element = this.#propType(t.elementType);
      return element.kind === "SourceText" ? { kind: "SourceText", text: t.getText(this.#sourceFile) } : { kind: "Array", element };
    }
    const literals = isUnionTypeNode(t) ? t.types.map((u) => literalValue(u)) : [literalValue(t)];
    if (literals.every((v) => v !== null)) return { kind: "Literals", values: literals as (string | number)[] };
    return { kind: "SourceText", text: t.getText(this.#sourceFile) };
  }

  /**
   * `onDefeated={() => setScore(…)}`, passed to a child component. The
   * handler runs like any other (state through `this`, refs allowed), but its
   * parameters are not annotated: the child's props type provides them.
   */
  #lowerCallback(name: string, fn: Node & { kind: SyntaxKind.ArrowFunction }): CallbackPropIR | null {
    this.#functionDepth++;
    const handler = lowerFunction(this, fn as unknown as Parameters<typeof lowerFunction>[1], {
      paramTypes: "contextual",
      returns: "void",
      what: `${name} callback`,
    });
    this.#functionDepth--;
    return handler && { kind: "CallbackProp", name, handler };
  }

  #lowerHooks(): { hooks: HookIR[]; state: StateIR[] } {
    const hooks: HookIR[] = [];
    const state: StateIR[] = [];
    for (const hook of this.#component.hooks) {
      if (hook.kind !== "const") this.#requireImport(hook.kind, hook.call);
      switch (hook.kind) {
        case "useUpdate":
        case "useInput":
        case "onCollisionEnter": {
          const kind = HANDLER_KIND[hook.kind];
          const signature = HANDLER_SIGNATURES[kind];
          this.#functionDepth++;
          const handler = lowerFunction(this, hook.handler, {
            paramTypes: signature.params.map((p) => p.type),
            returns: "void",
            what: `${hook.kind} handler`,
          });
          this.#functionDepth--;
          if (handler) hooks.push({ kind, handler, span: this.#span(hook.statement) });
          break;
        }
        case "useRef":
          this.#lowerUseRef(hook);
          break;
        case "const": {
          // Lowered now, against what is declared above it (state, refs, earlier consts), outside any handler.
          const value = this.#lowerExpression(hook.initializer);
          if (!value) break;
          if (this.#componentScope.hasOwn(hook.name) || this.isCallableName(hook.name)) {
            this.#error(DiagnosticCode.InvalidComponentBody, `'${hook.name}' is already declared in this component (or reserved).`, hook.declaration.name);
            break;
          }
          this.#componentScope.declare(hook.name, { kind: "derived", name: hook.name, value });
          break;
        }
        case "useState": {
          const taken = [hook.valueName, hook.setterName].find((n) => n !== null && this.#componentScope.hasOwn(n));
          if (taken) {
            this.#error(DiagnosticCode.InvalidUseState, `'${taken}' is already declared in this component.`, hook.declaration);
            continue;
          }
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
          if (stateReads(initialValue).length > 0) {
            this.#error(DiagnosticCode.NonConstantInitialState, "useState initial value must not read other state (it may read props).", hook.initializer);
            continue;
          }
          const type = this.#valueType(hook.typeArgument, initialValue, hook.call, "useState", DiagnosticCode.UnsupportedStateType);
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

  /**
   * `const cooldown = useRef(0)` / `useRef<number>(0)`: a value that persists
   * but never renders. The initial value is evaluated once and must not read state.
   */
  #lowerUseRef(hook: UseRefCallAnalysis): void {
    const code = DiagnosticCode.InvalidUseRef;
    if (hook.arguments.length !== 1) {
      this.#error(code, "useRef takes one initial value: `const timer = useRef(0)`. Refs hold values; they do not point at elements.", hook.call);
      return;
    }
    if (!this.#checkHandleName(hook.name, code, hook.declaration.name)) return;
    const initialValue = this.#lowerExpression(hook.arguments[0]!);
    if (!initialValue) return;
    if (stateReads(initialValue).length > 0) {
      this.#error(code, "useRef's initial value must not read state; it is evaluated once (it may read props).", hook.arguments[0]!);
      return;
    }
    const type = this.#valueType(hook.typeArgument, initialValue, hook.call, "useRef", code);
    if (!type || !this.#claimName(hook.name, hook.declaration, code)) return;
    const id = refId(this.#component.name, hook.name);
    this.#refs.push({ kind: "Ref", id, name: hook.name, type, initialValue, span: this.#span(hook.declaration) });
    this.#componentScope.declare(hook.name, { kind: "ref", id, name: hook.name });
  }

  /** A `useRef` binding must not collide with state, setters or the reserved call names. */
  #checkHandleName(name: string, code: typeof DiagnosticCode.InvalidUseRef, at: Node): boolean {
    if (this.#componentScope.has(name) || this.isCallableName(name)) {
      this.#error(code, `'${name}' is already declared in this component (or reserved).`, at);
      return false;
    }
    return true;
  }

  /** The type of a `useState` / `useRef` value: its type argument, or inferred from a literal initial value. */
  #valueType(typeArgument: Node | null, initial: ExprIR, at: Node, hook: string, code: CompilerDiagnostic["code"]): ValueType | null {
    if (typeArgument) {
      switch (typeArgument.kind) {
        case SyntaxKind.NumberKeyword: return "number";
        case SyntaxKind.StringKeyword: return "string";
        case SyntaxKind.BooleanKeyword: return "boolean";
        default:
          this.#error(code, `${hook} type argument must be number, string or boolean.`, typeArgument);
          return null;
      }
    }
    const inferred = inferLiteralType(initial) ?? this.#inferFromProp(initial);
    if (!inferred) {
      this.#error(code, `Cannot infer the type; use a number/string/boolean literal, a prop, or \`${hook}<T>(...)\`.`, at);
    }
    return inferred;
  }

  /** `useState(start)`: the type of a primitive prop, from its declaration in the props type. */
  #inferFromProp(expr: ExprIR): ValueType | null {
    if (expr.kind !== "PropRead") return null;
    const decl = this.#propDecls.find((p) => p.name === expr.name);
    return decl?.role === "value" && decl.type.kind === "Primitive" ? decl.type.name : null;
  }

  #lowerRoot(jsx: JsxRoot): HostElementIR | null {
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag) || tag.text !== this.#hostIntrinsic) {
      this.#error(DiagnosticCode.RootMustBeEntity, `The root element of component '${this.#component.name}' must be <${this.#hostIntrinsic}>.`, tag);
      return null;
    }
    this.#requireImport(tag.text, tag);
    const props = this.#lowerProps(opening.attributes);
    const transform = this.#lowerTransform(opening.attributes, tag.text, false);
    const children = isJsxElement(jsx) ? this.#lowerChildren(jsx.children, []) : [];
    return {
      kind: "HostElement",
      component: { kind: "Intrinsic", name: tag.text },
      props,
      transform,
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
    if (this.#intrinsics.has(tag.text)) {
      this.#requireImport(tag.text, tag);
      component = { kind: "Intrinsic", name: tag.text };
    }
    else if (this.#locals.has(tag.text)) component = { kind: "Local", name: tag.text };
    else if (this.#imported.has(tag.text)) component = { kind: "Imported", name: tag.text, module: this.#imported.get(tag.text)! };
    else {
      this.#error(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>. Declare it in this file, import it from a .tsx file, or use a runtime intrinsic.`, tag);
      return null;
    }

    const isComponent = component.kind !== "Intrinsic";
    const props = this.#lowerProps(opening.attributes, isComponent);
    const transform = this.#lowerTransform(opening.attributes, tag.text, isComponent);
    const children = isJsxElement(jsx) ? this.#lowerChildren(jsx.children, path) : [];
    if (isComponent && children.length > 0) {
      this.#error(DiagnosticCode.UnsupportedJsxChild, `Passing children to component <${tag.text}> is not supported yet.`, jsx);
    }

    return {
      kind: "Element",
      id: elementId(this.#component.name, path),
      fieldName: this.#allocateFieldName(tag.text),
      component,
      props,
      transform,
      children,
      span: this.#span(jsx),
    };
  }

  /**
   * `transform={{ x, y: 0, rotation: angle }}`: each field becomes a static or
   * dynamic prop on the element's runtime transform, so moving is `setX(...)`.
   * Every intrinsic the manifest lists in `transformIntrinsics` takes it. On
   * a component element it is placement by the parent: it sets the child's
   * `placement`, which composes under the child's own `transform`.
   */
  #lowerTransform(attributes: JsxAttributes, tag: string, isComponent: boolean): TransformPropIR[] {
    const attribute = findAttribute(attributes, "transform");
    if (!attribute) return [];
    const code = DiagnosticCode.InvalidTransformAttribute;
    if (!isComponent && !this.#manifest.transformIntrinsics.includes(tag)) {
      this.#error(code, `<${tag}> cannot be placed with \`transform\` (it is not in the runtime's transformIntrinsics). Wrap it in an <${this.#hostIntrinsic}> to position it.`, attribute);
      return [];
    }
    const init = attribute.initializer;
    const object = init && isJsxExpression(init) && init.expression && !init.dotDotDotToken ? unwrapParens(init.expression) : null;
    if (!object || !isObjectLiteralExpression(object)) {
      this.#error(code, "`transform` takes an object literal: `transform={{ x, y: 0 }}`.", attribute);
      return [];
    }
    const out: TransformPropIR[] = [];
    for (const property of object.properties) {
      let field: string;
      let valueNode: Expression;
      if (isPropertyAssignment(property) && isIdentifier(property.name)) {
        field = property.name.text;
        valueNode = property.initializer;
      } else if (isShorthandPropertyAssignment(property) && isIdentifier(property.name)) {
        field = property.name.text;
        valueNode = property.name;
      } else {
        this.#error(code, "Transform fields must be written `field: value` or `field` (shorthand); no spreads or computed names.", property);
        continue;
      }
      if (!(TRANSFORM_FIELDS as readonly string[]).includes(field)) {
        this.#error(code, `'${field}' is not a transform field (${TRANSFORM_FIELDS.join(", ")}).`, property);
        continue;
      }
      if (out.some((p) => p.name === field)) {
        this.#error(code, `Duplicate transform field '${field}'.`, property);
        continue;
      }
      const value = this.#lowerExpression(valueNode);
      if (!value) continue;
      const name = field as TransformField;
      const dependencies = collectDependencies(value);
      out.push(dependencies.length > 0 ? { kind: "DynamicProp", name, value, dependencies } : { kind: "StaticProp", name, value });
    }
    return out;
  }

  /**
   * Props of an element. `transform` is lowered separately but still counts
   * for duplicate detection; `ref` is rejected. On a component element
   * (`toComponent`) an arrow function is a callback prop; on an intrinsic it
   * is an error.
   */
  #lowerProps(attributes: JsxAttributes, toComponent = false): PropIR[] {
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
      if (SPECIAL_ATTRIBUTES.has(name)) continue;
      if (name === "key" || name === "children") {
        this.#error(DiagnosticCode.UnsupportedAttribute, name === "key" ? "`key` is for items of a list, which arrives with keyed lists." : "`children` cannot be passed yet.", attribute);
        continue;
      }
      if (name === "ref") {
        this.#error(DiagnosticCode.InvalidUseRef, "Elements cannot be referenced: refs hold values (`const timer = useRef(0)`), and what is on screen is driven by state and props.", attribute);
        continue;
      }
      const init = attribute.initializer;
      let value: ExprIR | null;
      if (!init) value = { kind: "BooleanLiteral", value: true };
      else if (isStringLiteral(init)) value = { kind: "StringLiteral", value: init.text };
      else if (isJsxExpression(init) && init.expression && !init.dotDotDotToken) {
        const expression = unwrapParens(init.expression);
        if (isArrowFunction(expression)) {
          if (!toComponent) {
            this.#error(DiagnosticCode.UnsupportedAttribute, `'${name}' is a function: callbacks can only be passed to components.`, attribute);
            continue;
          }
          const callback = this.#lowerCallback(name, expression);
          if (callback) props.push(callback);
          continue;
        }
        // `onX={onX}` forwards a callback prop whole.
        this.#allowCallbackRead = toComponent && isIdentifier(expression);
        try {
          value = this.#lowerExpression(init.expression);
        } finally {
          this.#allowCallbackRead = false;
        }
      } else {
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
        if (isConditionalExpression(expression)) {
          // `{c ? <A /> : <B />}` (either branch may be `null`): one conditional child per branch, the
          // second on `!c`. Each branch keeps its own identity, so switching recreates, as React does
          // for different element types.
          const branches = [unwrapParens(expression.whenTrue), unwrapParens(expression.whenFalse)];
          const usable = branches.every((b) => isJsxElement(b) || isJsxSelfClosingElement(b) || b.kind === SyntaxKind.NullKeyword);
          if (usable) {
            const condition = this.#lowerExpression(expression.condition);
            if (!condition) continue;
            const conditions: ExprIR[] = [condition, { kind: "Unary", operator: "!", operand: condition }];
            branches.forEach((branch, i) => {
              if (!(isJsxElement(branch) || isJsxSelfClosingElement(branch))) return;
              const element = this.#lowerElement(branch, i === 0 ? path : [...parentPath, index++]);
              const when = conditions[i]!;
              if (element) out.push({ kind: "ConditionalChild", condition: when, dependencies: collectDependencies(when), element });
            });
            continue;
          }
        }
        this.#error(DiagnosticCode.UnsupportedJsxChild, "Expression children must have the form `{condition && <Element />}` or `{condition ? <A /> : <B />}` (a branch may be `null`).", child);
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
        case "prop":
          if (binding.role === "callback" && !this.#allowCallbackRead) {
            this.#error(DiagnosticCode.UnsupportedExpression, `'${node.text}' is a callback prop: call it (\`${node.text}?.()\`) or forward it whole (\`onX={${node.text}}\`).`, node);
            return null;
          }
          return { kind: "PropRead", name: binding.name };
        // Inlined: in JSX it re-evaluates on render (its state reads become the prop's dependencies);
        // in a handler it reads the current state, like recomputing it there.
        case "derived": return binding.value;
        case "ref":
          this.#error(DiagnosticCode.UnsupportedExpression, `'${node.text}' is a ref; read and write \`${node.text}.current\`.`, node);
          return null;
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

  /** `ref.current`, or `param.name` where `param` is a handler parameter of a runtime handle type. */
  #lowerPropertyRead(node: PropertyAccessExpression): ExprIR | null {
    const ref = this.#refAccess(node);
    if (ref === "error") return null;
    if (ref) {
      if (this.#functionDepth === 0) {
        this.#error(
          DiagnosticCode.HandleReadOutsideHandler,
          "`ref.current` can only be read inside handlers: refs never cause a render, so a read here would go stale. Use state for values JSX depends on.",
          node,
        );
        return null;
      }
      return { kind: "RefRead", ref };
    }
    const receiver = this.#lowerHandle(node.expression);
    if (!receiver) return null;
    const name = node.name.text;
    if (!this.#manifest.handleTypes[receiver.type]!.properties.includes(name)) {
      this.#error(DiagnosticCode.UnsupportedExpression, `'${receiver.type}' has no readable property '${name}'.`, node.name);
      return null;
    }
    return { kind: "PropertyRead", object: receiver.read, name };
  }

  /** Resolves `r.current` for a ref `r`. Undefined if `node` is not on a ref (the caller carries on), "error" after reporting. */
  #refAccess(node: PropertyAccessExpression): RefId | "error" | undefined {
    const object = unwrapParens(node.expression);
    const binding = isIdentifier(object) ? this.scope.get(object.text) : undefined;
    if (binding?.kind !== "ref") return undefined;
    if (node.name.text !== "current") {
      this.#error(DiagnosticCode.UnsupportedExpression, `Refs only have \`.current\`, not '${node.name.text}'.`, node.name);
      return "error";
    }
    return binding.id;
  }

  /** `Math.max(...)`, `clamp(...)`, or `param.method(...)` on a runtime handle parameter. */
  #lowerCall(node: CallExpression): ExprIR | null {
    const callee = node.expression;
    // A callback prop: `onDefeated()` or `onDefeated?.()`. Arguments are not counted here; the type-check does that.
    if (isIdentifier(callee)) {
      const binding = this.scope.get(callee.text);
      if (binding?.kind === "prop") {
        if (binding.role !== "callback") {
          this.#error(DiagnosticCode.UnsupportedExpression, `Prop '${callee.text}' is not a function, so it cannot be called.`, callee);
          return null;
        }
        const args: ExprIR[] = [];
        for (const argument of node.arguments) {
          const lowered = this.#lowerExpression(argument);
          if (!lowered) return null;
          args.push(lowered);
        }
        return { kind: "Call", callee: { kind: "Prop", name: binding.name, optional: node.questionDotToken !== undefined }, args };
      }
    }
    let result: { callee: CalleeIR; expected: number; label: string } | null = null;
    if (isPropertyAccessExpression(callee) && isIdentifier(callee.expression) && callee.expression.text === "Math" && !this.scope.has("Math")) {
      const name = `Math.${callee.name.text}`;
      const expected = MATH_FUNCTIONS[name];
      if (expected !== undefined) result = { callee: { kind: "Function", name }, expected, label: name };
    } else if (isIdentifier(callee) && this.#manifest.functions[callee.text] !== undefined && !this.scope.has(callee.text)) {
      this.#requireImport(callee.text, callee);
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

  /** A hook, built-in element or runtime function must be imported from the authoring module before it is used. */
  #requireImport(name: string, at: Node): void {
    if (this.#authoring.names.has(name) || this.#authoring.reported.has(name)) return;
    this.#authoring.reported.add(name);
    this.#error(DiagnosticCode.MissingImport, `'${name}' is not imported: add \`import { ${name} } from "${this.#manifest.authoringModule}"\`.`, at);
  }

  #claimName(name: string, at: Node, code: CompilerDiagnostic["code"] = DiagnosticCode.InvalidUseState): boolean {
    if (this.#usedNames.has(name)) {
      this.#error(code, `'${name}' is already declared or is reserved by the runtime.`, at);
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

  lowerAssignTarget(node: Expression): AssignTargetIR | null {
    const ref = isPropertyAccessExpression(node) ? this.#refAccess(node) : undefined;
    if (ref === "error") return null;
    if (ref) return { kind: "RefCurrent", ref };
    this.#error(
      DiagnosticCode.UnsupportedStatement,
      "Only `ref.current` can be assigned. Use the state setter to change state, including position (`transform={{ x }}`).",
      node,
    );
    return null;
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

function findAttribute(attributes: JsxAttributes, name: string): JsxAttribute | null {
  for (const attribute of attributes.properties) {
    if (isJsxAttribute(attribute) && isIdentifier(attribute.name) && attribute.name.text === name) return attribute;
  }
  return null;
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
