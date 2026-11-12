// Base of the component generator: the fields, the expression and field-reference emitters. Layer 0 of ComponentGenerator (see generator.ts).
import { assertNever, type ComponentIR, type ExprIR, type FunctionIR, type RefId, type SoundId, type StateId, type StateIR, type LocalId } from "../ir/types.ts";
import { collectDependencies } from "../ir/walk.ts";
import { CodeWriter } from "./writer.ts";
import { param, escapeTemplate, propertyKey } from "./helpers.ts";

/** How some IR is written where the emitter is. Each field is set for a stretch of emitting with `within`. */
export interface EmitMode {
  /**
   * While emitting a keyed list: inside a callback prop, a read of the list's item is its current value, looked up by the
   * item's key (`text`), because the callback was created with the item's first value.
   */
  readonly itemLookup: { readonly id: LocalId; readonly text: string } | null;
  /** Emitting a callback prop's body. */
  readonly inCallback: boolean;
  /** Writing `super(…)`'s arguments, where `this` cannot be used: a memo is worked out in place (it reads nothing that changes there). */
  readonly inlineMemos: boolean;
  /** Where element fields live: on the component (`this.sprite`), or, while a list item's children are written, in its record. */
  readonly fieldBase: string;
}

export class ExpressionEmitter {
  protected readonly c: ComponentIR;
  protected readonly requiredHostProps: Readonly<Record<string, readonly string[]>>;
  protected readonly intrinsicHooks: Readonly<Record<string, readonly string[]>>;
  protected w: CodeWriter;
  protected readonly stateById: ReadonlyMap<StateId, StateIR>;
  /** Where the emitter is now, and so how some IR is written. Changed only through `within`. */
  protected mode: EmitMode = { itemLookup: null, inCallback: false, inlineMemos: false, fieldBase: "this" };
  /** How many temporaries the `render()` being written has used (see `emitReportedWrites`). */
  protected renderTemps = 0;
  /** The imported game state (`useGame`), when the module uses one. */
  protected readonly storeName: string;

  constructor(
    component: ComponentIR,
    writer: CodeWriter,
    requiredHostProps: Readonly<Record<string, readonly string[]>>,
    intrinsicHooks: Readonly<Record<string, readonly string[]>>,
    storeName: string,
  ) {
    this.storeName = storeName;
    this.requiredHostProps = requiredHostProps;
    this.intrinsicHooks = intrinsicHooks;
    this.c = component;
    this.w = writer;
    this.stateById = new Map(component.state.map((s) => [s.id, s]));
  }

  /** Emit something in a changed mode; the mode before is back afterwards, whatever happens. */
  protected within<T>(patch: Partial<EmitMode>, emit: () => T): T {
    const outer = this.mode;
    this.mode = { ...outer, ...patch };
    try {
      return emit();
    } finally {
      this.mode = outer;
    }
  }

  /** The lines `emit` writes, written to a writer of their own (relative to column 0) instead of the current one. */
  protected capture(emit: () => void): string[] {
    const outer = this.w;
    const inner = new CodeWriter();
    this.w = inner;
    try {
      emit();
    } finally {
      this.w = outer;
    }
    return inner.toString().trimEnd().split("\n");
  }

  /**
   * An arrow function with a block body, from the statements already written
   * (relative to column 0). One statement stays on one line. Several are laid
   * out under the line that will contain the arrow, unless a string in them
   * spans lines, where adding indentation would change its contents.
   */
  protected arrow(params: string, lines: readonly string[], fn: FunctionIR): string {
    if (lines.length === 1) return `(${params}) => { ${lines[0]} }`;
    const base = JSON.stringify(fn.body).includes("\\n") ? "" : this.w.indentation;
    return `(${params}) => {\n${lines.map((l) => `${base}  ${l}`).join("\n")}\n${base}}`;
  }

  /** A sound's name is its field. */
  protected soundField(id: SoundId): string {
    const sound = this.c.sounds.find((s) => s.id === id);
    if (!sound) throw new Error(`Unknown sound ${id} in component ${this.c.name}`);
    return sound.name;
  }

  /** A ref's name is its field. */
  protected refField(id: RefId): string {
    const ref = this.c.refs.find((r) => r.id === id);
    if (!ref) throw new Error(`Unknown ref ${id} in component ${this.c.name}`);
    return ref.name;
  }

  protected state(id: StateId): StateIR {
    const s = this.stateById.get(id);
    if (!s) throw new Error(`Unknown state ${id} in component ${this.c.name}`);
    return s;
  }

  /** The body of an expression-bodied arrow: an object literal needs parentheses, or it would read as a block. */
  protected arrowBody(e: ExprIR): string {
    const body = this.expr(e, true);
    return e.kind === "ObjectLiteral" ? `(${body})` : body;
  }

  /** Compound sub-expressions are always parenthesised, so operator precedence can never be wrong. */
  protected expr(e: ExprIR, top = false): string {
    const wrap = (s: string): string => (top ? s : `(${s})`);
    switch (e.kind) {
      case "PlainRef": return e.name;
      case "ActionRef": return `${this.storeName}.getState().${e.name}`;
      case "ElementRead": return `this.${e.field}.${e.member}`;
      case "NumberLiteral": return String(e.value);
      case "StringLiteral": return JSON.stringify(e.value);
      case "BooleanLiteral": return String(e.value);
      case "NullLiteral": return "null";
      case "StateRead": return `this.${this.state(e.state).name}`;
      case "LocalRead": return e.name;
      case "ParamRead":
        return this.mode.itemLookup !== null && this.mode.inCallback && e.param === this.mode.itemLookup.id ? this.mode.itemLookup.text : e.name;
      case "PropertyRead": return `${e.object.name}.${e.name}`;
      case "PropRead": {
        // A prop with a default is never undefined (the runtime applies the default at construction and on update),
        // but its declared type is optional; `!` says what the runtime guarantees.
        const guaranteed = this.c.props.find((p) => p.name === e.name)?.defaultValue != null;
        return `this.props.${e.name}${guaranteed ? "!" : ""}`;
      }
      case "RefRead": return `this.${this.refField(e.ref)}`;
      case "MemberRead": return `${this.expr(e.object)}${e.optional ? "?." : "."}${e.name}`;
      case "NonNull": return `${this.expr(e.expression)}!`;
      case "IndexRead": return `${this.expr(e.object)}${e.optional ? "?." : ""}[${this.expr(e.index, true)}]`;
      case "ArrayLiteral": return `[${e.elements.map((el) => `${el.spread ? "..." : ""}${this.expr(el.value, true)}`).join(", ")}]`;
      case "ObjectLiteral":
        if (e.properties.length === 0) return "{}";
        return `{ ${e.properties.map((p) => (p.kind === "Spread" ? `...${this.expr(p.value, true)}` : `${propertyKey(p.name)}: ${this.expr(p.value, true)}`)).join(", ")} }`;
      case "Arrow": return wrap(`(${e.params.map(param).join(", ")}) => ${this.arrowBody(e.body)}`);
      case "Call": {
        const args = e.args.map((a) => this.expr(a, true)).join(", ");
        switch (e.callee.kind) {
          case "Function": return `${e.callee.name}(${args})`;
          case "Plain": return `${e.callee.name}(${args})`;
          case "Method": return `${e.callee.receiver.name}.${e.callee.name}(${args})`;
          case "Prop": return `this.props.${e.callee.name}${e.callee.optional ? "?." : ""}(${args})`;
          case "ArrayMethod": return `${this.expr(e.callee.receiver)}.${e.callee.name}(${args})`;
          case "ValueMethod": return `${this.expr(e.callee.receiver)}.${e.callee.name}(${args})`;
          case "Action": return `${this.storeName}.getState().${e.callee.name}(${args})`;
          default: return assertNever(e.callee, "callee");
        }
      }
      case "TemplateLiteral":
        return "`" + e.quasis.map((q, i) => escapeTemplate(q) + (i < e.expressions.length ? `\${${this.expr(e.expressions[i]!, true)}}` : "")).join("") + "`";
      case "Unary": return wrap(`${e.operator}${this.expr(e.operand)}`);
      case "Binary": return wrap(`${this.expr(e.left)} ${e.operator} ${this.expr(e.right)}`);
      case "Conditional": return wrap(`${this.expr(e.test)} ? ${this.expr(e.whenTrue)} : ${this.expr(e.whenFalse)}`);
      case "Memo": {
        if (this.mode.inlineMemos) return this.expr(e.value, top);
        // Worked out again only when a state or prop it reads is a different value (`===`), as React's useMemo.
        const deps = collectDependencies(e.value).map((d) => (d.kind === "State" ? `this.${this.state(d.state).name}` : d.kind === "Prop" ? `this.props.${d.name}` : null));
        if (deps.includes(null)) throw new Error(`A memo of ${this.c.name} reads a list item`);
        return `this.$memo(${JSON.stringify(e.key)}, [${deps.join(", ")}], () => ${this.arrowBody(e.value)})`;
      }
      default: return assertNever(e, "expression");
    }
  }
}
