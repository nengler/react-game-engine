// Walking and querying the IR: children of an expression, dependencies and parameter reads.
import { type StateId, type LocalId } from "./ids.ts";
import { type FunctionIR } from "./values.ts";
import { type StatementIR } from "./statements.ts";
import { type DependencyIR } from "./elements.ts";
import { type ExprIR } from "./expressions.ts";



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function assertNever(value: never, what = "value"): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}

/** Direct sub-expressions of an expression, in evaluation order. */
export function childExpressions(e: ExprIR): readonly ExprIR[] {
  switch (e.kind) {
    case "StoreRef":
    case "NumberLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "StateRead":
    case "LocalRead":
    case "ParamRead":
    case "RefRead":
    case "PropRead":
      return [];
    case "PropertyRead":
    case "MemberRead":
      return [e.object];
    case "ArrayLiteral":
      return e.elements.map((el) => el.value);
    case "ObjectLiteral":
      return e.properties.map((p) => p.value);
    case "Arrow":
      return [e.body];
    case "Call":
      return e.callee.kind === "Method" || e.callee.kind === "ArrayMethod" ? [e.callee.receiver, ...e.args] : e.args;
    case "TemplateLiteral":
      return e.expressions;
    case "Unary":
      return [e.operand];
    case "Binary":
      return [e.left, e.right];
    case "Conditional":
      return [e.test, e.whenTrue, e.whenFalse];
    default:
      return assertNever(e, "expression");
  }
}

/** Pre-order walk over an expression tree. */
export function walkExpr(expr: ExprIR, visit: (e: ExprIR) => void): void {
  visit(expr);
  for (const child of childExpressions(expr)) walkExpr(child, visit);
}

/** All state slots and props an expression reads, in first-read order, without duplicates. */
export function collectDependencies(expr: ExprIR): DependencyIR[] {
  const out: DependencyIR[] = [];
  const add = (d: DependencyIR): void => {
    if (!out.some((o) => sameDependency(o, d))) out.push(d);
  };
  walkExpr(expr, (e) => {
    if (e.kind === "StateRead") add({ kind: "State", state: e.state });
    else if (e.kind === "PropRead") add({ kind: "Prop", name: e.name });
  });
  return out;
}

export function sameDependency(a: DependencyIR, b: DependencyIR): boolean {
  switch (a.kind) {
    case "State": return b.kind === "State" && a.state === b.state;
    case "Prop": return b.kind === "Prop" && a.name === b.name;
    case "Item": return b.kind === "Item";
    default: return assertNever(a, "dependency");
  }
}

/** Every expression in a function body, including nested functions (updaters), in pre-order. */
export function walkFunction(fn: FunctionIR, visit: (e: ExprIR) => void): void {
  const statements = (body: readonly StatementIR[]): void => {
    for (const stmt of body) {
      switch (stmt.kind) {
        case "ExpressionStatement": walkExpr(stmt.expression, visit); break;
        case "LocalConst": walkExpr(stmt.value, visit); break;
        case "If": walkExpr(stmt.test, visit); statements(stmt.then); statements(stmt.else); break;
        case "Return": if (stmt.value) walkExpr(stmt.value, visit); break;
        case "SetState": if ("updater" in stmt) walkFunction(stmt.updater, visit); else walkExpr(stmt.value, visit); break;
        case "Assign": walkExpr(stmt.value, visit); break;
        case "PlaySound": break;
        case "CallAction": for (const arg of stmt.args) walkExpr(arg, visit); break;
        default: assertNever(stmt, "statement");
      }
    }
  };
  statements(fn.body);
}

/** Whether an expression reads the parameter `param`. */
export function readsParam(expr: ExprIR, param: LocalId): boolean {
  let found = false;
  walkExpr(expr, (e) => {
    if (e.kind === "ParamRead" && e.param === param) found = true;
  });
  return found;
}

/** Whether a function body reads the parameter `param`. */
export function functionReadsParam(fn: FunctionIR, param: LocalId): boolean {
  let found = false;
  walkFunction(fn, (e) => {
    if (e.kind === "ParamRead" && e.param === param) found = true;
  });
  return found;
}

/** Only the state slots an expression reads (what a `useState` initial value may not touch). */
export function stateReads(expr: ExprIR): StateId[] {
  return collectDependencies(expr).flatMap((d) => (d.kind === "State" ? [d.state] : []));
}
