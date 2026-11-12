// Layer 2 of ComponentLowering: props declarations, hooks (useState, useRef, useSound, useGameState, handlers) and state types.
import { SyntaxKind, type Node } from "typescript/ast";
import { isArrowFunction, isBlock, isIdentifier, isTypeReferenceNode, isFunctionTypeNode, isTypeLiteralNode, isInterfaceDeclaration, isStringLiteral, isNoSubstitutionTemplateLiteral } from "typescript/ast/is";
import { unwrapParens, visit, type TypeDeclarationAnalysis, type UseRefCallAnalysis, type UseSoundCallAnalysis, type UseStoreCallAnalysis } from "../analyzer/analyzer.ts";
import { DiagnosticCode, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { type StateId, type TypeIR, collectDependencies, stateReads, childExpressions, refId, soundId, stateId, type PropDeclIR, type PropTypeIR, type ExprIR, type HookIR, type StateIR } from "../ir/types.ts";
import { type GameStateEntry } from "../gamestate/schema.ts";
import { HANDLER_SIGNATURES } from "../ir/handlers.ts";
import { lowerFunction } from "./statements.ts";
import { HANDLER_KIND, RESERVED_PROP_NAMES, unwrapTypeParens, nearest, propTypeToType } from "./helpers.ts";
import { ExpressionLowering } from "./expressions.ts";

export class HookLowering extends ExpressionLowering {
  /**
   * Resolve the props parameter against the props type declared in this file,
   * declare each destructured prop in scope, and describe every member of the
   * type (destructured or not) for the prefab registry.
   */
  protected lowerPropDecls(): PropDeclIR[] {
    const analysis = this.component.props;
    if (!analysis) return [];
    const code = DiagnosticCode.InvalidProps;
    const decl = this.typeDecls.get(analysis.typeName);
    if (!decl) {
      this.report(code, `Props type '${analysis.typeName}' is not declared in this file (declare an \`interface ${analysis.typeName} { … }\`).`, analysis.typeNode);
      return [];
    }
    const members = this.propMembers(decl);
    if (!members) return [];

    const bindings = new Map(analysis.bindings.map((b) => [b.name, b] as const));
    if (analysis.objectName !== null) this.componentScope.declare(analysis.objectName, { kind: "propsObject", name: analysis.objectName });
    for (const binding of analysis.bindings) {
      if (!members.has(binding.name)) {
        this.report(code, `'${binding.name}' is not a prop of ${analysis.typeName}.`, binding.node);
      }
    }

    const out: PropDeclIR[] = [];
    for (const [name, member] of members) {
      if (name === "children") {
        // Not a value prop: the elements a parent passes mount at `{children}`. Typed `Child` so the TSX type-checks.
        const binding = bindings.get(name);
        if (member.role !== "value" || member.type.kind !== "SourceText" || member.type.text !== "Child") {
          this.report(code, `\`children\` must be typed \`Child\`: \`children: Child;\`, with \`import { type Child } from "${this.manifest.authoringModule}"\`.`, member.node);
        } else if (binding?.defaultValue) {
          this.report(code, "`children` cannot have a default value.", binding.node);
        } else {
          this.declaredChildren = true;
          if (binding) this.componentScope.declare(name, { kind: "children", name });
        }
        continue;
      }
      if (RESERVED_PROP_NAMES.has(name)) {
        this.report(code, `'${name}' is reserved by the framework and cannot be a prop name.`, member.node);
        continue;
      }
      const binding = bindings.get(name);
      let defaultValue: ExprIR | null = null;
      if (binding?.defaultValue) {
        if (member.role === "callback") {
          this.report(code, `Callback prop '${name}' cannot have a default value; call it with \`${name}?.()\` instead.`, binding.node);
        } else {
          defaultValue = this.lowerNode(binding.defaultValue);
          if (defaultValue && collectDependencies(defaultValue).length > 0) {
            this.report(code, `The default for '${name}' must be a constant: it cannot read state or other props.`, binding.defaultValue);
            defaultValue = null;
          }
        }
      }
      out.push({ kind: "PropDecl", name, optional: member.optional || binding?.defaultValue != null, defaultValue, role: member.role, type: member.type });
      if (binding) {
        if (this.componentScope.hasOwn(name)) {
          this.report(code, `'${name}' is already declared in this component.`, binding.node);
        } else {
          this.componentScope.declare(name, { kind: "prop", name, role: member.role });
        }
      }
    }
    return out;
  }

  /** The members of a props type: an `interface` or a `type` alias of an object type, with plain named members. */
  protected propMembers(decl: TypeDeclarationAnalysis): Map<string, { optional: boolean; role: "value" | "callback"; type: PropTypeIR; node: Node }> | null {
    const code = DiagnosticCode.InvalidProps;
    const node = decl.node;
    let elements: readonly Node[];
    if (isInterfaceDeclaration(node)) {
      if (node.heritageClauses && node.heritageClauses.length > 0) {
        this.report(code, `Props type '${decl.name}' cannot extend another type: list the props in one interface.`, node);
        return null;
      }
      elements = node.members;
    } else if (isTypeLiteralNode(node.type)) {
      elements = node.type.members;
    } else {
      this.report(code, `Props type '${decl.name}' must be an object type: \`type ${decl.name} = { … }\`.`, node);
      return null;
    }
    const out = new Map<string, { optional: boolean; role: "value" | "callback"; type: PropTypeIR; node: Node }>();
    for (const element of elements) {
      const member = element as unknown as { kind: SyntaxKind; name?: Node; type?: Node; postfixToken?: Node };
      const isProperty = member.kind === SyntaxKind.PropertySignature;
      const isMethod = member.kind === SyntaxKind.MethodSignature;
      if ((!isProperty && !isMethod) || !member.name || !isIdentifier(member.name)) {
        this.report(code, `Props type '${decl.name}': members must be plain \`name: type\` or \`name(): void\`.`, element);
        continue;
      }
      const optional = member.postfixToken?.kind === SyntaxKind.QuestionToken;
      const typeNode = member.type ? unwrapTypeParens(member.type) : null;
      const role = isMethod || (typeNode !== null && isFunctionTypeNode(typeNode)) ? "callback" : "value";
      const type: PropTypeIR = role === "callback" ? { kind: "Function" } : this.propType(typeNode);
      out.set(member.name.text, { optional, role, type, node: element });
    }
    return out;
  }

  protected lowerHooks(): { hooks: HookIR[]; state: StateIR[] } {
    const hooks: HookIR[] = [];
    const state: StateIR[] = [];
    for (const hook of this.component.hooks) {
      if (hook.kind !== "const" && hook.kind !== "useStore") this.requireImport(hook.kind, hook.call);
      switch (hook.kind) {
        case "useStore":
          this.lowerStore(hook, state, hooks);
          break;
        case "useUpdate":
        case "useInput":
        case "useMount":
        case "useUnmount": {
          const kind = HANDLER_KIND[hook.kind];
          const signature = HANDLER_SIGNATURES[kind];
          // In `useUnmount` the component is going away: it can no longer render, so there is nothing for a setter to do.
          const handler = this.within({ inHandler: true, inUnmount: hook.kind === "useUnmount" }, () =>
            lowerFunction(this, hook.handler, { paramTypes: signature.params.map((p) => p.type), returns: "void", what: `${hook.kind} handler` }),
          );
          if (handler) hooks.push({ kind, handler, span: this.span(hook.statement) });
          break;
        }
        case "useRef":
          this.lowerUseRef(hook);
          break;
        case "useSound":
          this.lowerUseSound(hook);
          break;
        case "const": {
          // Lowered now, against what is declared above it (state, refs, earlier consts), outside any handler.
          const lowered = this.lowerNode(hook.initializer);
          if (!lowered) break;
          const value = memoized(hook.name, lowered);
          if (hook.pattern === null) {
            if (this.componentScope.hasOwn(hook.name) || this.isCallableName(hook.name)) {
              this.report(DiagnosticCode.InvalidComponentBody, `'${hook.name}' is already declared in this component (or reserved).`, hook.declaration.name);
              break;
            }
            this.componentScope.declare(hook.name, { kind: "derived", name: hook.name, value });
            break;
          }
          // `const { x, y } = heroOf(run)`: each name is a member of the one value, which is worked out once (a memo) when it calls something.
          const entries = hook.pattern.kind === "object"
            ? hook.pattern.entries.map((e) => ({ name: e.name, node: e.node, read: { kind: "MemberRead", object: value, name: e.key, optional: false } as ExprIR }))
            : hook.pattern.entries.flatMap((e, i) => (e === null ? [] : [{ name: e.name, node: e.node, read: { kind: "IndexRead", object: value, index: { kind: "NumberLiteral", value: i }, optional: false } as ExprIR }]));
          for (const entry of entries) {
            if (this.componentScope.hasOwn(entry.name) || this.isCallableName(entry.name)) {
              this.report(DiagnosticCode.InvalidComponentBody, `'${entry.name}' is already declared in this component (or reserved).`, entry.node);
              continue;
            }
            this.componentScope.declare(entry.name, { kind: "derived", name: entry.name, value: entry.read });
          }
          break;
        }
        case "useState": {
          const taken = [hook.valueName, hook.setterName].find((n) => n !== null && this.componentScope.hasOwn(n));
          if (taken) {
            this.report(DiagnosticCode.InvalidUseState, `'${taken}' is already declared in this component.`, hook.declaration);
            continue;
          }
          if (!this.claimName(hook.valueName, hook.declaration)) continue;
          if (hook.setterName !== null && !this.claimName(hook.setterName, hook.declaration)) continue;
          const id = stateId(this.component.name, hook.valueName);
          if (!hook.initializer) {
            this.report(DiagnosticCode.InvalidUseState, "useState requires an initial value.", hook.call);
            continue;
          }
          // Initial values are evaluated before any state exists: lower with the scope as it is so far,
          // then reject any state reads. `useState(() => make())` is React's lazy initializer: the generated field is evaluated
          // once per instance anyway, so the arrow's body is the initial value (a per-instance object, such as an effect).
          const lazy = unwrapParens(hook.initializer);
          let initializer = hook.initializer;
          if (isArrowFunction(lazy)) {
            if (lazy.parameters.length > 0 || isBlock(lazy.body)) {
              this.report(DiagnosticCode.InvalidUseState, "A lazy initial value is an arrow with no parameters returning the value: `useState(() => createSquash())`.", lazy);
              continue;
            }
            initializer = lazy.body as typeof initializer;
          }
          const initialValue = this.lowerNode(initializer);
          if (!initialValue) continue;
          // It may read props and the game state (`useState(start)` with `const start = useGame((s) => s.titleCursor)`): both are
          // there when the component is made, which is when the initial value is taken, as in a React first render. Not this
          // component's own state, which is being made alongside it.
          const ownReads = stateReads(initialValue).filter((read) => state.find((s) => s.id === read)?.globalKey === undefined);
          if (ownReads.length > 0) {
            this.report(DiagnosticCode.NonConstantInitialState, "useState initial value must not read other state of this component (it may read props and the game state).", hook.initializer);
            continue;
          }
          const type = this.hookStateType(hook.typeArgument, initialValue, hook.call);
          if (!type) continue;
          if (type.kind === "SourceType" && initialValue.kind === "Call" && (initialValue.callee.kind === "Function" || initialValue.callee.kind === "Plain")) this.handleStates.add(id);
          state.push({ kind: "State", id, name: hook.valueName, type, initialValue });
          this.stateTypes.set(id, type);
          hooks.push({ kind: "UseState", state: id, setterName: hook.setterName, span: this.span(hook.declaration) });
          this.componentScope.declare(hook.valueName, { kind: "state", id });
          if (hook.setterName !== null) this.componentScope.declare(hook.setterName, { kind: "setter", state: id, name: hook.setterName });
          break;
        }
      }
    }
    return { hooks, state };
  }

  /**
   * `const hp = useGame((s) => s.player.hp)`: a state mirroring one leaf of the game state (a snapshot, refreshed
   * when the leaf changes), or `const collect = useGame((s) => s.collect)`: an action, called as a statement in a
   * handler. The path is checked against the state tree `GameState.ts` declares.
   *
   * A computed selector (`useGame((s) => s.cursor === id)`) is a derived value: each path it reads becomes a snapshot of
   * its own (shared with any other read of the same path in this component), and the expression reads those, so it is
   * worked out again whenever one of them changes, as a React selector is.
   */
  protected lowerStore(hook: UseStoreCallAnalysis, state: StateIR[], hooks: HookIR[]): void {
    const definition = this.gameState;
    if (!definition || !this.storeImports.has(hook.storeName)) return; // already reported where the import was checked
    if (hook.body !== null) {
      if (this.componentScope.hasOwn(hook.valueName) || this.isCallableName(hook.valueName)) {
        this.report(DiagnosticCode.InvalidUseState, `'${hook.valueName}' is already declared in this component (or reserved).`, hook.declaration);
        return;
      }
      const body = hook.body;
      const value = this.inScope((scope) => {
        scope.declare(hook.parameter, { kind: "storeRoot", name: hook.parameter });
        return this.within({ storeReads: { state, hooks, storeName: hook.storeName } }, () => this.lowerNode(body));
      });
      if (value) this.componentScope.declare(hook.valueName, { kind: "derived", name: hook.valueName, value: memoized(hook.valueName, value) });
      return;
    }
    if (this.componentScope.hasOwn(hook.valueName)) {
      this.report(DiagnosticCode.InvalidUseState, `'${hook.valueName}' is already declared in this component.`, hook.declaration);
      return;
    }
    const first = hook.path[0] as string;
    if (hook.path.length === 1 && definition.actions.includes(first)) {
      if (!this.claimName(hook.valueName, hook.declaration)) return;
      this.componentScope.declare(hook.valueName, { kind: "action", name: hook.valueName, action: first });
      return;
    }
    // A value read from the game state is kept in a field of the component. When its name is a member the runtime already has
    // (`const name = useGame((s) => s.speaker)` in an `<Entity>` root, whose `name` is the entity's), the field is `$name`: the
    // author's name stays as written, and `$` names are the compiler's alone.
    let field = hook.valueName;
    if (this.usedNames.has(field)) {
      if (!this.isRuntimeMember(field)) {
        this.report(DiagnosticCode.InvalidUseState, `'${hook.valueName}' is already declared or is reserved by the runtime.`, hook.declaration);
        return;
      }
      field = `$${field}`;
    }
    const id = this.storePathState(hook.path, field, hook.selector, state, hooks);
    if (id) this.componentScope.declare(hook.valueName, { kind: "state", id });
  }

  /**
   * The snapshot of one path of the game state, named `name` (claimed here), after checking the path against the schema.
   * Null when the path is wrong (reported).
   */
  protected storePathState(path: readonly string[], name: string, at: Node, state: StateIR[], hooks: HookIR[]): StateId | null {
    const definition = this.gameState!;
    // Walk the state tree; a typo is reported with the nearest key at the level it went wrong. Below a value the compiler
    // cannot see into (an array, `newRun()`), the path is left to the type-check of the generated code.
    let node: GameStateEntry = definition.tree;
    const walked: string[] = [];
    for (const key of path) {
      if (node.kind === "value") break;
      if (node.kind === "leaf") {
        this.report(DiagnosticCode.InvalidGameState, `'${walked.join(".")}' is a ${node.type}, so it has no '${key}'.`, at);
        return null;
      }
      const child: GameStateEntry | undefined = Object.hasOwn(node.children, key) ? node.children[key] : undefined;
      if (!child) {
        const options = [...Object.keys(node.children), ...(walked.length === 0 ? definition.actions : [])];
        const near = nearest(key, options);
        this.report(
          DiagnosticCode.InvalidGameState,
          `'${[...walked, key].join(".")}' is not in the game state${near ? ` (did you mean "${[...walked, near].join(".")}"?)` : ""}. ${walked.length === 0 ? "State" : `'${walked.join(".")}' has`}: ${options.length > 0 ? options.join(", ") : "nothing"}.`,
          at,
        );
        return null;
      }
      walked.push(key);
      node = child;
    }
    if (!this.claimName(name, at)) return null;
    const id = stateId(this.component.name, name);
    // A leaf the schema knows keeps its primitive type; an object, an array or a computed value is typed by TypeScript, from
    // the store itself: it re-renders when any value under it changes.
    const leaf = node.kind === "leaf" && walked.length === path.length ? node : null;
    const initialValue: ExprIR = leaf === null ? { kind: "NullLiteral" } : leaf.type === "number" ? { kind: "NumberLiteral", value: leaf.initial as number } : leaf.type === "string" ? { kind: "StringLiteral", value: leaf.initial as string } : { kind: "BooleanLiteral", value: leaf.initial as boolean };
    const type: TypeIR = leaf === null ? { kind: "SourceType", text: `ReturnType<typeof ${definition.name}.getState>${path.map((k) => `[${JSON.stringify(k)}]`).join("")}` } : { kind: "Primitive", name: leaf.type };
    const globalKey = path.join(".");
    state.push({ kind: "State", id, name, type, initialValue, globalKey });
    this.stateTypes.set(id, type);
    hooks.push({ kind: "UseState", state: id, setterName: null, span: this.span(at) });
    if (!this.storePaths.has(globalKey)) this.storePaths.set(globalKey, id);
    return id;
  }

  /**
   * `s.battle.gold` inside a computed selector: the snapshot of that path (made the first time this component reads it).
   * A trailing `.length` reads the array's snapshot, since the store tells readers about an array's items, not its length.
   */
  protected override lowerStoreRead(path: readonly string[], at: Node): ExprIR | null {
    const reads = this.mode.storeReads;
    if (!reads || path.length === 0) {
      this.report(DiagnosticCode.UnsupportedExpression, "Read a path of the game state (`s.player.hp`), not the whole state.", at);
      return null;
    }
    if (path.length > 1 && path[path.length - 1] === "length") {
      const array = this.lowerStoreRead(path.slice(0, -1), at);
      return array && { kind: "MemberRead", object: array, name: "length", optional: false };
    }
    if (path.length === 1 && this.gameState!.actions.includes(path[0]!)) {
      this.report(DiagnosticCode.UnsupportedExpression, `'${path[0]}' is an action: select it by itself (\`const ${path[0]} = ${reads.storeName}((s) => s.${path[0]})\`) and call it in a handler.`, at);
      return null;
    }
    const key = path.join(".");
    let id = this.storePaths.get(key);
    if (!id) {
      const base = "$" + path.map((k, i) => (i === 0 ? k : k.charAt(0).toUpperCase() + k.slice(1))).join("");
      let name = base;
      for (let n = 2; this.usedNames.has(name); n++) name = `${base}${n}`;
      id = this.storePathState(path, name, at, reads.state, reads.hooks) ?? undefined;
      if (!id) return null;
    }
    return { kind: "StateRead", state: id };
  }
  /**
   * `const cooldown = useRef(0)` / `useRef<number>(0)`: a value that persists
   * but never renders. The initial value is evaluated once and must not read state.
   */
  protected lowerUseRef(hook: UseRefCallAnalysis): void {
    const code = DiagnosticCode.InvalidUseRef;
    if (hook.arguments.length !== 1) {
      this.report(code, "useRef takes one initial value: `const timer = useRef(0)`. Refs hold values; they do not point at elements.", hook.call);
      return;
    }
    if (!this.checkHandleName(hook.name, code, hook.declaration.name)) return;
    const initialValue = this.lowerNode(hook.arguments[0]!);
    if (!initialValue) return;
    if (stateReads(initialValue).length > 0) {
      this.report(code, "useRef's initial value must not read state; it is evaluated once (it may read props).", hook.arguments[0]!);
      return;
    }
    const type = this.refType(hook.typeArgument, initialValue, hook.call);
    if (!type || !this.claimName(hook.name, hook.declaration, code)) return;
    const id = refId(this.component.name, hook.name);
    this.refs.push({ kind: "Ref", id, name: hook.name, type, initialValue, span: this.span(hook.declaration) });
    this.componentScope.declare(hook.name, { kind: "ref", id, name: hook.name });
  }

  /**
   * `const playHit = useSound("hit.wav")`: the path is a string literal, so a
   * missing asset can be reported at build time once there is an asset list.
   * The binding is a function that is only called, as a statement in a handler.
   */
  protected lowerUseSound(hook: UseSoundCallAnalysis): void {
    const code = DiagnosticCode.InvalidUseSound;
    const argument = hook.arguments.length === 1 ? unwrapParens(hook.arguments[0]!) : null;
    if (!argument || !(isStringLiteral(argument) || isNoSubstitutionTemplateLiteral(argument))) {
      this.report(code, "useSound takes one file path, written as a string literal: `const playHit = useSound(\"hit.wav\")`.", hook.call);
      return;
    }
    if (!this.checkHandleName(hook.name, code, hook.declaration.name)) return;
    if (!this.claimName(hook.name, hook.declaration, code)) return;
    const id = soundId(this.component.name, hook.name);
    this.sounds.push({ kind: "Sound", id, name: hook.name, path: argument.text, span: this.span(hook.declaration) });
    this.componentScope.declare(hook.name, { kind: "sound", id, name: hook.name });
  }

  /** A `useRef` binding must not collide with state, setters or the reserved call names. */
  protected checkHandleName(name: string, code: CompilerDiagnostic["code"], at: Node): boolean {
    if (this.componentScope.has(name) || this.isCallableName(name)) {
      this.report(code, `'${name}' is already declared in this component (or reserved).`, at);
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
  protected hookStateType(typeArgument: Node | null, initial: ExprIR, at: Node): TypeIR | null {
    if (typeArgument) return this.typeFromNode(typeArgument);
    const primitive = this.inferType(initial);
    if (primitive) return { kind: "Primitive", name: primitive };
    if (initial.kind === "PropRead") {
      const decl = this.propDecls.find((p) => p.name === initial.name);
      if (decl?.role === "value") return propTypeToType(decl.type);
    }
    // A value of the game state (`useState(battle)`): its type, as the store gives it.
    if (initial.kind === "StateRead") {
      const type = this.stateTypes.get(initial.state);
      if (type) return type;
    }
    // Made by a function (a runtime factory, or one from a .ts file): typed by what the function returns.
    if (initial.kind === "Call" && (initial.callee.kind === "Function" || initial.callee.kind === "Plain") && !initial.callee.name.startsWith("Math.")) {
      return { kind: "SourceType", text: `ReturnType<typeof ${initial.callee.name}>` };
    }
    const code = DiagnosticCode.UnsupportedStateType;
    if (initial.kind === "ArrayLiteral" || initial.kind === "ObjectLiteral") {
      this.report(code, `An ${initial.kind === "ArrayLiteral" ? "array" : "object"} state needs its type: \`useState<${initial.kind === "ArrayLiteral" ? "EnemyData[]" : "EnemyData"}>(…)\`, with the type declared in this file.`, at);
    } else {
      this.report(code, "Cannot infer the type; use a number/string/boolean literal, a prop, or `useState<T>(...)`.", at);
    }
    return null;
  }

  /**
   * The type of a `useRef` value: its type argument (any type: `useRef<Point[]>([])`, `useRef<Enemy | null>(null)`), or inferred
   * from a primitive initial value. A type that names an element (`useRef<Sprite>(null)`) is rejected: refs hold values, and
   * what is on screen is driven by state and props.
   */
  protected refType(typeArgument: Node | null, initial: ExprIR, at: Node): TypeIR | null {
    const code = DiagnosticCode.InvalidUseRef;
    if (typeArgument) {
      let element: string | null = null;
      visit(typeArgument, (n) => {
        if (element === null && isTypeReferenceNode(n) && isIdentifier(n.typeName) && (this.intrinsics.has(n.typeName.text) || this.locals.has(n.typeName.text) || this.imported.has(n.typeName.text))) element = n.typeName.text;
      });
      if (element !== null) {
        this.report(code, `Refs hold values, not elements: <${element}> is driven by state and props. Keep what you need from it (a position, a count) in a ref or in state.`, typeArgument);
        return null;
      }
      return this.typeFromNode(typeArgument);
    }
    const inferred = this.inferType(initial);
    if (inferred) return { kind: "Primitive", name: inferred };
    this.report(code, "Cannot infer the type: use a number/string/boolean literal, or give it: `useRef<Point[]>([])`, `useRef<Enemy | null>(null)`.", at);
    return null;
  }
}

/**
 * A derived value that calls a function or a method (`heroOf(run)`, `enemies.filter(…)`, `name.toUpperCase()`) is a memo: worked out
 * once, and again only when what it reads changes, rather than at each place it is used. One that only reads and combines values
 * (`health < 25`, `hero.x`) is written where it is used, which costs nothing.
 */
function memoized(key: string, value: ExprIR): ExprIR {
  if (value.kind === "Memo") return value;
  // A call inside another memo (`const cost = focus.upgrade`, `focus` being one) is already worked out once: reading it costs nothing.
  const calls = (e: ExprIR): boolean =>
    e.kind !== "Memo" && ((e.kind === "Call" && (e.callee.kind === "Plain" || e.callee.kind === "ArrayMethod" || e.callee.kind === "ValueMethod")) || childExpressions(e).some(calls));
  return calls(value) ? { kind: "Memo", key, value } : value;
}
