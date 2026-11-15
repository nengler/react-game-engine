import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * React written as React (PAIN_POINTS.md, section 8): an early return, a props type written in the parameter, an object state
 * whose type is its literal's, and a module imported whole. Each compiles, type-checks and runs as it would in React.
 */
import { after, describe, it } from "node:test";

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
    assert.deepEqual(
      wrong.map((d) => d.message),
      ["'colour' is not a prop of HeartProps."]
    );
  });
});

describe("an object state without its type written", () => {
  it("takes its literal's type, as TypeScript would", async () => {
    const compiled = compile(`import { Entity, Text, useInput, useMutable } from "@rge/runtime/jsx";
export function Walker() {
  const s = useMutable({ at: { x: 0, y: 0, tags: ["a"], last: { hit: false } } });
  useInput((input) => {
    if (input.pressed("Right")) s.at = { ...s.at, x: s.at.x + 1, tags: [...s.at.tags, "r"] };
  });
  return <Entity x={s.at.x}><Text>{s.at.tags.join(",")}</Text></Entity>;
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
    const errors = compileErrors(`import { Entity, useMutable } from "@rge/runtime/jsx";
export function A() {
  const s = useMutable({ items: [] });
  return <Entity x={s.items.length} />;
}`);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /^An empty array needs its type/);
  });
});

describe("a module imported whole", () => {
  it("reads its constants and calls its functions, and the generated module imports it whole", () => {
    const repo = resolve(import.meta.dirname, "../../..");
    mkdirSync(join(repo, ".test-output"), { recursive: true });
    const dir = mkdtempSync(join(repo, ".test-output", "ns-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src/constants.ts"),
      `export const SPEED = 3;\nexport function twice(n: number): number {\n  return n * 2;\n}\n`
    );
    writeFileSync(
      join(dir, "src/Mover.tsx"),
      `import { Entity, useMutable, useUpdate } from "@rge/runtime/jsx";
import * as K from "./constants.ts";
export function Mover() {
  const s = useMutable({ x: 0 });
  useUpdate((dt) => { s.x += K.SPEED * dt; });
  return <Entity x={K.twice(s.x)} />;
}
`
    );
    const run = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const out = readFileSync(join(dir, "out/Mover.ts"), "utf8");
    assert.match(out, /^import \* as K from "\.\.\/src\/constants\.ts";$/m);
    assert.match(out, /K\.SPEED \* dt/);
    assert.match(out, /K\.twice\(this\.\$s_x\)/);
  });
});

describe("a useMutable field set from an imported constant or function", () => {
  it("takes the constant's type, widened as a `let` would, and lets a handler write through what the function made", () => {
    const repo = resolve(import.meta.dirname, "../../..");
    mkdirSync(join(repo, ".test-output"), { recursive: true });
    const dir = mkdtempSync(join(repo, ".test-output", "imp-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src/constants.ts"),
      `export const START_GOLD = 100;\nexport function makeHero() {\n  return { hp: 3, name: "Ash" };\n}\n`
    );
    writeFileSync(
      join(dir, "src/Shop.tsx"),
      `import { Text, useInput, useMutable } from "@rge/runtime/jsx";
import { START_GOLD, makeHero } from "./constants.ts";
export function Shop() {
  const s = useMutable({ gold: START_GOLD, hero: makeHero(), bought: 0 });
  useInput((input) => {
    if (input.pressed("confirm")) {
      s.gold -= 10;
      s.bought++;
      s.hero.hp -= 1;
    }
  });
  return <Text>{\`\${s.gold} \${s.bought} \${s.hero.name} \${s.hero.hp}\`}</Text>;
}
`
    );
    const run = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], {
      cwd: repo,
      encoding: "utf8",
    });
    // The CLI type-checks the generated file, so `s.gold -= 10` on `typeof START_GOLD` (`100`) would fail here.
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const out = readFileSync(join(dir, "out/Shop.ts"), "utf8");
    assert.match(out, /\$s_gold: \(typeof START_GOLD extends number \? number/);
    assert.match(out, /\$s_hero: ReturnType<typeof makeHero>/);
  });
});

describe("a derived value that may be null, tested before it is used", () => {
  it("narrows as TypeScript does in the source: one value, not a copy at each use", async () => {
    const SOURCE = `import { Text, useInput, useMutable } from "@rge/runtime/jsx";
const PRICES = { bow: 5, axe: 9 };
type Kind = keyof typeof PRICES;
export function Shop() {
  const s = useMutable({ gold: 7, kind: null as Kind | null });
  const cost = s.kind === null ? null : PRICES[s.kind];
  const label = s.kind ?? "nothing";
  useInput((input) => {
    if (input.pressed("Left")) s.kind = "bow";
    if (input.pressed("Right")) s.kind = "axe";
  });
  return <Text>{cost !== null && s.gold >= cost ? \`\${label} for \${cost}\` : label}</Text>;
}`;
    assert.deepEqual(sourceErrors(SOURCE), [], "the source as written");
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), [], "the generated code tests and uses one `cost`");
    const { Shop } = await load<{ Shop: new () => Entity }>(compiled);
    const world = new World();
    const shop = new Shop();
    world.mount(shop);
    world.flush();
    assert.deepEqual(texts(shop), ["nothing"]);
    const press = (key: string) => {
      world.tick(1 / 60, { pressed: (k: string) => k === key, down: () => false, released: () => false } as never);
      world.flush();
    };
    press("Left");
    assert.deepEqual(texts(shop), ["bow for 5"]);
    press("Right");
    assert.deepEqual(texts(shop), ["axe"]);
  });
});

describe("a list worked out in the body: reduce, a sorted copy, and an item found and shown", () => {
  const SOURCE = `import { Flex, Text, useInput, useMutable } from "@rge/runtime/jsx";
interface Foe { id: number; hp: number; x: number; boss: boolean }
export function Wave() {
  const s = useMutable({ foes: [{ id: 1, hp: 2, x: 30, boss: false }, { id: 2, hp: 0, x: 10, boss: false }, { id: 3, hp: 5, x: 20, boss: true }] as Foe[] });
  const alive = s.foes.filter((f) => f.hp > 0);
  const total = alive.reduce((sum, f) => sum + f.hp, 0);
  const byX = [...alive].sort((a, b) => a.x - b.x);
  const boss = alive.find((f) => f.boss);
  useInput((input) => {
    if (input.pressed("confirm")) s.foes = s.foes.map((f) => (f.boss ? { ...f, hp: 0 } : f));
  });
  return (
    <Flex>
      <Text>{\`total \${total}\`}</Text>
      {boss && <Text>{\`boss \${boss.hp}\`}</Text>}
      {byX.map((f) => <Text key={f.id}>{\`at \${f.x}\`}</Text>)}
    </Flex>
  );
}`;

  it("compiles as React would take it, type-checks, and shows what the list holds", async () => {
    assert.deepEqual(sourceErrors(SOURCE), [], "the source as written");
    const compiled = compile(SOURCE);
    assert.match(compiled.code, /\.toSorted\(/, "sorting a copy made right there is the copying form");
    assert.deepEqual(typeCheck(compiled), [], "`boss.hp` is read from the one `const` the condition tested");
    const { Wave } = await load<{ Wave: new () => Entity }>(compiled);
    const world = new World();
    const wave = new Wave();
    world.mount(wave);
    world.flush();
    assert.deepEqual(texts(wave), ["total 7", "boss 5", "at 20", "at 30"]);
    world.tick(1 / 60, { pressed: (k: string) => k === "confirm", down: () => false, released: () => false } as never);
    world.flush();
    assert.deepEqual(texts(wave), ["total 2", "at 30"]);
  });

  it("still refuses sorting state's own list in place", () => {
    const errors = compileErrors(`import { Text, useMutable } from "@rge/runtime/jsx";
export function A() {
  const s = useMutable({ xs: [3, 1] });
  const sorted = s.xs.sort();
  return <Text>{sorted.join(",")}</Text>;
}`);
    assert.match(errors[0]!.message, /changes `s\.xs` in place/);
  });
});

describe("a loop over a useMutable list that writes through its item", () => {
  const SOURCE = `import { Text, useInput, useMutable } from "@rge/runtime/jsx";
interface Foe { id: number; hp: number; x: number; tags: string[] }
export function Field() {
  const s = useMutable({
    foes: [{ id: 1, hp: 3, x: 0, tags: [] }, { id: 2, hp: 1, x: 50, tags: [] }, { id: 3, hp: 2, x: 90, tags: [] }] as Foe[],
    log: "",
  });
  useInput((input) => {
    if (!input.pressed("confirm")) return;
    for (const foe of s.foes) {
      if (foe.x > 80) break;
      foe.hp -= 1;
      foe.x += 10;
      if (foe.hp <= 0) foe.tags.push("down");
      s.log += \`\${foe.id}:\${foe.hp} \`;
    }
  });
  return <Text>{\`\${s.foes.map((f) => \`\${f.hp}@\${f.x}\${f.tags.join("")}\`).join(",")} | \${s.log}\`}</Text>;
}`;

  it("changes each item it passes, reads its own writes, and stops at break", async () => {
    assert.deepEqual(sourceErrors(SOURCE), [], "the source as written");
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Field } = await load<{ Field: new () => Entity }>(compiled);
    const world = new World();
    const field = new Field();
    world.mount(field);
    world.flush();
    assert.deepEqual(texts(field), ["3@0,1@50,2@90 | "]);
    world.tick(1 / 60, { pressed: (k: string) => k === "confirm", down: () => false, released: () => false } as never);
    world.flush();
    assert.deepEqual(texts(field), ["2@10,0@60down,2@90 | 1:2 2:0 "]);
  });

  it("refuses a loop that also changes the list itself, and says what to write", () => {
    const errors = compileErrors(`import { Text, useUpdate, useMutable } from "@rge/runtime/jsx";
interface Foe { hp: number }
export function A() {
  const s = useMutable({ foes: [] as Foe[] });
  useUpdate(() => {
    for (const foe of s.foes) {
      foe.hp -= 1;
      if (foe.hp <= 0) s.foes.splice(0, 1);
    }
  });
  return <Text>{s.foes.length}</Text>;
}`);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /also changes `s\.foes` itself/);
  });
});
