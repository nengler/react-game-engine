/**
 * Handler statements beyond `if` and `const`: `for…of` loops with `break` and `continue`, `let` locals (with an optional type),
 * every compound assignment and `++` / `--` on locals and refs, `**`, refs that hold any value, and the "did you mean"
 * suggestions for unknown names. Each is lowered, type-checked as generated code, and run against the runtime.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World } from "@rge/runtime";
import { DiagnosticCode, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

function codes(source: string): string[] {
  return compileErrors(source).map((d) => d.code);
}

/** A component with `state` lines and one `useUpdate` handler holding `body`. */
function handler(body: string, state = "const [n, setN] = useState(0);"): string {
  return `interface Enemy { id: string; hp: number; boss: boolean }
function C() {
  ${state}
  useUpdate((dt) => { ${body} });
  return <Entity name="C" />;
}`;
}

const SCORER = `
interface Enemy { id: string; hp: number; boss: boolean }

function Scorer() {
  const [enemies, setEnemies] = useState<Enemy[]>([
    { id: "a", hp: 3, boss: false },
    { id: "b", hp: 0, boss: false },
    { id: "c", hp: 7, boss: true },
    { id: "d", hp: 9, boss: false },
  ]);
  const [total, setTotal] = useState(0);
  const [strongest, setStrongest] = useState("");
  const [ticks, setTicks] = useState(0);
  const seen = useRef<string[]>([]);
  const last = useRef<Enemy | null>(null);
  useUpdate((dt) => {
    let sum = 0;
    let best: Enemy | null = null;
    for (const e of enemies) {
      if (e.hp === 0) continue;
      sum += e.hp;
      if (best === null || e.hp > best.hp) best = e;
      if (e.boss) break;
    }
    let count = 0;
    count++;
    count **= 2;
    count %= 3;
    let label: string | null = null;
    label ??= "none";
    label ||= "unused";
    let flag = true;
    flag &&= ticks < 100;
    setTotal(sum + count + (flag ? 0 : 1000) + 2 ** 3);
    setStrongest(best === null ? label : best.id);
    seen.current = [...seen.current, best === null ? "-" : best.id];
    last.current = best;
    setTicks((t) => t + 1);
  });
  return <Entity name="Scorer" />;
}
`;

describe("for…of, let and compound assignment in handlers", () => {
  it("lower to ForOf, Break/Continue, mutable LocalConst with a type, and Assign to a Local", () => {
    const { ir } = compile(SCORER);
    const hook = ir.components[0]!.hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const body = hook.handler.body;
    const [sum, best, loop] = body as [StatementIR, StatementIR, StatementIR];
    assert.ok(sum.kind === "LocalConst" && sum.mutable === true && sum.type === undefined);
    assert.ok(best.kind === "LocalConst" && best.mutable === true && best.type?.kind === "SourceType" && best.type.text === "Enemy | null");
    assert.ok(loop.kind === "ForOf" && loop.name === "e" && loop.iterable.kind === "StateRead");
    const kinds = loop.body.flatMap((s) => (s.kind === "If" ? s.then.map((t) => t.kind) : [s.kind]));
    assert.deepEqual(kinds, ["Continue", "Assign", "Assign", "Break"]);
    const increment = body.find((s): s is Extract<StatementIR, { kind: "Assign" }> => s.kind === "Assign" && s.target.kind === "Local" && s.target.name === "count");
    assert.ok(increment);
    assert.deepEqual({ ...increment, target: { ...increment.target, local: "" } }, {
      kind: "Assign",
      target: { kind: "Local", local: "", name: "count" },
      operator: "+=",
      value: { kind: "NumberLiteral", value: 1 },
    });
    const operators = body.flatMap((s) => (s.kind === "Assign" ? [s.operator] : []));
    assert.deepEqual(operators, ["+=", "**=", "%=", "??=", "||=", "&&=", "=", "="]); // then the two ref writes
  });

  it("generate plain TypeScript loops and lets that type-check", () => {
    const compiled = compile(SCORER);
    assert.match(compiled.code, /for \(const e of this\.enemies\) \{/);
    assert.match(compiled.code, /let best: Enemy \| null = null;/);
    assert.match(compiled.code, /if \(e\.hp === 0\) \{\s*continue;\s*\}/);
    assert.match(compiled.code, /count \+= 1;/);
    assert.match(compiled.code, /label \?\?= "none";/);
    assert.match(compiled.code, /\(2 \*\* 3\)/);
    assert.match(compiled.code, /seen: string\[\] = \[\];/);
    assert.match(compiled.code, /last: Enemy \| null = null;/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("run: the loop skips, accumulates and stops; refs keep arrays and records", async () => {
    type Scorer = Entity & { total: number; strongest: string; seen: string[]; last: { id: string } | null };
    const { Scorer } = await load<{ Scorer: new () => Scorer }>(compile(SCORER));
    const world = new World();
    const scorer = new Scorer();
    world.mount(scorer);
    world.tick(1);
    // a (3) and c (7, the boss: break) are summed; b (0) is skipped; d is never reached. count: (0 + 1) ** 2 % 3 = 1. 2 ** 3 = 8.
    assert.equal(scorer.total, 3 + 7 + 1 + 8);
    assert.equal(scorer.strongest, "c");
    world.tick(1);
    assert.deepEqual(scorer.seen, ["c", "c"]);
    assert.equal(scorer.last?.id, "c");
  });

  it("writes `else if` chains flat", () => {
    const compiled = compile(handler(`if (dt > 2) { setN(2); } else if (dt > 1) { setN(1); } else { setN(0); }`));
    assert.match(compiled.code, /\} else if \(dt > 1\) \{/);
    assert.doesNotMatch(compiled.code, /else \{\s*if/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("allow `++` and `--` as statements on refs, and loops in callbacks and updaters", () => {
    const compiled = compile(`
interface Props { onHit?: (n: number) => void }
function Child({ onHit }: Props) { return <Entity name="Child" />; }
function C() {
  const [items, setItems] = useState<number[]>([1, 2, 3]);
  const hits = useRef(0);
  useUpdate(() => {
    hits.current++;
    --hits.current;
    setItems((list) => {
      let out: number[] = [];
      for (const x of list) out = [...out, x * 2];
      return out;
    });
  });
  return <Entity name="C"><Child onHit={(n) => { for (const i of items) { if (i === n) hits.current += i; } }} /></Entity>;
}`);
    assert.match(compiled.code, /this\.hits \+= 1;\s*this\.hits -= 1;/);
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("diagnostics for the new statements", () => {
  it("rejects `break` and `continue` outside a loop, and labels", () => {
    assert.deepEqual(codes(handler("break;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("if (dt > 1) { continue; }")), [DiagnosticCode.UnsupportedStatement]);
    // A loop does not reach into an updater: it is another function.
    assert.deepEqual(codes(handler("for (const x of [1]) { setN((n) => { if (n > x) { break; } return n; }); }")), [DiagnosticCode.UnsupportedStatement]);
    assert.ok(codes(handler("outer: for (const x of [1]) { break outer; }")).length > 0);
  });

  it("rejects loops other than `for (const x of …)`", () => {
    for (const loop of ["for (let x of [1]) { }", "for (const [a, b] of [[1, 2]]) { }", "for (const x: number of [1]) { }", "for (const k in { a: 1 }) { }", "while (dt > 0) { }", "for (let i = 0; i < 3; i++) { }"]) {
      assert.ok(codes(handler(loop)).includes(DiagnosticCode.UnsupportedStatement), loop);
    }
  });

  it("rejects assignment to a `const`, a loop item, a parameter or state, and keeps `++` on state an expression error", () => {
    assert.match(compileErrors(handler("const a = 1; a = 2;"))[0]!.message, /declare it with `let`/);
    assert.deepEqual(codes(handler("for (const x of [1]) { x = 2; }")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("dt = 2;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("n = 2;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("n++;")), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(handler("r.current &= 1;", "const r = useRef(0);")), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects a ref typed as an element, and a ref whose type cannot be inferred", () => {
    assert.deepEqual(codes(handler("", "const r = useRef<Sprite[]>([]);")), [DiagnosticCode.InvalidUseRef]);
    assert.deepEqual(codes(handler("", "const r = useRef([]);")), [DiagnosticCode.InvalidUseRef]);
  });

  it("suggests the nearest name for an unknown identifier or component", () => {
    const [unknown] = compileErrors(handler("setN(cout + 1);", "const [count, setN] = useState(0);"));
    assert.equal(unknown!.code, DiagnosticCode.UnknownIdentifier);
    assert.match(unknown!.message, /did you mean 'count'\?/);
    const [tag] = compileErrors(`function C() { return <Entity name="C"><Sprit image="a.png" /></Entity>; }`);
    assert.equal(tag!.code, DiagnosticCode.UnknownComponent);
    assert.match(tag!.message, /did you mean <Sprite>\?/);
  });
});

describe("copying array methods (ES2023)", () => {
  it("toSorted, toReversed, toSpliced, with, findLast and findLastIndex lower, type-check and leave state untouched", async () => {
    const compiled = compile(`
function C() {
  const [xs, setXs] = useState<number[]>([3, 1, 2]);
  const [sorted, setSorted] = useState<number[]>([]);
  const [last, setLast] = useState(0);
  const byDesc = xs.toSorted((a, b) => b - a);
  useUpdate(() => {
    setSorted(xs.toSorted());
    setXs(xs.toReversed().with(0, 9).toSpliced(1, 1));
    setLast((xs.findLast((x) => x > 1) ?? 0) + xs.findLastIndex((x) => x === 3) + byDesc[0]!);
  });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { C } = await load<{ C: new () => Entity & { xs: number[]; sorted: number[]; last: number } }>(compiled);
    const world = new World();
    const c = new C();
    world.mount(c);
    world.tick(1);
    assert.deepEqual(c.sorted, [1, 2, 3]);
    assert.deepEqual(c.xs, [9, 3]); // [2, 1, 3] → with(0, 9) → [9, 1, 3] → toSpliced(1, 1) → [9, 3]
    assert.equal(c.last, 2 + 0 + 3);
  });

  it("points the in-place methods at their copying forms", () => {
    assert.match(compileErrors(handler("setN(0);", "const [xs, setXs] = useState<number[]>([]); const [n, setN] = useState(0); const s = xs.sort();"))[0]!.message, /toSorted/);
    assert.match(compileErrors(handler("setN(0);", "const [xs, setXs] = useState<number[]>([]); const [n, setN] = useState(0); const s = xs.reverse();"))[0]!.message, /toReversed/);
  });
});
