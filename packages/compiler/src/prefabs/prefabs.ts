/**
 * Prefabs: an exported component, described as data. The schema is built from
 * the IR (`PropDeclIR`, `PropTypeIR`), so editors, scene validation and the
 * runtime registry need no TypeScript checker.
 */
import type { ComponentIR, ExprIR, IRModule, PropTypeIR } from "../ir/types.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface PrefabPropSchema {
  readonly name: string;
  readonly type: PropTypeIR;
  /** A `?` in the props type, or a default. */
  readonly optional: boolean;
  /** False for a type data cannot express (the prop is code-only): scenes may not set it. */
  readonly settable: boolean;
  /** The default, when it is a constant the compiler can evaluate. */
  readonly default?: JsonValue;
}

export interface PrefabSchema {
  readonly name: string;
  /** The source file that declares it. */
  readonly module: string;
  /** Value props only: callbacks cannot come from data. */
  readonly props: readonly PrefabPropSchema[];
}

/** The components of a module a scene can place: the exported ones. */
export function exportedComponents(module: IRModule): readonly ComponentIR[] {
  return module.components.filter((c) => c.isExported);
}

export function prefabSchema(component: ComponentIR, module: string): PrefabSchema {
  const props: PrefabPropSchema[] = [];
  for (const p of component.props) {
    if (p.role === "callback") continue;
    const constant = p.defaultValue ? constantValue(p.defaultValue) : null;
    props.push({
      name: p.name,
      type: p.type,
      optional: p.optional,
      settable: p.type.kind !== "SourceText",
      ...(constant ? { default: constant.value } : {}),
    });
  }
  return { name: component.name, module, props };
}

export function moduleSchemas(module: IRModule): PrefabSchema[] {
  return exportedComponents(module).map((c) => prefabSchema(c, module.sourceFile));
}

/**
 * The value of a constant expression (literals and operators over them), as
 * JSON; null when it is not one. A default must be constant, so this covers
 * every default the compiler accepts, except ones using functions.
 */
export function constantValue(expr: ExprIR): { readonly value: JsonValue } | null {
  const none = Symbol("not constant");
  const evaluate = (e: ExprIR): JsonValue | typeof none => {
    switch (e.kind) {
      case "NumberLiteral":
        return e.value;
      case "StringLiteral":
        return e.value;
      case "BooleanLiteral":
        return e.value;
      case "NullLiteral":
        return null;
      case "ArrayLiteral": {
        const out: JsonValue[] = [];
        for (const element of e.elements) {
          const value = evaluate(element.value);
          if (value === none) return none;
          if (element.spread) {
            if (!Array.isArray(value)) return none;
            out.push(...value);
          } else out.push(value);
        }
        return out;
      }
      case "ObjectLiteral": {
        const out: { [key: string]: JsonValue } = {};
        for (const property of e.properties) {
          const value = evaluate(property.value);
          if (value === none) return none;
          if (property.kind === "Spread") {
            if (value === null || typeof value !== "object" || Array.isArray(value)) return none;
            Object.assign(out, value);
          } else out[property.name] = value;
        }
        return out;
      }
      case "TemplateLiteral": {
        let text = e.quasis[0]!;
        for (const [i, part] of e.expressions.entries()) {
          const value = evaluate(part);
          if (value === none || (value !== null && typeof value === "object")) return none;
          text += String(value) + e.quasis[i + 1]!;
        }
        return text;
      }
      case "Unary": {
        const v = evaluate(e.operand);
        if (v === none) return none;
        if (e.operator === "!") return !v;
        if (e.operator === "typeof") return none;
        return typeof v === "number" ? (e.operator === "-" ? -v : v) : none;
      }
      case "Binary": {
        const l = evaluate(e.left);
        const r = evaluate(e.right);
        if (l === none || r === none) return none;
        const compare = (a: JsonValue, b: JsonValue): boolean => JSON.stringify(a) === JSON.stringify(b);
        switch (e.operator) {
          case "===":
          case "==":
            return compare(l, r);
          case "!==":
          case "!=":
            return !compare(l, r);
          case "&&":
            return l ? r : l;
          case "||":
            return l ? l : r;
          case "??":
            return l ?? r;
        }
        if (typeof l === "number" && typeof r === "number") {
          switch (e.operator) {
            case "+":
              return l + r;
            case "-":
              return l - r;
            case "*":
              return l * r;
            case "/":
              return l / r;
            case "%":
              return l % r;
            case "<":
              return l < r;
            case "<=":
              return l <= r;
            case ">":
              return l > r;
            case ">=":
              return l >= r;
          }
        }
        return e.operator === "+" && typeof l === "string" && typeof r === "string" ? l + r : none;
      }
      case "Conditional": {
        const test = evaluate(e.test);
        return test === none ? none : evaluate(test ? e.whenTrue : e.whenFalse);
      }
      default:
        return none; // state, locals, props, refs, calls: not constant
    }
  };
  const value = evaluate(expr);
  // `NaN` and `Infinity` are not JSON.
  if (value === none || (typeof value === "number" && !Number.isFinite(value))) return null;
  return { value };
}
