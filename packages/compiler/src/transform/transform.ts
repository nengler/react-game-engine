import { SyntaxKind, type ObjectLiteralExpression, type JsxElement, type JsxSelfClosingElement, type CallExpression, type Expression, type JsxAttribute, type PropertyAccessExpression, type JsxAttributes, type JsxChild, type Node, type SourceFile } from "typescript/ast";
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
  isJsxFragment,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isStringLiteral,
  isNoSubstitutionTemplateLiteral,
  isArrayLiteralExpression,
  isSpreadElement,
  isSpreadAssignment,
  isBlock,
  isReturnStatement,
} from "typescript/ast/is";
import { AUTHORING_HOOKS, AUTHORING_TYPES, unwrapParens, type TypeDeclarationAnalysis, type ComponentAnalysis, type JsxRoot, type SourceAnalysis, type UseRefCallAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, warning, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import {
  assertNever,
  localId,
  ARRAY_METHODS,
  MUTATING_ARRAY_METHODS,
  type ArrayMethodName,
  type ArrayElementIR,
  type ObjectPropertyIR,
  type TypeIR,
  type KeyedListChildIR,
  type ParamIR,
  type ValuePropIR,
  readsParam,
  functionReadsParam,
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
import { checkFreshName, lowerFunction, type LoweringContext } from "./statements.ts";

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
  const imported = new Map<string, { module: string; isDefault: boolean }>();
  for (const i of analysis.imports) {
    if (intrinsics.has(i.name) || locals.has(i.name) || imported.has(i.name)) {
      diagnostics.push(error(DiagnosticCode.DuplicateComponent, `Imported component '${i.name}' conflicts with another component or a runtime intrinsic.`, span(i.node)));
    } else {
      imported.set(i.name, { module: i.module, isDefault: i.isDefault });
    }
  }

  // Names imported from the authoring module must be ones the compiler understands.
  const authored = new Set([...manifest.intrinsics, ...AUTHORING_HOOKS, ...Object.keys(manifest.functions)]);
  const authoredTypes = new Set(AUTHORING_TYPES);
  for (const i of analysis.authoringImports) {
    if (i.isTypeOnly && !authoredTypes.has(i.name)) {
      diagnostics.push(
        error(DiagnosticCode.UnknownImport, `'${i.name}' is not a type exported by "${manifest.authoringModule}" (its types: ${AUTHORING_TYPES.join(", ")}): import it without \`type\`.`, span(i.node)),
      );
    } else if (!i.isTypeOnly && authoredTypes.has(i.name)) {
      diagnostics.push(error(DiagnosticCode.UnknownImport, `'${i.name}' is a type: write \`import { type ${i.name} } from "${manifest.authoringModule}"\`.`, span(i.node)));
    } else if (!i.isTypeOnly && !authored.has(i.name)) {
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
  const authoring: AuthoringImports = { names: new Set(analysis.authoringImports.filter((i) => !i.isTypeOnly).map((i) => i.name)), reported: new Set() };

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
  useMount: "OnMount",
  useUnmount: "OnUnmount",
} as const;

/** Names imported from the authoring module, shared by every component of a file. */
interface AuthoringImports {
  readonly names: ReadonlySet<string>;
  /** Names already reported as missing, so each is reported once. */
  readonly reported: Set<string>;
}

/** Names a component cannot declare as props: the framework reads them off the element. */
const RESERVED_PROP_NAMES: ReadonlySet<string> = new Set(["key", "ref", "transform", "children"]);

/** The built-in a component's root is: its tag, or the host intrinsic for a fragment. */
function rootTag(jsx: JsxRoot, hostIntrinsic: string): string {
  if (isJsxFragment(jsx)) return hostIntrinsic;
  const tag = (isJsxElement(jsx) ? jsx.openingElement : jsx).tagName;
  return isIdentifier(tag) ? tag.text : hostIntrinsic;
}

type JsxElementNode = JsxElement | JsxSelfClosingElement;

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

/** `&amp;`, `&#38;`: JSX decodes these, and the compiler does not, so it asks for the character itself. */
const HTML_ENTITY = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

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
const SPECIAL_ATTRIBUTES: ReadonlySet<string> = new Set(["transform"]);

class ComponentLowering implements LoweringContext {
  readonly componentName: string;
  /** Component scope; function lowering nests scopes beneath it via `scope`. */
  readonly #componentScope = new Scope();
  readonly #stateTypes = new Map<StateId, TypeIR>();
  #serial = 0;
  scope: Scope = this.#componentScope;
  readonly #usedNames: Set<string>;
  readonly #component: ComponentAnalysis;
  readonly #sourceFile: SourceFile;
  readonly #fileName: string;
  readonly #manifest: RuntimeManifest;
  readonly #intrinsics: ReadonlySet<string>;
  readonly #locals: ReadonlySet<string>;
  readonly #imported: ReadonlyMap<string, { module: string; isDefault: boolean }>;
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
  /** Greater than zero while lowering a `useUnmount` handler, where state cannot be set. */
  #settersForbidden = 0;
  /** The props type declares `children: Child`. */
  #declaredChildren = false;
  /** A `{children}` slot has been lowered (there may be one). */
  #slotSeen = false;
  /** A `{children}` was written where it cannot go (already reported, so the missing slot is not reported again). */
  #slotRejected = false;
  readonly #refs: RefIR[] = [];

  constructor(
    component: ComponentAnalysis,
    sourceFile: SourceFile,
    fileName: string,
    manifest: RuntimeManifest,
    locals: ReadonlySet<string>,
    imported: ReadonlyMap<string, { module: string; isDefault: boolean }>,
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
    // A component extends its root element's class, so it may not reuse that class's own field names.
    this.#usedNames = new Set([...manifest.reservedMembers, ...(manifest.intrinsicMembers[rootTag(component.jsx, manifest.hostIntrinsic)] ?? [])]);
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
    if (this.#declaredChildren && !this.#slotSeen && !this.#slotRejected) {
      this.#error(DiagnosticCode.InvalidProps, "The props type declares `children`, but the component never renders `{children}`: put it where passed elements belong, or remove the prop.", this.#component.declaration);
    }
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
      isDefaultExport: this.#component.isDefault,
      isExported: this.#component.exported || this.#component.isDefault,
      acceptsChildren: this.#declaredChildren,
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
    if (analysis.objectName !== null) this.#componentScope.declare(analysis.objectName, { kind: "propsObject", name: analysis.objectName });
    for (const binding of analysis.bindings) {
      if (!members.has(binding.name)) {
        this.#error(code, `'${binding.name}' is not a prop of ${analysis.typeName}.`, binding.node);
      }
    }

    const out: PropDeclIR[] = [];
    for (const [name, member] of members) {
      if (name === "children") {
        // Not a value prop: the elements a parent passes mount at `{children}`. Typed `Child` so the TSX type-checks.
        const binding = bindings.get(name);
        if (member.role !== "value" || member.type.kind !== "SourceText" || member.type.text !== "Child") {
          this.#error(code, `\`children\` must be typed \`Child\`: \`children: Child;\`, with \`import { type Child } from "${this.#manifest.authoringModule}"\`.`, member.node);
        } else if (binding?.defaultValue) {
          this.#error(code, "`children` cannot have a default value.", binding.node);
        } else {
          this.#declaredChildren = true;
          if (binding) this.#componentScope.declare(name, { kind: "children", name });
        }
        continue;
      }
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
  #lowerCallback(
    name: string,
    fn: Node & { kind: SyntaxKind.ArrowFunction },
    params?: readonly { readonly name: string; readonly type: string }[],
  ): CallbackPropIR | null {
    this.#functionDepth++;
    const handler = lowerFunction(this, fn as unknown as Parameters<typeof lowerFunction>[1], {
      paramTypes: params ? params.map((p) => ({ kind: "Named" as const, name: p.type })) : "contextual",
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
        case "useMount":
        case "useUnmount": {
          const kind = HANDLER_KIND[hook.kind];
          const signature = HANDLER_SIGNATURES[kind];
          this.#functionDepth++;
          // The component is going away: it can no longer render, so there is nothing for a setter to do.
          if (hook.kind === "useUnmount") this.#settersForbidden++;
          const handler = lowerFunction(this, hook.handler, {
            paramTypes: signature.params.map((p) => p.type),
            returns: "void",
            what: `${hook.kind} handler`,
          });
          if (hook.kind === "useUnmount") this.#settersForbidden--;
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

  /**
   * The type of a `useState` value: its type argument (a primitive, an array,
   * or any type written in this file, such as a record interface), or
   * inferred from the initial value. An array or record needs the type
   * argument unless it comes from a prop, as in TypeScript, where `[]` alone
   * would be `never[]`.
   */
  #stateType(typeArgument: Node | null, initial: ExprIR, at: Node): TypeIR | null {
    if (typeArgument) return this.#typeFromNode(typeArgument);
    const primitive = this.#inferType(initial);
    if (primitive) return { kind: "Primitive", name: primitive };
    if (initial.kind === "PropRead") {
      const decl = this.#propDecls.find((p) => p.name === initial.name);
      if (decl?.role === "value") return propTypeToType(decl.type);
    }
    const code = DiagnosticCode.UnsupportedStateType;
    if (initial.kind === "ArrayLiteral" || initial.kind === "ObjectLiteral") {
      this.#error(code, `An ${initial.kind === "ArrayLiteral" ? "array" : "object"} state needs its type: \`useState<${initial.kind === "ArrayLiteral" ? "EnemyData[]" : "EnemyData"}>(…)\`, with the type declared in this file.`, at);
    } else {
      this.#error(code, "Cannot infer the type; use a number/string/boolean literal, a prop, or `useState<T>(...)`.", at);
    }
    return null;
  }

  /** A type argument: primitives and arrays are understood; anything else is kept as source text for the type-check. */
  #typeFromNode(node: Node): TypeIR {
    const t = unwrapTypeParens(node);
    switch (t.kind) {
      case SyntaxKind.NumberKeyword: return { kind: "Primitive", name: "number" };
      case SyntaxKind.StringKeyword: return { kind: "Primitive", name: "string" };
      case SyntaxKind.BooleanKeyword: return { kind: "Primitive", name: "boolean" };
    }
    if (isArrayTypeNode(t)) return { kind: "Array", element: this.#typeFromNode(t.elementType) };
    return { kind: "SourceType", text: t.getText(this.#sourceFile) };
  }

  /** The type of a `useRef` value: its type argument, or inferred from a literal initial value. Refs hold primitives only. */
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
    const inferred = this.#inferType(initial);
    if (!inferred) {
      this.#error(code, `Cannot infer the type; use a number/string/boolean literal, a prop, or \`${hook}<T>(...)\`.`, at);
    }
    return inferred;
  }

  /**
   * The type of an initial value, as TypeScript would infer it: literals, a
   * primitive prop (from its declaration in the props type), and operators
   * over those (`props.speed * 10` is a number, `n > 0` a boolean). Null
   * when it cannot be told, and the author writes `useState<number>(…)`.
   */
  #inferType(expr: ExprIR): ValueType | null {
    switch (expr.kind) {
      case "NumberLiteral": return "number";
      case "StringLiteral":
      case "TemplateLiteral": return "string";
      case "BooleanLiteral": return "boolean";
      case "PropRead": {
        const decl = this.#propDecls.find((p) => p.name === expr.name);
        return decl?.role === "value" && decl.type.kind === "Primitive" ? decl.type.name : null;
      }
      case "Unary": return expr.operator === "!" ? "boolean" : this.#inferType(expr.operand) === "number" ? "number" : null;
      case "Binary": {
        switch (expr.operator) {
          case "<": case "<=": case ">": case ">=": case "===": case "!==": case "==": case "!=": return "boolean";
          case "-": case "*": case "/": case "%": return this.#inferType(expr.left) === "number" && this.#inferType(expr.right) === "number" ? "number" : null;
          case "+": {
            const [left, right] = [this.#inferType(expr.left), this.#inferType(expr.right)];
            if (left === "string" || right === "string") return left && right ? "string" : null;
            return left === "number" && right === "number" ? "number" : null;
          }
          case "&&": case "||": case "??": {
            const [left, right] = [this.#inferType(expr.left), this.#inferType(expr.right)];
            return left !== null && left === right ? left : null;
          }
          default: return null;
        }
      }
      case "Conditional": {
        const [a, b] = [this.#inferType(expr.whenTrue), this.#inferType(expr.whenFalse)];
        return a !== null && a === b ? a : null;
      }
      default: return null;
    }
  }

  /**
   * The root is a built-in element (the component's class extends it) or a
   * fragment, which is an implicit container: a bare `<Entity>` with no props.
   */
  #lowerRoot(jsx: JsxRoot): HostElementIR | null {
    if (isJsxFragment(jsx)) {
      return {
        kind: "HostElement",
        component: { kind: "Intrinsic", name: this.#hostIntrinsic },
        props: [],
        transform: [],
        children: this.#lowerChildren(jsx.children, [], { slot: true, passed: false }),
        span: this.#span(jsx),
      };
    }
    const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
    const tag = opening.tagName;
    if (!isIdentifier(tag) || !this.#intrinsics.has(tag.text)) {
      this.#error(
        DiagnosticCode.RootMustBeEntity,
        `The root of component '${this.#component.name}' must be a built-in element (${this.#manifest.intrinsics.map((t) => `<${t}>`).join(", ")}) or a fragment \`<>…</>\`; a component cannot be the root of another.`,
        tag,
      );
      return null;
    }
    this.#requireImport(tag.text, tag);
    const props = this.#lowerProps(opening.attributes, tag.text, false);
    const transform = this.#lowerTransform(opening.attributes, tag.text, false);
    const textProp = this.#manifest.textContent[tag.text];
    let children: ChildIR[] = [];
    if (textProp !== undefined) props.push(...this.#lowerTextContent(isJsxElement(jsx) ? jsx.children : [], textProp, props, tag.text, jsx));
    else if (isJsxElement(jsx)) children = this.#lowerChildren(jsx.children, [], { slot: true, passed: false });
    this.#checkContainer(tag.text, children.length, jsx);
    return {
      kind: "HostElement",
      component: { kind: "Intrinsic", name: tag.text },
      props,
      transform,
      children,
      span: this.#span(jsx),
    };
  }

  /**
   * The text content of a built-in like `<Text>`: its JSX text and `{expressions}`
   * become one string prop (`text`), a template literal when they mix, so
   * `<Text>Score: {score}</Text>` and `<Text text={`Score: ${score}`} />` are the
   * same thing and update the same way. The element may use one form or the other.
   * Returns the prop to add (none when the content is the attribute or is empty).
   */
  #lowerTextContent(children: readonly JsxChild[], prop: string, props: readonly PropIR[], tag: string, at: Node): PropIR[] {
    const code = DiagnosticCode.UnsupportedJsxChild;
    const quasis: string[] = [""];
    const expressions: ExprIR[] = [];
    let ok = true;
    let any = false;
    for (const child of children) {
      if (isJsxText(child)) {
        if (HTML_ENTITY.test(child.text)) {
          this.#error(code, `<${tag}> text cannot contain HTML entities like \`&amp;\`: write the character itself, or an expression such as {"&"}.`, child);
          ok = false;
          continue;
        }
        const text = cleanJsxText(child.text);
        if (text !== "") any = true;
        quasis[quasis.length - 1] += text;
      } else if (isJsxExpression(child)) {
        if (!child.expression) continue; // `{/* comment */}`
        if (child.dotDotDotToken) {
          this.#error(code, `<${tag}> cannot spread children.`, child);
          ok = false;
          continue;
        }
        const value = this.#lowerExpression(child.expression);
        if (!value) {
          ok = false;
          continue;
        }
        any = true;
        // A literal is just text; anything else is interpolated (a number becomes its digits).
        if (value.kind === "StringLiteral") quasis[quasis.length - 1] += value.value;
        else if (value.kind === "NumberLiteral") quasis[quasis.length - 1] += String(value.value);
        else {
          expressions.push(value);
          quasis.push("");
        }
      } else {
        this.#error(code, `<${tag}> holds text, not elements: put elements next to it, inside an <${this.#hostIntrinsic}>.`, child);
        ok = false;
      }
    }
    if (!ok) return [];
    const given = props.some((p) => p.name === prop);
    if (given && any) {
      this.#error(DiagnosticCode.UnsupportedAttribute, `<${tag}> takes its content as text between its tags or as \`${prop}\`, not both.`, at);
      return [];
    }
    if (given) return [];
    if (!any) {
      this.#error(DiagnosticCode.UnsupportedJsxChild, `<${tag}> needs content: text between its tags (\`<${tag}>Score: {score}</${tag}>\`) or a \`${prop}\` prop.`, at);
      return [];
    }
    // `{`Score: ${score}`}` alone is already a template: use it as it is.
    const only = expressions.length === 1 && quasis.every((q) => q === "") ? expressions[0]! : null;
    const value: ExprIR =
      expressions.length === 0 ? { kind: "StringLiteral", value: quasis[0]! } : only && only.kind === "TemplateLiteral" ? only : { kind: "TemplateLiteral", quasis, expressions };
    const dependencies = collectDependencies(value);
    return [dependencies.length > 0 ? { kind: "DynamicProp", name: prop, value, dependencies } : { kind: "StaticProp", name: prop, value }];
  }

  /** Only a container (`<Entity>`) may hold JSX children; other built-ins are leaves. */
  #checkContainer(tag: string, childCount: number, at: Node): void {
    if (childCount > 0 && !this.#manifest.containerIntrinsics.includes(tag)) {
      this.#error(DiagnosticCode.UnsupportedJsxChild, `<${tag}> cannot have children; wrap them in <${this.#hostIntrinsic}>.`, at);
    }
  }

  /**
   * `{enemies.map((e, i) => <Enemy key={e.id} speed={e.speed} />)}`. The
   * source is a state or prop array, optionally filtered; the callback is an
   * inline arrow returning one element with a `key` and no children. The
   * item and index are parameters in a scope of their own, and the element's
   * props that read them become dynamic with an `Item` dependency, so every
   * item's props are re-applied when the list renders.
   */
  #lowerList(call: CallExpression, path: readonly number[]): KeyedListChildIR | null {
    const code = DiagnosticCode.InvalidList;
    const callee = call.expression as PropertyAccessExpression;
    const shape = "A list is written `{items.map((item) => <Element key={item.id} … />)}`";
    if (call.questionDotToken || callee.questionDotToken) {
      this.#error(code, `${shape}, without \`?.\`.`, call);
      return null;
    }
    const fn = call.arguments.length === 1 ? unwrapParens(call.arguments[0]!) : null;
    if (!fn || !isArrowFunction(fn)) {
      this.#error(code, `${shape}: \`map\` takes one inline arrow function.`, call);
      return null;
    }
    let returned: Expression | null = null;
    if (!isBlock(fn.body)) returned = fn.body;
    else if (fn.body.statements.length === 1 && isReturnStatement(fn.body.statements[0]!) && fn.body.statements[0].expression) returned = fn.body.statements[0].expression;
    const jsx = returned ? unwrapParens(returned) : null;
    if (!jsx || !(isJsxElement(jsx) || isJsxSelfClosingElement(jsx))) {
      this.#error(code, `${shape}: the callback returns exactly one element (no conditionals, fragments or other statements).`, fn.body);
      return null;
    }
    if (fn.parameters.length < 1 || fn.parameters.length > 2) {
      this.#error(code, `${shape}: the callback takes the item, and optionally its index.`, fn);
      return null;
    }
    const source = this.#lowerExpression(callee.expression);
    if (!source) return null;
    if (!isListSource(source)) {
      this.#error(code, "A list's items come from a state or prop array, optionally followed by `.filter(…)`: `enemies.map(…)` or `enemies.filter((e) => e.alive).map(…)`.", callee.expression);
      return null;
    }

    const outer = this.scope;
    this.scope = new Scope(outer);
    try {
      const params: ParamIR[] = [];
      for (const param of fn.parameters) {
        if (!isIdentifier(param.name) || param.initializer || param.dotDotDotToken || param.type) {
          this.#error(code, "The list callback's parameters are plain names: `(item, index) =>`.", param);
          return null;
        }
        const name = param.name.text;
        if (!checkFreshName(this, name, param)) return null;
        const id = localId(this.componentName, name, this.nextSerial());
        this.scope.declare(name, { kind: "param", id, name, type: { kind: "Contextual" } });
        params.push({ id, name, type: { kind: "Contextual" } });
      }
      const [item, index = null] = params as [ParamIR, ParamIR?];

      const opening = isJsxElement(jsx) ? jsx.openingElement : jsx;
      const keyAttribute = findAttribute(opening.attributes, "key");
      if (!keyAttribute) {
        this.#error(code, `Each item of a list needs a \`key\` that identifies it across renders: \`key={${item.name}.id}\`.`, opening);
        return null;
      }
      const keyInit = keyAttribute.initializer;
      const keyNode = keyInit && isJsxExpression(keyInit) && keyInit.expression && !keyInit.dotDotDotToken ? keyInit.expression : null;
      if (!keyNode) {
        this.#error(code, `\`key\` takes an expression that reads the item: \`key={${item.name}.id}\`.`, keyAttribute);
        return null;
      }
      const key = this.#lowerExpression(keyNode);
      const lowered = this.#lowerElement(jsx, path, true);
      if (!key || !lowered) return null;
      const readsItem = readsParam(key, item.id);
      const readsIndex = index !== null && readsParam(key, index.id);
      if (!readsItem && !readsIndex) {
        this.#error(code, `\`key\` must read the item (\`key={${item.name}.id}\`): a key that is the same for every item is always a duplicate.`, keyNode);
        return null;
      }
      if (!readsItem) {
        this.#diagnostics.push(
          warning(code, `\`key\` reads only the index, so an item keeps its instance by position, not by identity: removing or reordering items moves state between them. Prefer an id from the item.`, this.#span(keyNode)),
        );
      }
      if (lowered.children.length > 0) {
        this.#error(code, "A list item cannot have children yet: make the item a component that renders them.", jsx);
        return null;
      }
      const element = this.#asListItem(lowered, item, index);
      return element && { kind: "KeyedListChild", source, item, index, key, element, dependencies: collectDependencies(source) };
    } finally {
      this.scope = outer;
    }
  }

  /**
   * A list item's props that read the item or index are re-applied for every
   * item on each render (an `Item` dependency); a callback prop may read the
   * item (generated code looks up its current value by key) but not the
   * index, which changes when items move.
   */
  #asListItem(el: ElementIR, item: ParamIR, index: ParamIR | null): ElementIR | null {
    const readsItem = (e: ExprIR): boolean => readsParam(e, item.id) || (index !== null && readsParam(e, index.id));
    const dynamic = <T extends ValuePropIR>(p: T): T => {
      if (!readsItem(p.value)) return p;
      return { kind: "DynamicProp", name: p.name, value: p.value, dependencies: [...collectDependencies(p.value), { kind: "Item" }] } as unknown as T;
    };
    let ok = true;
    const props = el.props.map((p) => {
      if (p.kind !== "CallbackProp") return dynamic(p);
      if (index !== null && functionReadsParam(p.handler, index.id)) {
        this.#diagnostics.push(error(DiagnosticCode.InvalidList, `Callback '${p.name}' cannot read the index '${index.name}': it changes when items move. Read the item (\`${item.name}.id\`) instead.`, el.span));
        this.#errorCount++;
        ok = false;
      }
      return p;
    });
    return ok ? { ...el, props, transform: el.transform.map(dynamic) } : null;
  }

  /** `slotOk`: a `{children}` slot may appear in this element's children (it is in a static chain from the root). */
  #lowerElement(jsx: JsxElementNode, path: readonly number[], listItem = false, slotOk = false): ElementIR | null {
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
    else if (this.#imported.has(tag.text)) {
      const { module, isDefault } = this.#imported.get(tag.text)!;
      component = { kind: "Imported", name: tag.text, module, isDefault };
    }
    else {
      this.#error(DiagnosticCode.UnknownComponent, `Unknown component <${tag.text}>. Declare it in this file, import it from a .tsx file, or use a runtime intrinsic.`, tag);
      return null;
    }

    const isComponent = component.kind !== "Intrinsic";
    const props = this.#lowerProps(opening.attributes, tag.text, isComponent, listItem);
    const transform = this.#lowerTransform(opening.attributes, tag.text, isComponent);
    // On a component, the children are passed to it: the block is lowered here (this component owns them) but mounts
    // at the receiver's slot. A built-in keeps them.
    const textProp = isComponent ? undefined : this.#manifest.textContent[tag.text];
    let children: ChildIR[] = [];
    if (textProp !== undefined) props.push(...this.#lowerTextContent(isJsxElement(jsx) ? jsx.children : [], textProp, props, tag.text, jsx));
    else if (isJsxElement(jsx)) children = this.#lowerChildren(jsx.children, path, { slot: slotOk && !isComponent, passed: isComponent });
    if (isComponent && children.some((c) => c.kind === "KeyedListChild") && children.length > 1) {
      this.#error(
        DiagnosticCode.InvalidList,
        `A list passed to <${tag.text}> must be its only child: the list's items and the other children would share positions. Wrap the list in an <${this.#hostIntrinsic}> or make the others part of the list.`,
        jsx,
      );
    }
    if (!isComponent) this.#checkContainer(tag.text, children.length, jsx);

    return {
      kind: "Element",
      id: elementId(this.#component.name, path),
      fieldName: this.#allocateFieldName(tag.text, listItem ? "Items" : null),
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
   * for duplicate detection; `ref` is rejected. An arrow function is a callback
   * prop: on a component element its parameters come from the child's props
   * type; on a built-in it must be one the runtime manifest lists
   * (`<Collider onCollisionEnter>`), with the parameter types it gives.
   */
  #lowerProps(attributes: JsxAttributes, tag: string, toComponent: boolean, listItem = false): PropIR[] {
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
      if (SPECIAL_ATTRIBUTES.has(name) || (name === "key" && listItem)) continue;
      if (name === "key" || name === "children") {
        this.#error(
          DiagnosticCode.UnsupportedAttribute,
          name === "key" ? "`key` belongs on the element a list returns: `{items.map((item) => <Element key={item.id} />)}`." : "`children` cannot be passed yet.",
          attribute,
        );
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
          const params = toComponent ? undefined : this.#manifest.intrinsicCallbacks[tag]?.[name];
          if (!toComponent && !params) {
            this.#error(DiagnosticCode.UnsupportedAttribute, `<${tag}> has no callback prop '${name}': callbacks can be passed to components, and to the built-in callback props the runtime lists.`, attribute);
            continue;
          }
          const callback = this.#lowerCallback(name, expression, params);
          if (callback) props.push(callback);
          continue;
        }
        // `onX={onX}` forwards a callback prop whole.
        this.#allowCallbackRead = toComponent && (isIdentifier(expression) || isPropertyAccessExpression(expression));
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

  /**
   * `slot`: a `{children}` may appear here (a container reachable through static elements). `passed`: these are
   * children passed to a component, which mount at its slot.
   */
  #lowerChildren(children: readonly JsxChild[], parentPath: readonly number[], context: { readonly slot: boolean; readonly passed: boolean }): ChildIR[] {
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
        const element = this.#lowerElement(child, path, false, context.slot);
        if (element) out.push({ kind: "StaticChild", element });
        continue;
      }
      if (isJsxExpression(child) && child.expression) {
        const expression = unwrapParens(child.expression);
        if (this.#isChildrenReference(expression)) {
          if (this.#lowerChildrenSlot(child, context)) out.push({ kind: "ChildrenSlot" });
          continue;
        }
        if (isCallExpression(expression) && isPropertyAccessExpression(expression.expression) && expression.expression.name.text === "map") {
          const list = this.#lowerList(expression, path);
          if (list) out.push(list);
          continue;
        }
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
        this.#error(DiagnosticCode.UnsupportedJsxChild, "Expression children must have the form `{condition && <Element />}`, `{condition ? <A /> : <B />}` (a branch may be `null`) or `{items.map((item) => <Element key={item.id} />)}`.", child);
        continue;
      }
      this.#error(DiagnosticCode.UnsupportedJsxChild, `Unsupported JSX child (${SyntaxKind[child.kind]}).`, child);
    }
    return out;
  }

  /** `children` or `props.children`, where it names the `children` prop of this component. */
  #isChildrenReference(node: Expression): boolean {
    if (isIdentifier(node)) return this.scope.get(node.text)?.kind === "children";
    if (isPropertyAccessExpression(node) && node.name.text === "children") {
      const object = unwrapParens(node.expression);
      return isIdentifier(object) && this.scope.get(object.text)?.kind === "propsObject";
    }
    return false;
  }

  /** Checks that `{children}` is somewhere a slot can be. A slot must be in a container that is always there, once. */
  #lowerChildrenSlot(at: Node, context: { readonly slot: boolean; readonly passed: boolean }): boolean {
    const code = DiagnosticCode.UnsupportedJsxChild;
    this.#slotRejected = true;
    if (context.passed) {
      this.#error(code, "Forwarding `children` to another component is not supported yet: render `{children}` inside a built-in container instead.", at);
      return false;
    }
    if (!context.slot) {
      this.#error(code, "`{children}` must be a direct child of a container that is always present: not inside a condition, a list, or another component's children.", at);
      return false;
    }
    if (this.#slotSeen) {
      this.#error(code, "`{children}` can appear only once in a component.", at);
      return false;
    }
    this.#slotSeen = true;
    this.#slotRejected = false;
    return true;
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
        case "propsObject":
          this.#error(DiagnosticCode.UnsupportedExpression, `'${node.text}' is the props object: read a prop as \`${node.text}.name\`.`, node);
          return null;
        case "children":
          this.#error(DiagnosticCode.UnsupportedExpression, "`children` can only be used as a JSX child, `{children}`: it is the elements a parent passes, not a value.", node);
          return null;
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
    if (isArrayLiteralExpression(node)) {
      const elements: ArrayElementIR[] = [];
      for (const element of node.elements) {
        const spread = isSpreadElement(element);
        const value = this.#lowerExpression(spread ? element.expression : element);
        if (!value) return null;
        elements.push({ spread, value });
      }
      return { kind: "ArrayLiteral", elements };
    }
    if (isObjectLiteralExpression(node)) return this.#lowerObjectLiteral(node);
    if (isArrowFunction(node)) {
      this.#error(
        DiagnosticCode.UnsupportedExpression,
        "An arrow function can only be a callback prop (`onX={() => …}`), a state updater (`setX((x) => …)`) or the argument of an array method (`items.filter((e) => …)`).",
        node,
      );
      return null;
    }
    this.#error(DiagnosticCode.UnsupportedExpression, `Unsupported expression (${SyntaxKind[node.kind]}).`, node);
    return null;
  }

  /** `{ id, speed: 2, ...e }`: plain, shorthand and spread properties. */
  #lowerObjectLiteral(node: ObjectLiteralExpression): ExprIR | null {
    const properties: ObjectPropertyIR[] = [];
    let ok = true;
    for (const property of node.properties) {
      let entry: ObjectPropertyIR | null = null;
      if (isPropertyAssignment(property) && (isIdentifier(property.name) || isStringLiteral(property.name))) {
        const value = this.#lowerExpression(property.initializer);
        entry = value && { kind: "Property", name: property.name.text, value };
      } else if (isShorthandPropertyAssignment(property) && isIdentifier(property.name) && !property.objectAssignmentInitializer) {
        const value = this.#lowerExpression(property.name);
        entry = value && { kind: "Property", name: property.name.text, value };
      } else if (isSpreadAssignment(property)) {
        const value = this.#lowerExpression(property.expression);
        entry = value && { kind: "Spread", value };
      } else {
        this.#error(DiagnosticCode.UnsupportedExpression, "Object properties must be `name: value`, `name` (shorthand) or `...spread`; no methods, getters or computed names.", property);
      }
      if (entry) properties.push(entry);
      else ok = false;
    }
    return ok ? { kind: "ObjectLiteral", properties } : null;
  }

  /**
   * The callback of an array method: an expression-bodied arrow, lowered in
   * its own scope. Its parameters are typed by the array, so they carry no
   * annotation. A block body could set state or call callbacks while the
   * array is being walked, so it is not allowed.
   */
  #lowerArrow(node: Expression, method: string): ExprIR | null {
    const fn = unwrapParens(node);
    if (!isArrowFunction(fn)) {
      this.#error(DiagnosticCode.UnsupportedExpression, `\`${method}\` takes an inline arrow function: \`items.${method}((item) => …)\`.`, node);
      return null;
    }
    if (isBlock(fn.body)) {
      this.#error(DiagnosticCode.UnsupportedExpression, `The \`${method}\` callback must be a single expression (\`(item) => item.alive\`), not a block.`, fn.body);
      return null;
    }
    const lowered = lowerFunction(this, fn, { paramTypes: "contextual", returns: "value", what: `${method} callback` });
    if (!lowered) return null;
    const only = lowered.body[0];
    if (lowered.body.length !== 1 || only?.kind !== "Return" || !only.value) throw new Error("expression-bodied arrow lowered to statements");
    return { kind: "Arrow", params: lowered.params, body: only.value };
  }

  /** `ref.current`, or `param.name` where `param` is a handler parameter of a runtime handle type. */
  #lowerPropertyRead(node: PropertyAccessExpression): ExprIR | null {
    const propsObject = this.#propsObjectMember(node);
    if (propsObject !== undefined) {
      if (propsObject === null) return null;
      if (propsObject.role === "callback" && !this.#allowCallbackRead) {
        this.#error(DiagnosticCode.UnsupportedExpression, `'${propsObject.name}' is a callback prop: call it (\`props.${propsObject.name}?.()\`) or forward it whole (\`onX={props.${propsObject.name}}\`).`, node);
        return null;
      }
      return { kind: "PropRead", name: propsObject.name };
    }
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
    const receiver = this.#handleParam(node.expression);
    const name = node.name.text;
    if (receiver) {
      if (!this.#manifest.handleTypes[receiver.type]!.properties.includes(name)) {
        this.#error(DiagnosticCode.UnsupportedExpression, `'${receiver.type}' has no readable property '${name}'.`, node.name);
        return null;
      }
      return { kind: "PropertyRead", object: receiver.read, name };
    }
    // A member of a value (`e.id`, `enemies.length`): the type-check of the generated code validates it.
    // Numbers and booleans have no members worth reading, so those are caught here.
    const primitive = this.#knownPrimitive(node.expression);
    if (primitive === "number" || primitive === "boolean") {
      this.#error(DiagnosticCode.UnsupportedExpression, `'${node.expression.getText(this.#sourceFile)}' is a ${primitive}; it has no member '${name}'.`, node.name);
      return null;
    }
    const object = this.#lowerExpression(node.expression);
    return object && { kind: "MemberRead", object, name, optional: node.questionDotToken !== undefined };
  }

  /**
   * `props.speed` for a component that takes `(props: EnemyProps)`. Undefined if
   * `node` is not on the props object (the caller carries on); null after
   * reporting a member the props type does not have.
   */
  #propsObjectMember(node: PropertyAccessExpression): { name: string; role: "value" | "callback" } | null | undefined {
    const object = unwrapParens(node.expression);
    const binding = isIdentifier(object) ? this.scope.get(object.text) : undefined;
    if (binding?.kind !== "propsObject") return undefined;
    const decl = this.#propDecls.find((p) => p.name === node.name.text);
    if (!decl && node.name.text === "children" && this.#declaredChildren) {
      this.#error(DiagnosticCode.UnsupportedExpression, "`children` can only be used as a JSX child, `{props.children}`: it is the elements a parent passes, not a value.", node.name);
      return null;
    }
    if (!decl) {
      this.#error(DiagnosticCode.UnsupportedExpression, `'${node.name.text}' is not a prop of ${this.#component.props?.typeName ?? "this component"}.`, node.name);
      return null;
    }
    return { name: decl.name, role: decl.role };
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
    // `props.onDefeated?.()` on the props object.
    if (isPropertyAccessExpression(callee)) {
      const member = this.#propsObjectMember(callee);
      if (member === null) return null;
      if (member) {
        if (member.role !== "callback") {
          this.#error(DiagnosticCode.UnsupportedExpression, `Prop '${member.name}' is not a function, so it cannot be called.`, callee);
          return null;
        }
        const args: ExprIR[] = [];
        for (const argument of node.arguments) {
          const lowered = this.#lowerExpression(argument);
          if (!lowered) return null;
          args.push(lowered);
        }
        return { kind: "Call", callee: { kind: "Prop", name: member.name, optional: node.questionDotToken !== undefined }, args };
      }
    }
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
    } else if (isPropertyAccessExpression(callee) && !this.#handleParam(callee.expression)) {
      return this.#lowerArrayMethod(node, callee);
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

  /** `enemies.filter((e) => e.alive)`: an allowlisted array method that does not mutate its receiver. */
  #lowerArrayMethod(node: CallExpression, callee: PropertyAccessExpression): ExprIR | null {
    const name = callee.name.text;
    const code = DiagnosticCode.UnsupportedExpression;
    if (Object.hasOwn(MUTATING_ARRAY_METHODS, name)) {
      this.#error(
        code,
        `\`${name}\` changes the array in place, which never re-renders (a setter only renders when it gets a new array). Build a new array instead: ${MUTATING_ARRAY_METHODS[name]}.`,
        callee.name,
      );
      return null;
    }
    if (!Object.hasOwn(ARRAY_METHODS, name)) {
      this.#error(
        code,
        `'${name}' is not an allowlisted call. Supported: Math.abs/floor/ceil/round/sign/sqrt/sin/cos/min/max, runtime functions from the manifest, methods of handler parameters, and the array methods ${Object.keys(ARRAY_METHODS).join(", ")}.`,
        callee.name,
      );
      return null;
    }
    if (callee.questionDotToken || node.questionDotToken) {
      this.#error(code, `Optional calls of array methods are not supported: check the value first.`, node);
      return null;
    }
    const method = ARRAY_METHODS[name as ArrayMethodName];
    const [min, max] = method.args;
    const count = node.arguments.length;
    if (count < min || count > max) {
      const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
      this.#error(code, `\`${name}\` expects ${expected} argument(s).`, node);
      return null;
    }
    const receiver = this.#lowerExpression(callee.expression);
    if (!receiver) return null;
    const args: ExprIR[] = [];
    for (const [i, argument] of node.arguments.entries()) {
      const lowered = method.callback && i === 0 ? this.#lowerArrow(argument, name) : this.#lowerExpression(argument);
      if (!lowered) return null;
      args.push(lowered);
    }
    return { kind: "Call", callee: { kind: "ArrayMethod", receiver, name: name as ArrayMethodName }, args };
  }

  /** The primitive type of a name, if it is a parameter or state slot whose type is known to be primitive. */
  #knownPrimitive(node: Expression): ValueType | null {
    const target = unwrapParens(node);
    const binding = isIdentifier(target) ? this.scope.get(target.text) : undefined;
    let type: TypeIR | undefined;
    if (binding?.kind === "param") type = binding.type;
    else if (binding?.kind === "state") type = this.#stateTypes.get(binding.id);
    return type?.kind === "Primitive" && type.name !== "void" ? type.name : null;
  }

  /** The handler parameter of a runtime handle type (`input`) that `node` names, or null (no diagnostic). */
  #handleParam(node: Expression): { type: string; read: ParamReadIR } | null {
    const target = unwrapParens(node);
    const binding = isIdentifier(target) ? this.scope.get(target.text) : undefined;
    if (binding?.kind !== "param" || binding.type.kind !== "Named") return null;
    return { type: binding.type.name, read: { kind: "ParamRead", param: binding.id, name: binding.name } };
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

  /** A free field name for an element; with a suffix (a list's `enemyItems`), the suffixed name is claimed too. */
  #allocateFieldName(tag: string, suffix: string | null = null): string {
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    const taken = (name: string): boolean => this.#usedNames.has(name) || (suffix !== null && this.#usedNames.has(name + suffix));
    let candidate = base;
    for (let n = 2; taken(candidate); n++) candidate = `${base}${n}`;
    this.#usedNames.add(candidate);
    if (suffix !== null) this.#usedNames.add(candidate + suffix);
    return candidate;
  }

  // -- LoweringContext --------------------------------------------------------

  lowerExpression(node: Expression): ExprIR | null {
    return this.#lowerExpression(node);
  }

  stateType(state: StateId): TypeIR {
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

  canSetState(): boolean {
    return this.#settersForbidden === 0;
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

/** A list's source: a state or prop array, optionally followed by `.filter(…)` calls. */
function isListSource(e: ExprIR): boolean {
  if (e.kind === "StateRead" || e.kind === "PropRead") return true;
  return e.kind === "Call" && e.callee.kind === "ArrayMethod" && e.callee.name === "filter" && isListSource(e.callee.receiver);
}

/** A declared prop's type as a state type (`useState(items)` takes the prop's type). */
function propTypeToType(type: PropTypeIR): TypeIR | null {
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

function findAttribute(attributes: JsxAttributes, name: string): JsxAttribute | null {
  for (const attribute of attributes.properties) {
    if (isJsxAttribute(attribute) && isIdentifier(attribute.name) && attribute.name.text === name) return attribute;
  }
  return null;
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
