// The base of the component lowering: fields, names, diagnostics and type helpers. Layer 0 of ComponentLowering (see transform.ts).
import { SyntaxKind, type Expression, type PropertyAccessExpression, type Node, type SourceFile } from "typescript/ast";
import { isPropertyAccessExpression, isIdentifier, isArrayTypeNode, isUnionTypeNode } from "typescript/ast/is";
import { unwrapParens, type TypeDeclarationAnalysis, type ComponentAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, error, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { type TypeIR, type ParamIR, type ValuePropIR, readsParam, functionReadsParam, collectDependencies, type RefId, type RefIR, type SoundIR, type PropDeclIR, type PropTypeIR, type ElementIR, type ExprIR, type ParamReadIR, type SourceSpan, type StateId, type ValueType } from "../ir/types.ts";
import { spanOf } from "../parser/parser.ts";
import { type GameStateDefinition } from "../gamestate/schema.ts";
import { type RuntimeManifest } from "@rge/runtime";
import { Scope } from "./scope.ts";
import { type AuthoringImports, rootTag, unwrapTypeParens, literalValue, nearest } from "./helpers.ts";

export class LoweringBase {
  readonly componentName: string;
  /** Component scope; function lowering nests scopes beneath it via `scope`. */
  protected readonly componentScope = new Scope();
  protected readonly stateTypes = new Map<StateId, TypeIR>();
  protected serial = 0;
  scope: Scope = this.componentScope;
  protected readonly usedNames: Set<string>;
  protected readonly component: ComponentAnalysis;
  protected readonly sourceFile: SourceFile;
  protected readonly fileName: string;
  protected readonly manifest: RuntimeManifest;
  protected readonly intrinsics: ReadonlySet<string>;
  protected readonly locals: ReadonlySet<string>;
  protected readonly imported: ReadonlyMap<string, { module: string; isDefault: boolean }>;
  protected readonly hostIntrinsic: string;
  protected readonly authoring: AuthoringImports;
  protected readonly typeDecls: ReadonlyMap<string, TypeDeclarationAnalysis>;
  protected propDecls: readonly PropDeclIR[] = [];
  /** True while lowering the value of `onX={onX}`, where a callback prop may be forwarded whole. */
  protected allowCallbackRead = false;
  protected readonly diagnostics: CompilerDiagnostic[];
  protected errorCount = 0;
  /** Greater than zero while lowering a handler body: the only place `ref.current` is allowed. */
  protected functionDepth = 0;
  /** Greater than zero while lowering a `useUnmount` handler, where state cannot be set. */
  protected settersForbidden = 0;
  /** Greater than zero while lowering a state updater. */
  protected updaterDepth = 0;
  /** The props type declares `children: Child`. */
  protected declaredChildren = false;
  /** A `{children}` slot has been lowered (there may be one). */
  protected slotSeen = false;
  /** A `{children}` was written where it cannot go (already reported, so the missing slot is not reported again). */
  protected slotRejected = false;
  protected readonly refs: RefIR[] = [];
  protected readonly sounds: SoundIR[] = [];
  protected readonly gameState: GameStateDefinition | undefined;
  protected readonly storeImports: ReadonlySet<string>;

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
    gameState: GameStateDefinition | undefined,
    storeImports: ReadonlySet<string>,
  ) {
    this.gameState = gameState;
    this.storeImports = storeImports;
    this.typeDecls = typeDecls;
    this.authoring = authoring;
    this.component = component;
    this.componentName = component.name;
    this.sourceFile = sourceFile;
    this.fileName = fileName;
    this.manifest = manifest;
    this.intrinsics = new Set(manifest.intrinsics);
    this.imported = imported;
    // A component extends its root element's class, so it may not reuse that class's own field names.
    this.usedNames = new Set([...manifest.reservedMembers, ...(manifest.intrinsicMembers[rootTag(component.jsx, manifest.hostIntrinsic)] ?? [])]);
    this.locals = locals;
    this.hostIntrinsic = manifest.hostIntrinsic;
    this.diagnostics = diagnostics;
  }

  /** A prop type as the compiler understands it; anything else is carried as source text. */
  protected propType(node: Node | null): PropTypeIR {
    if (node === null) return { kind: "SourceText", text: "unknown" };
    const t = unwrapTypeParens(node);
    switch (t.kind) {
      case SyntaxKind.NumberKeyword: return { kind: "Primitive", name: "number" };
      case SyntaxKind.StringKeyword: return { kind: "Primitive", name: "string" };
      case SyntaxKind.BooleanKeyword: return { kind: "Primitive", name: "boolean" };
    }
    if (isArrayTypeNode(t)) {
      const element = this.propType(t.elementType);
      return element.kind === "SourceText" ? { kind: "SourceText", text: t.getText(this.sourceFile) } : { kind: "Array", element };
    }
    const literals = isUnionTypeNode(t) ? t.types.map((u) => literalValue(u)) : [literalValue(t)];
    if (literals.every((v) => v !== null)) return { kind: "Literals", values: literals as (string | number)[] };
    return { kind: "SourceText", text: t.getText(this.sourceFile) };
  }

  /** A type argument: primitives and arrays are understood; anything else is kept as source text for the type-check. */
  protected typeFromNode(node: Node): TypeIR {
    const t = unwrapTypeParens(node);
    switch (t.kind) {
      case SyntaxKind.NumberKeyword: return { kind: "Primitive", name: "number" };
      case SyntaxKind.StringKeyword: return { kind: "Primitive", name: "string" };
      case SyntaxKind.BooleanKeyword: return { kind: "Primitive", name: "boolean" };
    }
    if (isArrayTypeNode(t)) return { kind: "Array", element: this.typeFromNode(t.elementType) };
    return { kind: "SourceType", text: t.getText(this.sourceFile) };
  }

  /**
   * The type of an initial value, as TypeScript would infer it: literals, a
   * primitive prop (from its declaration in the props type), and operators
   * over those (`props.speed * 10` is a number, `n > 0` a boolean). Null
   * when it cannot be told, and the author writes `useState<number>(…)`.
   */
  protected inferType(expr: ExprIR): ValueType | null {
    switch (expr.kind) {
      case "NumberLiteral": return "number";
      case "StringLiteral":
      case "TemplateLiteral": return "string";
      case "BooleanLiteral": return "boolean";
      case "PropRead": {
        const decl = this.propDecls.find((p) => p.name === expr.name);
        return decl?.role === "value" && decl.type.kind === "Primitive" ? decl.type.name : null;
      }
      case "Unary": return expr.operator === "!" ? "boolean" : this.inferType(expr.operand) === "number" ? "number" : null;
      case "Binary": {
        switch (expr.operator) {
          case "<": case "<=": case ">": case ">=": case "===": case "!==": case "==": case "!=": return "boolean";
          case "-": case "*": case "/": case "%": return this.inferType(expr.left) === "number" && this.inferType(expr.right) === "number" ? "number" : null;
          case "+": {
            const [left, right] = [this.inferType(expr.left), this.inferType(expr.right)];
            if (left === "string" || right === "string") return left && right ? "string" : null;
            return left === "number" && right === "number" ? "number" : null;
          }
          case "&&": case "||": case "??": {
            const [left, right] = [this.inferType(expr.left), this.inferType(expr.right)];
            return left !== null && left === right ? left : null;
          }
          default: return null;
        }
      }
      case "Conditional": {
        const [a, b] = [this.inferType(expr.whenTrue), this.inferType(expr.whenFalse)];
        return a !== null && a === b ? a : null;
      }
      default: return null;
    }
  }

  /** Only a container (`<Entity>`) may hold JSX children; other built-ins are leaves. */
  protected checkContainer(tag: string, childCount: number, at: Node): void {
    if (childCount > 0 && !this.manifest.containerIntrinsics.includes(tag)) {
      this.report(DiagnosticCode.UnsupportedJsxChild, `<${tag}> cannot have children; wrap them in <${this.hostIntrinsic}>.`, at);
    }
  }

  /**
   * A list item's props that read the item or index are re-applied for every
   * item on each render (an `Item` dependency); a callback prop may read the
   * item (generated code looks up its current value by key) but not the
   * index, which changes when items move.
   */
  protected asListItem(el: ElementIR, item: ParamIR, index: ParamIR | null): ElementIR | null {
    const readsItem = (e: ExprIR): boolean => readsParam(e, item.id) || (index !== null && readsParam(e, index.id));
    const dynamic = <T extends ValuePropIR>(p: T): T => {
      if (!readsItem(p.value)) return p;
      return { kind: "DynamicProp", name: p.name, value: p.value, dependencies: [...collectDependencies(p.value), { kind: "Item" }] } as unknown as T;
    };
    let ok = true;
    const props = el.props.map((p) => {
      if (p.kind !== "CallbackProp") return dynamic(p);
      if (index !== null && functionReadsParam(p.handler, index.id)) {
        this.diagnostics.push(error(DiagnosticCode.InvalidList, `Callback '${p.name}' cannot read the index '${index.name}': it changes when items move. Read the item (\`${item.name}.id\`) instead.`, el.span));
        this.errorCount++;
        ok = false;
      }
      return p;
    });
    return ok ? { ...el, props, transform: el.transform.map(dynamic) } : null;
  }

  /**
   * A built-in prop that takes one of a fixed set of strings (the manifest's
   * `intrinsicLiterals`, such as `<Shape kind>`): a literal is checked here,
   * with the choices (and the nearest one, for a typo) in the message. Any other
   * expression is left to the type-check, so `kind={big ? "rect" : "circle"}` works.
   */
  protected checkLiteralChoice(tag: string, name: string, value: ExprIR, at: Node): boolean {
    const allowed = this.manifest.intrinsicLiterals[tag]?.[name];
    if (!allowed) return true;
    if (value.kind === "StringLiteral" && allowed.includes(value.value)) return true;
    if (value.kind !== "StringLiteral" && value.kind !== "NumberLiteral" && value.kind !== "BooleanLiteral" && value.kind !== "NullLiteral") return true;
    const given = value.kind === "StringLiteral" ? `'${value.value}'` : value.kind === "NullLiteral" ? "null" : String(value.value);
    const near = value.kind === "StringLiteral" ? nearest(value.value, allowed) : null;
    this.report(
      DiagnosticCode.InvalidPropValue,
      `<${tag} ${name}> must be one of ${allowed.map((v) => `"${v}"`).join(", ")}, not ${given}${near ? ` (did you mean "${near}"?)` : ""}.`,
      at,
    );
    return false;
  }

  /** `children` or `props.children`, where it names the `children` prop of this component. */
  protected isChildrenReference(node: Expression): boolean {
    if (isIdentifier(node)) return this.scope.get(node.text)?.kind === "children";
    if (isPropertyAccessExpression(node) && node.name.text === "children") {
      const object = unwrapParens(node.expression);
      return isIdentifier(object) && this.scope.get(object.text)?.kind === "propsObject";
    }
    return false;
  }

  /** Checks that `{children}` is somewhere a slot can be. A slot must be in a container that is always there, once. */
  protected lowerChildrenSlot(at: Node, context: { readonly slot: boolean; readonly passed: boolean }): boolean {
    const code = DiagnosticCode.UnsupportedJsxChild;
    this.slotRejected = true;
    if (context.passed) {
      this.report(code, "Forwarding `children` to another component is not supported yet: render `{children}` inside a built-in container instead.", at);
      return false;
    }
    if (!context.slot) {
      this.report(code, "`{children}` must be a direct child of a container that is always present: not inside a condition, a list, or another component's children.", at);
      return false;
    }
    if (this.slotSeen) {
      this.report(code, "`{children}` can appear only once in a component.", at);
      return false;
    }
    this.slotSeen = true;
    this.slotRejected = false;
    return true;
  }

  /**
   * `props.speed` for a component that takes `(props: EnemyProps)`. Undefined if
   * `node` is not on the props object (the caller carries on); null after
   * reporting a member the props type does not have.
   */
  protected propsObjectMember(node: PropertyAccessExpression): { name: string; role: "value" | "callback" } | null | undefined {
    const object = unwrapParens(node.expression);
    const binding = isIdentifier(object) ? this.scope.get(object.text) : undefined;
    if (binding?.kind !== "propsObject") return undefined;
    const decl = this.propDecls.find((p) => p.name === node.name.text);
    if (!decl && node.name.text === "children" && this.declaredChildren) {
      this.report(DiagnosticCode.UnsupportedExpression, "`children` can only be used as a JSX child, `{props.children}`: it is the elements a parent passes, not a value.", node.name);
      return null;
    }
    if (!decl) {
      this.report(DiagnosticCode.UnsupportedExpression, `'${node.name.text}' is not a prop of ${this.component.props?.typeName ?? "this component"}.`, node.name);
      return null;
    }
    return { name: decl.name, role: decl.role };
  }

  /** Resolves `r.current` for a ref `r`. Undefined if `node` is not on a ref (the caller carries on), "error" after reporting. */
  protected refAccess(node: PropertyAccessExpression): RefId | "error" | undefined {
    const object = unwrapParens(node.expression);
    const binding = isIdentifier(object) ? this.scope.get(object.text) : undefined;
    if (binding?.kind !== "ref") return undefined;
    if (node.name.text !== "current") {
      this.report(DiagnosticCode.UnsupportedExpression, `Refs only have \`.current\`, not '${node.name.text}'.`, node.name);
      return "error";
    }
    return binding.id;
  }

  /** The primitive type of a name, if it is a parameter or state slot whose type is known to be primitive. */
  protected knownPrimitive(node: Expression): ValueType | null {
    const target = unwrapParens(node);
    const binding = isIdentifier(target) ? this.scope.get(target.text) : undefined;
    let type: TypeIR | undefined;
    if (binding?.kind === "param") type = binding.type;
    else if (binding?.kind === "state") type = this.stateTypes.get(binding.id);
    return type?.kind === "Primitive" && type.name !== "void" ? type.name : null;
  }

  /** The handler parameter of a runtime handle type (`input`) that `node` names, or null (no diagnostic). */
  protected handleParam(node: Expression): { type: string; read: ParamReadIR } | null {
    const target = unwrapParens(node);
    const binding = isIdentifier(target) ? this.scope.get(target.text) : undefined;
    if (binding?.kind !== "param" || binding.type.kind !== "Named") return null;
    return { type: binding.type.name, read: { kind: "ParamRead", param: binding.id, name: binding.name } };
  }

  /** A hook, built-in element or runtime function must be imported from the authoring module before it is used. */
  protected requireImport(name: string, at: Node): void {
    if (this.authoring.names.has(name) || this.authoring.reported.has(name)) return;
    this.authoring.reported.add(name);
    this.report(DiagnosticCode.MissingImport, `'${name}' is not imported: add \`import { ${name} } from "${this.manifest.authoringModule}"\`.`, at);
  }

  protected claimName(name: string, at: Node, code: CompilerDiagnostic["code"] = DiagnosticCode.InvalidUseState): boolean {
    if (this.usedNames.has(name)) {
      this.report(code, `'${name}' is already declared or is reserved by the runtime.`, at);
      return false;
    }
    this.usedNames.add(name);
    return true;
  }

  /** A free field name for an element; with a suffix (a list's `enemyItems`), the suffixed name is claimed too. */
  protected allocateFieldName(tag: string, suffix: string | null = null): string {
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    const taken = (name: string): boolean => this.usedNames.has(name) || (suffix !== null && this.usedNames.has(name + suffix));
    let candidate = base;
    for (let n = 2; taken(candidate); n++) candidate = `${base}${n}`;
    this.usedNames.add(candidate);
    if (suffix !== null) this.usedNames.add(candidate + suffix);
    return candidate;
  }

  stateType(state: StateId): TypeIR {
    const type = this.stateTypes.get(state);
    if (!type) throw new Error(`Unknown state ${state}`);
    return type;
  }

  isCallableName(name: string): boolean {
    return name === "Math" || this.manifest.functions[name] !== undefined;
  }

  canSetState(): boolean {
    return this.settersForbidden === 0;
  }

  canPlaySound(): boolean {
    return this.updaterDepth === 0;
  }

  inUpdater<T>(lower: () => T): T {
    this.updaterDepth++;
    try {
      return lower();
    } finally {
      this.updaterDepth--;
    }
  }

  nextSerial(): number {
    return ++this.serial;
  }

  error(code: CompilerDiagnostic["code"], message: string, node: Node): void {
    this.report(code, message, node);
  }

  protected span(node: Node): SourceSpan {
    return spanOf(node, this.sourceFile, this.fileName);
  }

  protected report(code: CompilerDiagnostic["code"], message: string, node: Node): void {
    this.errorCount++;
    this.diagnostics.push(error(code, message, this.span(node)));
  }
}
