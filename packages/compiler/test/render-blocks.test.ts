/**
 * Statements in the component body (REACT_FEEL_PLAN.md, A1 step c): `let`, loops and a local list built up, as a React render
 * would, worked out again only when what they read changes.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Text, World } from "@rge/runtime";
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
  const [title, setTitle] = useState("Bag");
  const rows: Row[] = [];
  let total = 0;
  for (const item of items) {
    if (item.count === 0) continue;
    rows.push({ id: item.id, label: \`\${item.name} x\${item.count}\` });
    total += item.count;
  }
  const heading = \`\${title} (\${total})\`;
  useInput((input) => {
    if (input.pressed("Space")) setTitle("Pack");
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
    const inventory = new Inventory({ items: [{ id: "a", name: "Key", count: 1 }, { id: "b", name: "Leaf", count: 0 }, { id: "c", name: "Bell", count: 2 }] });
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
  const [other, setOther] = useState(0);
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += i;
  useUpdate(() => setOther((o) => o + 1));
  return <Text>{\`\${sum} \${other}\`}</Text>;
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
  const [n, setN] = useState(0);
  const playHit = useSound("hit.wav");
  const r = useRef(0);
  ${body}
  return <Entity />;
}`).map((d) => d.code);

  it("sets no state, plays no sound and reads no ref, since it runs during render", () => {
    assert.deepEqual(codes("let x = 0; setN(1);"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("let x = 0; playHit();"), [DiagnosticCode.InvalidComponentBody]);
    assert.ok(codes("let x = r.current;").length > 0);
  });

  it("does not return early", () => {
    assert.deepEqual(codes("if (n > 1) { return; }"), [DiagnosticCode.InvalidComponentBody]);
  });
});
