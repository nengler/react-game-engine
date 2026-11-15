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
function handler(body: string, state = "const s = useMutable({ n: 0 });"): string {
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
  const s = useMutable({
    enemies: [
    { id: "a", hp: 3, boss: false },
    { id: "b", hp: 0, boss: false },
    { id: "c", hp: 7, boss: true },
    { id: "d", hp: 9, boss: false },
  ] as Enemy[],
    total: 0,
    strongest: "",
    ticks: 0,
    seen: [] as string[],
    last: null as Enemy | null,
  });
  useUpdate((dt) => {
    let sum = 0;
    let best: Enemy | null = null;
    for (const e of s.enemies) {
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
    flag &&= s.ticks < 100;
    s.total = sum + count + (flag ? 0 : 1000) + 2 ** 3;
    s.strongest = best === null ? label : best.id;
    s.seen = [...s.seen, best === null ? "-" : best.id];
    s.last = best;
    s.ticks += 1;
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
    assert.ok(loop.kind === "ForOf" && loop.binding.kind === "Name" && loop.binding.name === "e" && loop.iterable.kind === "StateRead");
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
    assert.deepEqual(operators, ["+=", "**=", "%=", "??=", "||=", "&&="]);
  });

  it("generate plain TypeScript loops and lets that type-check", () => {
    const compiled = compile(SCORER);
    assert.match(compiled.code, /for \(const e of this\.#\$s_enemiesNext\) \{/);
    assert.match(compiled.code, /let best: Enemy \| null = null;/);
    assert.match(compiled.code, /if \(e\.hp === 0\) \{\s*continue;\s*\}/);
    assert.match(compiled.code, /count \+= 1;/);
    assert.match(compiled.code, /label \?\?= "none";/);
    assert.match(compiled.code, /\(2 \*\* 3\)/);
    assert.match(compiled.code, /\$s_seen: string\[\] = \[\];/);
    assert.match(compiled.code, /\$s_last: Enemy \| null = null;/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("run: the loop skips, accumulates and stops; fields keep arrays and records", async () => {
    type Scorer = Entity & { s: { total: number; strongest: string; seen: string[]; last: { id: string } | null } };
    const { Scorer } = await load<{ Scorer: new () => Scorer }>(compile(SCORER));
    const world = new World();
    const scorer = new Scorer();
    world.mount(scorer);
    world.tick(1);
    // a (3) and c (7, the boss: break) are summed; b (0) is skipped; d is never reached. count: (0 + 1) ** 2 % 3 = 1. 2 ** 3 = 8.
    assert.equal(scorer.s.total, 3 + 7 + 1 + 8);
    assert.equal(scorer.s.strongest, "c");
    world.tick(1);
    assert.deepEqual(scorer.s.seen, ["c", "c"]);
    assert.equal(scorer.s.last?.id, "c");
  });

  it("writes `else if` chains flat", () => {
    const compiled = compile(handler(`if (dt > 2) { s.n = 2; } else if (dt > 1) { s.n = 1; } else { s.n = 0; }`));
    assert.match(compiled.code, /\} else if \(dt > 1\) \{/);
    assert.doesNotMatch(compiled.code, /else \{\s*if/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("allow `++` and `--` as statements on fields, and loops in handlers and callbacks", () => {
    const compiled = compile(`
interface Props { onHit?: (n: number) => void }
function Child({ onHit }: Props) { return <Entity name="Child" />; }
function C() {
  const s = useMutable({ items: [1, 2, 3] as number[], hits: 0 });
  useUpdate(() => {
    s.hits++;
    --s.hits;
    let out: number[] = [];
    for (const x of s.items) out = [...out, x * 2];
    s.items = out;
  });
  return <Entity name="C"><Child onHit={(n) => { for (const i of s.items) { if (i === n) s.hits += i; } }} /></Entity>;
}`);
    assert.match(compiled.code, /this\.\$set_s_hits\(this\.#\$s_hitsNext \+ 1\);\s*this\.\$set_s_hits\(this\.#\$s_hitsNext - 1\);/);
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("destructuring loops and switch", () => {
  const SOURCE = `
interface Enemy { id: string; hp: number; kind: "grunt" | "boss" | "ghost" }
function C() {
  const s = useMutable({
    enemies: [
    { id: "a", hp: 3, kind: "grunt" },
    { id: "b", hp: 5, kind: "boss" },
    { id: "c", hp: 2, kind: "ghost" },
    { id: "d", hp: 4, kind: "grunt" },
  ] as Enemy[],
    log: "",
  });
  useUpdate(() => {
    let out = "";
    for (const [i, { id, hp: health, kind }] of s.enemies.entries()) {
      switch (kind) {
        case "ghost":
          continue;
        case "boss":
          out += \`\${i}:\${id}!\${health} \`;
          break;
        default:
          out += \`\${i}:\${id}\${health} \`;
      }
      if (health > 3) {
        switch (i) {
          case 0:
          case 1:
            out += "early ";
            break;
          default:
            out += "late ";
        }
      }
    }
    for (const [, second] of [[1, 2], [3, 4]]) out += String(second);
    s.log = out;
  });
  return <Entity name="C" />;
}`;

  it("lower to ForOf bindings and Switch, and generate them as written", () => {
    const compiled = compile(SOURCE);
    const hook = compiled.ir.components[0]!.hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const loop = hook.handler.body[1]!;
    assert.ok(loop.kind === "ForOf" && loop.binding.kind === "Array");
    assert.deepEqual(loop.binding.elements.map((e) => (e?.kind === "Name" ? e.name : e?.kind)), ["i", "Object"]);
    assert.match(compiled.code, /for \(const \[i, \{ id, hp: health, kind \}\] of this\.#\$s_enemiesNext\.entries\(\)\) \{/);
    assert.match(compiled.code, /switch \(kind\) \{\s*case "ghost":\s*continue;\s*case "boss":/);
    assert.match(compiled.code, /for \(const \[, second\] of/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("run: destructured items, fallthrough, default, break and continue behave as in JS", async () => {
    const { C } = await load<{ C: new () => Entity & { s: { log: string } } }>(compile(SOURCE));
    const world = new World();
    const c = new C();
    world.mount(c);
    world.tick(1);
    assert.equal(c.s.log, "0:a3 1:b!5 early 3:d4 late 24");
  });
});

describe("diagnostics for the new statements", () => {
  it("rejects `continue` in a switch outside a loop, and two `const`s of one name across its cases (they share a scope)", () => {
    assert.deepEqual(codes(handler(`switch (s.n) { case 1: continue; }`)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler(`switch (s.n) { case 1: { const a = 1; break; } case 2: const b = 1; const b = 2; }`)), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects `break` and `continue` outside a loop, and labels", () => {
    assert.deepEqual(codes(handler("break;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("if (dt > 1) { continue; }")), [DiagnosticCode.UnsupportedStatement]);
    // A loop does not reach into an updater: it is another function.
    assert.ok(codes(handler("outer: for (const x of [1]) { break outer; }")).length > 0);
  });

  it("rejects a `for…of` that is not `for (const x of …)`, and `for…in`", () => {
    // `while` and C-style `for` are handler code since REACT_FEEL_PLAN.md A1 (loops.test.ts).
    for (const loop of ["for (let x of [1]) { }", "for (const [a, ...rest] of [[1, 2]]) { }", "for (const { a = 1 } of [{ a: 2 }]) { }", "for (const x: number of [1]) { }", "for (const k in { a: 1 }) { }"]) {
      assert.ok(codes(handler(loop)).includes(DiagnosticCode.UnsupportedStatement), loop);
    }
    assert.ok(compile(handler("while (dt > 0) { break; }")).code.includes("while (dt > 0)"));
    assert.ok(compile(handler("for (let i = 0; i < 3; i++) { }")).code.includes("for (let i = 0; i < 3; i += 1)"));
  });

  it("rejects assignment to a `const`, a loop item, a parameter or a useMutable itself; a field is written with `=` and `++`", () => {
    assert.match(compileErrors(handler("const a = 1; a = 2;"))[0]!.message, /declare it with `let`/);
    assert.deepEqual(codes(handler("for (const x of [1]) { x = 2; }")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("dt = 2;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("s = 2;")), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes(handler("s++;")), [DiagnosticCode.UnsupportedExpression]);
    assert.doesNotThrow(() => compile(handler("s.n = 2; s.n++; s.n -= 1;")));
  });

  it("suggests the nearest name for an unknown identifier or component", () => {
    const [unknown] = compileErrors(handler("s.count = cout + 1;", "const s = useMutable({ count: 0 });"));
    assert.equal(unknown!.code, DiagnosticCode.UnknownIdentifier);
    assert.match(unknown!.message, /did you mean 's\.count'\?/, "a field, by the name it is read with");
    const [tag] = compileErrors(`function C() { return <Entity name="C"><Sprit image="a.png" /></Entity>; }`);
    assert.equal(tag!.code, DiagnosticCode.UnknownComponent);
    assert.match(tag!.message, /did you mean <Sprite>\?/);
  });
});

describe("copying array methods (ES2023)", () => {
  it("toSorted, toReversed, toSpliced, with, findLast and findLastIndex lower, type-check and leave state untouched", async () => {
    const compiled = compile(`
function C() {
  const s = useMutable({ xs: [3, 1, 2] as number[], sorted: [] as number[], last: 0 });
  const byDesc = s.xs.toSorted((a, b) => b - a);
  useUpdate(() => {
    s.sorted = s.xs.toSorted();
    s.xs = s.xs.toReversed().with(0, 9).toSpliced(1, 1);
    s.last = (s.xs.findLast((x) => x > 1) ?? 0) + s.xs.findLastIndex((x) => x === 3) + byDesc[0]!;
  });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { C } = await load<{ C: new () => Entity & { s: { xs: number[]; sorted: number[]; last: number } } }>(compiled);
    const world = new World();
    const c = new C();
    world.mount(c);
    world.tick(1);
    assert.deepEqual(c.s.sorted, [1, 2, 3]);
    assert.deepEqual(c.s.xs, [9, 3]); // [2, 1, 3] → with(0, 9) → [9, 1, 3] → toSpliced(1, 1) → [9, 3]
    // The handler reads `xs` as it just wrote it, [9, 3] (and `byDesc` worked out from it): findLast(x > 1) 3, findLastIndex(x === 3) 1,
    // byDesc[0] 9.
    assert.equal(c.s.last, 3 + 1 + 9);
  });

  it("points the in-place methods at their copying forms", () => {
    assert.match(compileErrors(handler("s.n = 0;", "const s = useMutable({ xs: [] as number[], n: 0 }); const sorted = s.xs.sort();"))[0]!.message, /toSorted/);
    assert.match(compileErrors(handler("s.n = 0;", "const s = useMutable({ xs: [] as number[], n: 0 }); const reversed = s.xs.reverse();"))[0]!.message, /toReversed/);
  });
});
