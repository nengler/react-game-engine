import assert from "node:assert/strict";
/**
 * Statements in the component body (DESIGN.md, "Statements in the component body"): `let`, loops and a local list built up, as a React render
 * would, worked out again only when what they read changes.
 */
import { after, describe, it } from "node:test";

import { Entity, Text, World, Sprite } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const INVENTORY = `
interface Item { id: string; name: string; count: number }
interface Row { id: string; label: string }
interface InventoryProps { items: Item[] }
export function Inventory({ items }: InventoryProps) {
  const s = useMutable({ title: "Bag" });
  const rows: Row[] = [];
  let total = 0;
  for (const item of items) {
    if (item.count === 0) continue;
    rows.push({ id: item.id, label: \`\${item.name} x\${item.count}\` });
    total += item.count;
  }
  const heading = \`\${s.title} (\${total})\`;
  useInput((input) => {
    if (input.pressed("Space")) s.title = "Pack";
  });
  return (
    <Entity>
      <Text>{heading}</Text>
      {rows.map((row) => <Text key={row.id}>{row.label}</Text>)}
    </Entity>
  );
}`;

describe("statements in the component body", () => {
  it("computes a list and a total with a loop, and follows its props", async () => {
    const compiled = compile(INVENTORY);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /\$memo\("\$block1"/, "the statements are one memo");
    type P = { items: { id: string; name: string; count: number }[] };
    const { Inventory } = await load<{ Inventory: new (p: P) => Entity & { updateProps(p: P): void } }>(compiled);
    const world = new World();
    const inventory = new Inventory({
      items: [
        { id: "a", name: "Key", count: 1 },
        { id: "b", name: "Leaf", count: 0 },
        { id: "c", name: "Bell", count: 2 },
      ],
    });
    world.mount(inventory);
    world.flush();
    const texts = (): string[] => inventory.children.map((c) => (c as Text).text);
    assert.deepEqual(texts(), ["Bag (3)", "Key x1", "Bell x2"]);
    inventory.updateProps({ items: [{ id: "b", name: "Leaf", count: 4 }] });
    world.flush();
    assert.deepEqual(texts(), ["Bag (4)", "Leaf x4"]);
  });

  it("is worked out again only when what it reads changes", async () => {
    const compiled = compile(`
interface P { n: number }
export function Counter({ n }: P) {
  const s = useMutable({ other: 0 });
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += i;
  useUpdate(() => { s.other += 1; });
  return <Text>{\`\${sum} \${s.other}\`}</Text>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Counter } = await load<{ Counter: new (p: { n: number }) => Text & { updateProps(p: { n: number }): void } }>(compiled);
    const world = new World();
    const counter = new Counter({ n: 3 });
    // Count the block's runs: every memo goes through `$memo(key, deps, compute)`.
    let runs = 0;
    const memo = (counter as unknown as { $memo: (key: string, deps: unknown[], compute: () => unknown) => unknown }).$memo.bind(counter);
    (counter as unknown as { $memo: unknown }).$memo = (key: string, deps: unknown[], compute: () => unknown) =>
      memo(key, deps, () => {
        runs++;
        return compute();
      });
    world.mount(counter);
    world.flush();
    assert.equal(counter.text, "6 0");
    const first = runs;
    // `other` changes every step; the block reads only `n`, so it does not run again.
    world.tick(1 / 60);
    world.flush();
    assert.equal(counter.text, "6 1");
    assert.equal(runs, first, "not run again for a change it does not read");
    counter.updateProps({ n: 4 });
    world.flush();
    assert.equal(counter.text, "10 1");
    assert.equal(runs, first + 1);
  });
});

describe("what statements in the body may not do", () => {
  const codes = (body: string) =>
    compileErrors(`function C() {
  const s = useMutable({ n: 0, r: 0 });
  const playHit = useSound("hit.wav");
  ${body}
  return <Entity />;
}`).map((d) => d.code);

  it("sets no state, plays no sound and reads no ref, since it runs during render", () => {
    assert.deepEqual(codes("let x = 0; s.n = 1;"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("let x = 0; playHit();"), [DiagnosticCode.InvalidComponentBody]);
    assert.ok(codes("let x = r.current;").length > 0);
  });

  it("does not return early", () => {
    assert.deepEqual(codes("if (s.n > 1) { return; }"), [DiagnosticCode.InvalidComponentBody]);
  });
});

describe("derived values: destructured, and worked out once", () => {
  const SOURCE = `
export const CALLS = { hero: 0 };
interface Hero { x: number; y: number; frame: number; }
function heroOf(step: number): Hero {
  CALLS.hero++;
  return { x: step * 2, y: step * 3, frame: step % 4 };
}

export function Walker() {
  const s = useMutable({ step: 1, blink: false });
  const { x, y, frame: f } = heroOf(s.step);
  const [first, , third] = [x, y, f];
  return (
    <Entity name={s.blink ? "on" : "off"}>
      <Sprite image="hero.png" frame={f} x={x} y={y} />
      <Text>{\`\${first} \${third}\`}</Text>
    </Entity>
  );
}`;

  it("reads members of one value, worked out again only when what it reads changes", async () => {
    const compiled = compile(SOURCE);
    assert.match(compiled.code, /this\.\$memo\("x,y,f", \[this\.\$s_step\], \(\) => heroOf\(this\.\$s_step\)\)/);
    assert.deepEqual(typeCheck(compiled), []);
    const { Walker, CALLS } = await load<{ Walker: new () => Entity & { s: { [field: string]: unknown } }; CALLS: { hero: number } }>(
      compiled
    );
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    world.flush();
    const sprite = walker.children[0] as Sprite;
    assert.deepEqual([sprite.transform.x, sprite.transform.y, sprite.frame, (walker.children[1] as Text).text], [2, 3, 1, "2 1"]);
    assert.equal(CALLS.hero, 1, "three uses, one call");
    walker.s.blink = true;
    world.flush();
    assert.equal(walker.name, "on");
    assert.equal(CALLS.hero, 1, "a render that changes nothing it reads does not call it again");
    walker.s.step = 2;
    world.flush();
    assert.deepEqual([sprite.transform.x, sprite.frame], [4, 2]);
    assert.equal(CALLS.hero, 2);
  });

  it("refuses a default, a rest or a nested pattern", () => {
    for (const pattern of ["{ x = 1 }", "{ ...rest }", "{ a: { b } }", "[a, ...rest]"]) {
      const errors = compileErrors(
        `interface P { v: { x: number; a: { b: number } }; l: number[] } export function A({ v, l }: P) { const ${pattern} = ${pattern.startsWith("[") ? "l" : "v"}; return <Entity />; }`
      );
      assert.equal(errors[0]?.code, DiagnosticCode.InvalidComponentBody, pattern);
    }
  });
});
