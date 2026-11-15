import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
/**
 * `@rge/testing` (DESIGN.md, "Testing one component: `@rge/testing`"): a component's own logic tested as a component, the way a rule is tested as a function.
 * The components are compiled here, as `rge` would compile a game's.
 */
import { after, before, describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { Compiler, formatDiagnostic } from "@rge/compiler";
import { createControls, Pointer, type GameObject, type TilemapData } from "@rge/runtime";

import { render } from "../src/index.ts";

const OUT = resolve(import.meta.dirname, "../../../.test-output", `testing-${process.pid}`);
let compiler: Compiler;

before(() => {
  compiler = new Compiler();
});
after(() => {
  compiler.close();
  rmSync(OUT, { recursive: true, force: true });
});

/** A component's `useMutable` fields (`s`), as the test reads them. */
const fields = (t: { state(): Record<string, unknown> }) => t.state().s as Record<string, unknown>;

let counter = 0;
/** Compile a component file and import the generated module. */
async function build<T>(source: string): Promise<T> {
  const imports = `import { Collider, Entity, Pointer, Text, Tilemap, useBody, useMutable, useUpdate, useInput } from "@rge/runtime/jsx";\n`;
  const result = compiler.compile("Test.tsx", imports + source);
  if (!result.ok) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  const file = join(OUT, String(++counter), "Test.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.code);
  return (await import(pathToFileURL(file).href)) as T;
}

const ENEMY = `
interface EnemyProps { hp: number; onDefeated: () => void }
export function Enemy({ hp, onDefeated }: EnemyProps) {
  const s = useMutable({ health: hp, flash: 0 });
  useUpdate((dt) => {
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
  });
  return (
    <Entity>
      <Text>{s.health > 0 ? \`hp \${s.health}\` : "down"}</Text>
      <Collider width={8} height={8} tag="enemy" onCollisionEnter={(other) => {
        if (other.tag !== "shot" || s.health <= 0) return;
        const left = s.health - 1;
        s.health = left;
        s.flash = 0.1;
        if (left === 0) onDefeated();
      }} />
    </Entity>
  );
}`;

describe("render", () => {
  it("tests an enemy's own logic: collisions in, a callback out, state read back", async () => {
    const { Enemy } = await build<{ Enemy: new (p: { hp: number; onDefeated: () => void }) => GameObject }>(ENEMY);
    const onDefeated = mock.fn();
    const t = render(Enemy, { hp: 3, onDefeated });
    assert.deepEqual(t.texts(), ["hp 3"]);
    t.collide("enemy", { tag: "shot" }, 2);
    assert.deepEqual(t.texts(), ["hp 1"]);
    assert.equal(fields(t).health, 1);
    assert.ok((fields(t).flash as number) > 0);
    t.collide("enemy", { tag: "shot" });
    assert.equal(onDefeated.mock.callCount(), 1);
    assert.deepEqual(t.texts(), ["down"]);
    t.step(10);
    assert.equal(fields(t).flash, 0);
  });

  it("runs an input script through the game's controls, and presses a pointer", async () => {
    const { Menu } = await build<{ Menu: new () => GameObject }>(`
export function Menu() {
  const s = useMutable({ cursor: 0, chosen: "none" });
  useInput((input) => {
    if (input.pressed("down")) s.cursor += 1;
    if (input.pressed("confirm")) s.chosen = \`row \${s.cursor}\`;
  });
  return (
    <Entity>
      <Text>{s.chosen}</Text>
      <Pointer width={10} height={10} onPress={() => { s.chosen = "clicked"; }} />
    </Entity>
  );
}`);
    const controls = createControls({ down: ["ArrowDown"], confirm: ["Enter"] });
    const t = render(Menu, undefined, { controls });
    t.input("down, _, down, _, confirm, _");
    assert.equal(fields(t).cursor, 2);
    assert.deepEqual(t.texts(), ["row 2"]);
    t.press(t.find(Pointer)!);
    assert.deepEqual(t.texts(), ["clicked"]);
  });

  it("registers tilemaps, so a body stops on the floor", async () => {
    const FLOOR: TilemapData = {
      width: 4,
      height: 2,
      tileWidth: 8,
      tileHeight: 8,
      firstGid: 1,
      solid: [1],
      layers: [{ name: "T", visible: true, data: [0, 0, 0, 0, 1, 1, 1, 1] }],
    };
    const { Faller } = await build<{ Faller: new () => GameObject }>(`
export function Faller() {
  const { x, y, move } = useBody({ x: 0, y: 0, width: 4, height: 4 });
  useUpdate((dt) => { move(0, 120 * dt); });
  return <Entity><Tilemap map="testing-floor" solid /><Entity transform={{ x, y }} /></Entity>;
}`);
    const t = render(Faller, undefined, { tilemaps: { "testing-floor": FLOOR } });
    t.step(30);
    const drawn = (t.root.children[1] as GameObject).transform;
    assert.equal(drawn.y, 4, "stands on the floor's top (8) minus its height (4)");
  });

  it("finds collisions by itself with collisions on, and places other things in the world", async () => {
    const { Mine } = await build<{ Mine: new (p: { onBoom: () => void }) => GameObject }>(`
interface MineProps { onBoom: () => void }
export function Mine({ onBoom }: MineProps) {
  const { overlapping } = useBody({ x: 0, y: 0, width: 40, height: 40 });
  const s = useMutable({ near: 0 });
  useUpdate(() => { s.near = overlapping("walker").length; });
  return <Collider width={8} height={8} tag="mine" onCollisionEnter={(other) => { if (other.tag === "walker") onBoom(); }} />;
}`);
    let booms = 0;
    const t = render(Mine, { onBoom: () => booms++ }, { collisions: true });
    const walker = t.place({ tag: "walker", x: 30, y: 30, width: 4, height: 4 });
    t.step();
    assert.deepEqual([fields(t).near, booms], [1, 0], "near the mine (in its body's box), not on it");
    walker.transform.x = 2;
    walker.transform.y = 2;
    walker.markChanged(); // a transform written outside a render says so, as anywhere in the runtime
    t.step();
    assert.equal(booms, 1, "stepping onto it is a contact, found by the step itself");
    t.remove(walker);
    t.step();
    assert.equal(fields(t).near, 0);
  });
});
