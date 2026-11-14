/**
 * React written as React (PAIN_POINTS.md, section 8): an early return, a props type written in the parameter, an object state
 * whose type is its literal's, and a module imported whole. Each compiles, type-checks and runs as it would in React.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Entity, Text, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const texts = (root: Entity): string[] => {
  const out: string[] = [];
  const walk = (o: Entity): void => {
    if (o instanceof Text) out.push(o.text);
    for (const c of o.children) walk(c as Entity);
  };
  walk(root);
  return out;
};

const sourceErrors = (text: string): string[] =>
  getCompiler()
    .typeCheckSources([{ fileName: `${process.cwd()}/.test-output/I${Math.random()}.tsx`, text }])
    .map((d) => d.message);

describe("an early return", () => {
  const SOURCE = `import { Entity, Text } from "@rge/runtime/jsx";
interface Hero { hp: number; name: string }
interface StatusProps { hero: Hero | null; paused: boolean }
export function Status({ hero, paused }: StatusProps) {
  if (!hero) return null;
  const label = hero.name.toUpperCase();
  if (paused) {
    return <Text>PAUSED</Text>;
  }
  return (
    <Entity>
      <Text>{label}</Text>
      <Text>{hero.hp}</Text>
    </Entity>
  );
}`;

  it("shows nothing, the second guard, or the rest, as React would, and type-checks with the guard's narrowing", async () => {
    assert.deepEqual(sourceErrors(SOURCE), [], "the source as written");
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), [], "the generated code, where `hero.name` is read under the guard");
    const { Status } = await load<{ Status: new (p: object) => Entity & { updateProps(p: object): void } }>(compiled);
    const world = new World();
    const hud = new Status({ hero: null, paused: false });
    world.mount(hud);
    world.flush();
    assert.deepEqual(texts(hud), [], "no hero: nothing, and `hero.name` was never read");
    hud.updateProps({ hero: { hp: 3, name: "ada" } });
    world.flush();
    assert.deepEqual(texts(hud), ["ADA", "3"]);
    hud.updateProps({ paused: true });
    world.flush();
    assert.deepEqual(texts(hud), ["PAUSED"]);
    hud.updateProps({ hero: null });
    world.flush();
    assert.deepEqual(texts(hud), []);
  });
});

describe("a props type written in the parameter", () => {
  it("is the component's props type, named for it, and the props are checked against it", async () => {
    const compiled = compile(`import { Text } from "@rge/runtime/jsx";
export function Heart({ hp, max = 3 }: { hp: number; max?: number }) {
  return <Text>{hp}/{max}</Text>;
}`);
    assert.match(compiled.code, /export interface HeartProps \{ hp: number; max\?: number \}/);
    assert.match(compiled.code, /class Heart extends Text<HeartProps>/);
    assert.deepEqual(typeCheck(compiled), []);
    const { Heart } = await load<{ Heart: new (p: object) => Text }>(compiled);
    const world = new World();
    const heart = new Heart({ hp: 2 });
    world.mount(heart);
    world.flush();
    assert.equal(heart.text, "2/3");
    const wrong = compileErrors(`import { Text } from "@rge/runtime/jsx";
export function Heart({ hp, colour }: { hp: number }) {
  return <Text>{hp}</Text>;
}`);
    assert.deepEqual(wrong.map((d) => d.message), ["'colour' is not a prop of HeartProps."]);
  });
});

describe("an object state without its type written", () => {
  it("takes its literal's type, as TypeScript would", async () => {
    const compiled = compile(`import { Entity, Text, useInput, useState } from "@rge/runtime/jsx";
export function Walker() {
  const [at, setAt] = useState({ x: 0, y: 0, tags: ["a"], last: { hit: false } });
  useInput((input) => {
    if (input.pressed("Right")) setAt({ ...at, x: at.x + 1, tags: [...at.tags, "r"] });
  });
  return <Entity x={at.x}><Text>{at.tags.join(",")}</Text></Entity>;
}`);
    assert.match(compiled.code, /at: \{ x: number; y: number; tags: string\[\]; last: \{ hit: boolean \} \} = /);
    assert.deepEqual(typeCheck(compiled), []);
    const { Walker } = await load<{ Walker: new () => Entity }>(compiled);
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    world.flush();
    world.tick(1 / 60, { pressed: (k: string) => k === "Right", down: () => false, released: () => false } as never);
    world.flush();
    assert.equal(walker.transform.x, 1);
    assert.deepEqual(texts(walker), ["a,r"]);
  });

  it("still asks for the type of an empty array, which TypeScript would call never[]", () => {
    const errors = compileErrors(`import { Entity, useState } from "@rge/runtime/jsx";
export function A() {
  const [items] = useState([]);
  return <Entity x={items.length} />;
}`);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /^An empty array state needs its type/);
  });
});

describe("a module imported whole", () => {
  it("reads its constants and calls its functions, and the generated module imports it whole", () => {
    const repo = resolve(import.meta.dirname, "../../..");
    mkdirSync(join(repo, ".test-output"), { recursive: true });
    const dir = mkdtempSync(join(repo, ".test-output", "ns-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/constants.ts"), `export const SPEED = 3;\nexport function twice(n: number): number {\n  return n * 2;\n}\n`);
    writeFileSync(
      join(dir, "src/Mover.tsx"),
      `import { Entity, useState, useUpdate } from "@rge/runtime/jsx";
import * as K from "./constants.ts";
export function Mover() {
  const [x, setX] = useState(0);
  useUpdate((dt) => setX(x + K.SPEED * dt));
  return <Entity x={K.twice(x)} />;
}
`,
    );
    const run = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const out = readFileSync(join(dir, "out/Mover.ts"), "utf8");
    assert.match(out, /^import \* as K from "\.\.\/src\/constants\.ts";$/m);
    assert.match(out, /K\.SPEED \* dt/);
    assert.match(out, /K\.twice\(this\.x\)/);
  });
});
