/**
 * Any expression in a handler (REACT_FEEL_PLAN.md, A1 step b): `new`, `typeof`, `instanceof`, `in`, the standard library, and any
 * method of, or assignment into, a value the handler made itself. State and props stay immutable.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Text, World } from "@rge/runtime";
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
  const [out, setOut] = useState("");
  const [enemies, setEnemies] = useState<Enemy[]>([{ id: "a", hp: 3 }, { id: "b", hp: 1 }]);
  ${state}
  useUpdate((dt) => {
    ${body}
  });
  return <Text>{out}</Text>;
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
    for (const e of enemies) {
      if (e.hp > 1) alive.push(e);
      tally.hits += e.hp;
      tally.hits++;
    }
    alive.sort((a, b) => a.hp - b.hp);
    setOut(\`\${alive.map((e) => e.id).join(",")} \${tally.hits}\`);`),
      "a 6",
    );
  });

  it("makes a Map and a Set with new, and calls their methods", async () => {
    assert.equal(
      await run(`
    const byId = new Map<string, number>();
    const seen = new Set<string>();
    for (const e of enemies) {
      byId.set(e.id, e.hp);
      seen.add(e.id);
    }
    setOut(\`\${byId.get("a")} \${seen.has("b")} \${seen.size}\`);`),
      "3 true 2",
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
    setOut(text);`),
      "number boom true a [1] 2 true 7",
    );
  });

  it("writes into a grid it made", async () => {
    assert.equal(
      await run(`
    const grid = Array.from({ length: 2 }, () => [0, 0]);
    grid[1]![0] = 5;
    setOut(grid.flat().join(""));`),
      "0050",
    );
  });
});

describe("what stays out", () => {
  const codes = (body: string, state = "") =>
    compileErrors(`interface Enemy { id: string; hp: number }
function C() {
  const [enemies, setEnemies] = useState<Enemy[]>([]);
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
    const result = getCompiler().compile("Random.tsx", withAuthoringImports(`function C() { const [n, setN] = useState(0); useUpdate(() => { setN(Math.random()); }); return <Entity />; }`));
    assert.ok(result.ok);
    assert.ok(result.diagnostics.some((d) => d.severity === "warning" && /Math\.random\(\)/.test(d.message)));
  });
});
