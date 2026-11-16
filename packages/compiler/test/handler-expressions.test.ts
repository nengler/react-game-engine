import assert from "node:assert/strict";
/**
 * Any expression in a handler (DESIGN.md, "Any expression in handlers"): `new`, `typeof`, `instanceof`, `in`, the standard library, and any
 * method of, or assignment into, a value the handler made itself. State and props stay immutable.
 */
import { after, describe, it } from "node:test";

import { Text, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck, withAuthoringImports } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

async function run(body: string, state = ""): Promise<string> {
  const compiled = compile(`
interface Enemy { id: string; hp: number }
export function Probe() {
  const s = useMutable({ out: "", enemies: [{ id: "a", hp: 3 }, { id: "b", hp: 1 }] as Enemy[] });
  ${state}
  useUpdate((dt) => {
    ${body}
  });
  return <Text>{s.out}</Text>;
}`);
  assert.deepEqual(typeCheck(compiled), []);
  const { Probe } = await load<{ Probe: new () => Text }>(compiled);
  const world = new World();
  const probe = new Probe();
  world.mount(probe);
  world.tick(1 / 60);
  world.flush();
  return probe.text;
}

describe("expressions in handlers", () => {
  it("builds a local array and object, and changes them in place", async () => {
    assert.equal(
      await run(`
    const alive: Enemy[] = [];
    const tally = { hits: 0 };
    for (const e of s.enemies) {
      if (e.hp > 1) alive.push(e);
      tally.hits += e.hp;
      tally.hits++;
    }
    alive.sort((a, b) => a.hp - b.hp);
    s.out = \`\${alive.map((e) => e.id).join(",")} \${tally.hits}\`;`),
      "a 6"
    );
  });

  it("makes a Map and a Set with new, and calls their methods", async () => {
    assert.equal(
      await run(`
    const byId = new Map<string, number>();
    const seen = new Set<string>();
    for (const e of s.enemies) {
      byId.set(e.id, e.hp);
      seen.add(e.id);
    }
    s.out = \`\${byId.get("a")} \${seen.has("b")} \${seen.size}\`;`),
      "3 true 2"
    );
  });

  it("takes typeof, instanceof, in, the standard library and new Error", async () => {
    assert.equal(
      await run(`
    let text = typeof dt;
    try {
      throw new Error("boom");
    } catch (e) {
      text += e instanceof Error ? \` \${e.message}\` : "";
    }
    const record: Record<string, number> = { a: 1 };
    text += \` \${"a" in record} \${Object.keys(record).join("")} \${JSON.stringify([1])} \${Math.floor(2.5)} \${Number.isFinite(1)} \${parseInt("7", 10)}\`;
    s.out = text;`),
      "number boom true a [1] 2 true 7"
    );
  });

  it("writes into a grid it made", async () => {
    assert.equal(
      await run(`
    const grid = Array.from({ length: 2 }, () => [0, 0]);
    grid[1]![0] = 5;
    s.out = grid.flat().join("");`),
      "0050"
    );
  });
});

describe("what stays out", () => {
  const codes = (body: string, state = "") =>
    compileErrors(`interface Enemy { id: string; hp: number }
function C() {
  const s = useMutable({ enemies: [] as Enemy[] });
  ${state}
  useUpdate(() => { ${body} });
  return <Entity />;
}`).map((d) => d.code);

  it("keeps state from being changed in place, even through a local that reads it", () => {
    assert.deepEqual(codes("enemies.push({ id: 'c', hp: 1 });"), [DiagnosticCode.UnsupportedExpression]);
    assert.ok(codes("const list = enemies; list.push({ id: 'c', hp: 1 });").length > 0);
    assert.ok(codes("const first = enemies.find((e) => e.hp > 0); if (first) first.hp = 0;").length > 0);
    assert.ok(codes("let best = { id: 'x', hp: 0 }; best = enemies[0]!; best.hp = 1;").length > 0);
  });

  it("keeps new out of a component body, and to known constructors", () => {
    assert.ok(compileErrors(`function C() { const m = new Map(); return <Entity />; }`).length > 0);
    assert.ok(codes("const d = new Date();").length > 0);
  });

  it("warns about Math.random", () => {
    const result = getCompiler().compile(
      "Random.tsx",
      withAuthoringImports(`function C() { const s = useMutable({ n: 0 }); useUpdate(() => { s.n = Math.random(); }); return <Entity />; }`)
    );
    assert.ok(result.ok);
    assert.ok(result.diagnostics.some((d) => d.severity === "warning" && /Math\.random\(\)/.test(d.message)));
    assert.ok(
      result.diagnostics.some((d) => /rollBetween|roll\(s\.seed\)/.test(d.message)),
      "and names the seeded rolls instead"
    );
  });

  it("rolls from a seed kept in state, and the same seed rolls the same numbers", async () => {
    const rolls = `
    let seed = 7;
    const out: string[] = [];
    const a = roll(seed); seed = a.seed; out.push(String(a.value < 1 && a.value >= 0));
    const b = rollInt(seed, 1, 6); seed = b.seed; out.push(String(b.value));
    const c = rollBetween(seed, -2, 2); seed = c.seed; out.push(String(c.value >= -2 && c.value < 2));
    const d = rollPick(seed, ["x", "y", "z"]); seed = d.seed; out.push(String(d.value));
    const e = rollChance(seed, 1); out.push(String(e.value));
    s.out = out.join(" ");`;
    const first = await run(rolls);
    assert.match(first, /^true [1-6] true [xyz] true$/);
    assert.equal(await run(rolls), first);
  });
});
