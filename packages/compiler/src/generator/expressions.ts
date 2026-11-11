// Base of the component generator: the fields, the expression and field-reference emitters. Layer 0 of ComponentGenerator (see generator.ts).
import { assertNever, type ComponentIR, type ExprIR, type FunctionIR, type RefId, type SoundId, type StateId, type StateIR, type LocalId } from "../ir/types.ts";
import { CodeWriter } from "./writer.ts";
import { param, escapeTemplate, propertyKey } from "./helpers.ts";

export class ExpressionEmitter {
  protected readonly c: ComponentIR;
  protected readonly requiredHostProps: Readonly<Record<string, readonly string[]>>;
  protected readonly intrinsicHooks: Readonly<Record<string, readonly string[]>>;
  protected w: CodeWriter;
  protected readonly stateById: ReadonlyMap<StateId, StateIR>;
  /**
   * While emitting a keyed list: inside a callback prop, a read of the list's
   * item is its current value, looked up by the item's key (`text`), because
   * the callback was created with the item's first value.
   */
  protected itemLookup: { readonly id: LocalId; readonly text: string } | null = null;
  /** Greater than zero while emitting a callback prop's body. */
  protected callbackDepth = 0;
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
      case "ElementRead": return `this.${e.field}.${e.member}`;
      case "NumberLiteral": return String(e.value);
      case "StringLiteral": return JSON.stringify(e.value);
      case "BooleanLiteral": return String(e.value);
      case "NullLiteral": return "null";
      case "StateRead": return `this.${this.state(e.state).name}`;
      case "LocalRead": return e.name;
      case "ParamRead":
        return this.itemLookup !== null && this.callbackDepth > 0 && e.param === this.itemLookup.id ? this.itemLookup.text : e.name;
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
      default: return assertNever(e, "expression");
    }
  }
}
