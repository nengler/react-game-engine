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
    case "PlainRef":
    case "ActionRef":
    case "ElementRead":
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
    case "IndexRead":
      return [e.object, e.index];
    case "NonNull":
      return [e.expression];
    case "Memo":
      return [e.value];
    case "ArrayLiteral":
      return e.elements.map((el) => el.value);
    case "ObjectLiteral":
      return e.properties.map((p) => p.value);
    case "Arrow":
      return [e.body];
    case "Callback":
    case "Block":
      return []; // its body is statements, which `walkExpr` walks
    case "Call":
      return e.callee.kind === "Method" || e.callee.kind === "ArrayMethod" || e.callee.kind === "ValueMethod" ? [e.callee.receiver, ...e.args] : e.args;
    case "TemplateLiteral":
      return e.expressions;
    case "Unary":
      return [e.operand];
    case "Binary":
      return [e.left, e.right];
    case "Conditional":
      return [e.test, e.whenTrue, e.whenFalse];
    case "New":
      return e.args;
    default:
      return assertNever(e, "expression");
  }
}

/** Pre-order walk over an expression tree. */
export function walkExpr(expr: ExprIR, visit: (e: ExprIR) => void): void {
  visit(expr);
  if (expr.kind === "Callback" || expr.kind === "Block") walkStatements(expr.fn.body, visit);
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

/**
 * Every expression in a function body, including nested functions, in pre-order. `visitStatement`, if given, sees
 * each statement before its expressions.
 */
export function walkFunction(fn: FunctionIR, visit: (e: ExprIR) => void, visitStatement?: (s: StatementIR) => void): void {
  walkStatements(fn.body, visit, visitStatement);
}

/** Every expression in a list of statements, nested blocks and functions included, in pre-order. */
export function walkStatements(body: readonly StatementIR[], visit: (e: ExprIR) => void, visitStatement?: (s: StatementIR) => void): void {
  for (const stmt of body) {
    visitStatement?.(stmt);
    switch (stmt.kind) {
      case "ExpressionStatement": walkExpr(stmt.expression, visit); break;
      case "LocalConst": walkExpr(stmt.value, visit); break;
      case "If": walkExpr(stmt.test, visit); walkStatements(stmt.then, visit, visitStatement); walkStatements(stmt.else, visit, visitStatement); break;
      case "ForOf": walkExpr(stmt.iterable, visit); walkStatements(stmt.body, visit, visitStatement); break;
      case "While": walkExpr(stmt.test, visit); walkStatements(stmt.body, visit, visitStatement); break;
      case "For":
        walkStatements(stmt.init, visit, visitStatement);
        if (stmt.test) walkExpr(stmt.test, visit);
        walkStatements(stmt.update, visit, visitStatement);
        walkStatements(stmt.body, visit, visitStatement);
        break;
      case "Try":
        walkStatements(stmt.block, visit, visitStatement);
        if (stmt.handler) walkStatements(stmt.handler.body, visit, visitStatement);
        if (stmt.finalizer) walkStatements(stmt.finalizer, visit, visitStatement);
        break;
      case "Throw": walkExpr(stmt.value, visit); break;
      case "Block": walkStatements(stmt.body, visit, visitStatement); break;
      case "Switch":
        walkExpr(stmt.discriminant, visit);
        for (const c of stmt.cases) {
          if (c.test) walkExpr(c.test, visit);
          walkStatements(c.body, visit, visitStatement);
        }
        break;
      case "Break": case "Continue": break;
      case "Return": if (stmt.value) walkExpr(stmt.value, visit); break;
      case "SetState": walkExpr(stmt.value, visit); break;
      case "Assign": if (stmt.target.kind === "Path") walkExpr(stmt.target.target, visit); walkExpr(stmt.value, visit); break;
      case "PlaySound": if (stmt.volume) walkExpr(stmt.volume, visit); break;
      case "CallAction": for (const arg of stmt.args) walkExpr(arg, visit); break;
      default: assertNever(stmt, "statement");
    }
  }
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

/**
 * A path that leaves `start` and comes back to it (`[start, …, last]`, `last` having an edge to `start`), or null. Each node is
 * explored once: one that did not lead back to `start` cannot lead back later.
 */
export function cycleThrough(start: string, edges: ReadonlyMap<string, readonly string[]>): string[] | null {
  const path: string[] = [];
  const explored = new Set<string>();
  const dfs = (node: string): boolean => {
    path.push(node);
    for (const next of edges.get(node) ?? []) {
      if (next === start) return true;
      if (explored.has(next) || path.includes(next)) continue;
      if (dfs(next)) return true;
    }
    explored.add(node);
    path.pop();
    return false;
  };
  return dfs(start) ? path : null;
}
