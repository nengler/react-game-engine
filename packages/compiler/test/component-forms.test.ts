/**
 * Component forms and roots (DESIGN.md, "Roots and component forms"): arrow-function and default-exported components, a
 * fragment or a built-in as the root, and a component whose root is another component, a condition or null.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { Collider, Entity, Sprite, World, Flex, Shape, Text } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import {
  cleanOutput,
  closeCompiler,
  compile,
  compileErrors,
  compileProject,
  getCompiler,
  load,
  loadProject,
  typeCheck,
  typeCheckProject,
} from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("component forms", () => {
  it("compiles an arrow-function component with props, hooks and state like a function declaration", async () => {
    const { Badge } = await load<{ Badge: new (props: { label: string; step?: number }) => Entity & { s: { n: number } } }>(
      compile(`interface BadgeProps { label: string; step?: number }
export const Badge = ({ label, step = 2 }: BadgeProps) => {
  const s = useMutable({ n: 0 });
  useUpdate(() => { s.n += step; });
  return <Entity name={label} />;
};`)
    );
    const world = new World();
    const badge = new Badge({ label: "b" });
    world.mount(badge);
    world.tick(1);
    assert.deepEqual([badge.name, badge.s.n], ["b", 2]);
  });

  it("compiles an arrow with an expression body, which can hold no hooks", async () => {
    const compiled = compile(`const Dot = () => <Sprite image="dot.png" />;
const Pair = () => (<Entity name="pair"><Dot /><Dot /></Entity>);`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Pair } = await load<{ Pair: new () => Entity }>(compiled);
    assert.equal(new Pair().children.length, 2);
  });

  it("supports a default export, as a declaration or as `export default Name;`", () => {
    const declaration = compile(`export default function Enemy() { return <Entity name="E" />; }`);
    assert.equal(declaration.ir.components[0]!.isDefaultExport, true);
    assert.match(declaration.code, /export class Enemy extends Entity \{[\s\S]*\}\n\nexport default Enemy;\n\nexport const prefabs = \{/);
    const separate = compile(`const Enemy = () => <Entity name="E" />;\nexport default Enemy;`);
    assert.equal(separate.ir.components[0]!.isDefaultExport, true);
    assert.deepEqual(typeCheck(separate), []);
  });

  it("imports a default export under any local name, alone or with named imports", async () => {
    const project = compileProject({
      "Enemy.tsx": `interface EnemyProps { speed: number }
export default function Enemy({ speed }: EnemyProps) { return <Entity name="E" x={speed} />; }
export function Boss() { return <Entity name="B" />; }`,
      "Level.tsx": `import Monster, { Boss } from "./Enemy.tsx";
export function Level() {
  return <Entity name="L"><Monster speed={4} /><Boss /></Entity>;
}`,
    });
    assert.match(project["Level.tsx"]!.code, /^import Monster, \{ Boss \} from "\.\/Enemy\.ts";$/m);
    assert.deepEqual(typeCheckProject(project), []);
    const { Level } = await loadProject<{ Level: new () => Entity & { monster: Entity } }>(project, "Level.tsx");
    const level = new Level();
    assert.equal(level.monster.transform.x, 4);
  });

  it("rejects forms it cannot name or place", () => {
    assert.deepEqual(codes(`export default function () { return <Entity />; }`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`let Dot = () => <Entity />;`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`const Dot = () => 5;`), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes(`export default Missing;`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`function A() { return <Entity />; } function B() { return <Entity />; } export default A; export default B;`), [
      DiagnosticCode.UnsupportedSyntax,
    ]);
    assert.deepEqual(codes(`let x = 5;`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`const x = <Entity />;`), [DiagnosticCode.UnsupportedSyntax]);
  });

  function codes(source: string): string[] {
    return compileErrors(source).map((d) => d.code);
  }
});

describe("roots", () => {
  it("lowers a fragment root to an implicit container, without needing Entity imported", async () => {
    const source = `import { useMutable, Sprite } from "@tsengine/runtime/jsx";
function Pair() {
  const s = useMutable({ on: true });
  return (<>
    <Sprite image="a.png" />
    {s.on && <Sprite image="b.png" />}
  </>);
}`;
    const result = getCompiler().compile("Pair.tsx", source);
    assert.ok(result.ok, "no import of Entity is required");
    const root = result.ir.components[0]!.root;
    assert.deepEqual([root.component.name, root.props.length, root.transform.length], ["Entity", 0, 0]);
    assert.match(result.code, /export class Pair extends Entity \{/);
    assert.match(result.code, /super\(\{ name: "Pair" \}\);/);
    assert.deepEqual(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/Pair.tsx`, text: source }]), []);
  });

  it("lets a component be a Sprite, with no container around it", async () => {
    const compiled = compile(`interface CoinProps { value: number }
function Coin({ value }: CoinProps) {
  const s = useMutable({ spin: 0 });
  useUpdate(() => { s.spin += value; });
  return <Sprite image={s.spin > 5 ? "gold.png" : "coin.png"} />;
}
function Level() { return <Entity name="L" x={10}><Coin value={3} /></Entity>; }`);
    assert.match(compiled.code, /export class Coin extends Sprite<CoinProps> \{/);
    assert.match(
      compiled.code,
      /super\(\{ image: undefined as never \}, props\);/,
      "a dynamic image gets a placeholder; render() sets the real one"
    );
    assert.deepEqual(typeCheck(compiled), []);
    const { Coin, Level } = await load<{ Coin: new (props: { value: number }) => Sprite & { spin: number }; Level: new () => Entity }>(
      compiled
    );
    const world = new World();
    const level = new Level();
    world.mount(level);
    const coin = level.children[0] as Sprite & { spin: number };
    assert.ok(coin instanceof Coin && coin instanceof Sprite);
    assert.equal(coin.image, "coin.png");
    world.tick(1);
    world.tick(1);
    assert.equal(coin.image, "gold.png");
    assert.equal(coin.worldTransform().x, 10, "placed by its parent, like any component");
  });

  it("passes a static image straight to the Sprite constructor", () => {
    const { code } = compile(`const Dot = () => <Sprite image="dot.png" x={3} />;`);
    assert.match(code, /super\(\{ image: "dot\.png" \}\);/);
    assert.match(code, /this\.transform\.x = 3;/);
  });

  it("lets a component be a Collider whose callback is set after super()", async () => {
    const compiled = compile(`function Trap() {
  const s = useMutable({ touches: 0 });
  return <Collider width={10} height={10} onCollisionEnter={() => { s.touches += 1; }} />;
}`);
    assert.match(compiled.code, /export class Trap extends Collider \{/);
    assert.match(
      compiled.code,
      /super\(\{ width: 10, height: 10 \}\);\n\s+this\.onCollisionEnter = \(\) => \{ this\.\$set_s_touches/,
      "an arrow that uses `this` cannot be made inside the super() call"
    );
    assert.deepEqual(typeCheck(compiled), []);
    const { Trap } = await load<{ Trap: new () => Collider & { s: { touches: number } } }>(compiled);
    const world = new World();
    const trap = new Trap();
    world.mount(trap);
    world.reportCollision(trap, new Collider({ width: 1, height: 1 }));
    world.flush();
    assert.equal(trap.s.touches, 1);
  });

  it("keeps the root's own fields free of state, refs and props", () => {
    // Since 2026-11-13 a name the root built-in has is the author's to use: a mutable of that name is kept as `$name`.
    for (const [root, field] of [
      ['Sprite image="a"', "image"],
      ["Collider width={1} height={1}", "width"],
      ["Entity", "name"],
    ] as const) {
      assert.ok(
        compile(`function A() { const ${field} = useMutable({ n: 0 }); return <${root} />; }`).code.includes(`get $${field}()`),
        `${root}: ${field}`
      );
    }
    // A name of a different built-in is free.
    assert.ok(
      compile(`function A() { const image = useMutable({ n: 0 }); return <Collider width={1} height={1} />; }`).code.includes("get image()")
    );
  });

  it("takes a component as a root (a see-through container), and rejects children on a leaf built-in (a nested fragment is an implicit Entity)", () => {
    const run = (source: string) => compileErrors(source).map((d) => d.code);
    assert.match(
      compile(`function B() { return <Entity />; } function A() { return <B />; }`).code,
      /class A extends Entity \{\s+static readonly managed = true;\s+protected override readonly reportsChanges = true;\s+override readonly layoutContents = true;/
    );
    assert.deepEqual(run(`function A() { return <Sprite image="a"><Entity /></Sprite>; }`), [DiagnosticCode.UnsupportedJsxChild]);
    assert.deepEqual(run(`function A() { return <Entity><Collider width={1} height={1}><Entity /></Collider></Entity>; }`), [
      DiagnosticCode.UnsupportedJsxChild,
    ]);
    assert.ok(compile(`function A() { return <Entity><><Sprite image="a" /></></Entity>; }`).code.includes("new Entity()"));
  });
});

describe("a component whose root is another component, a condition or null", () => {
  it("is a container layout sees through, holding that component, which gets {children} and props", async () => {
    const project = compileProject({
      "Panel.tsx": `
interface PanelProps { title: string; children: Child; }
export function Panel({ title, children }: PanelProps) {
  return <Flex direction="column" width="grow"><Text size={8}>{title}</Text>{children}</Flex>;
}`,
      "Menu.tsx": `
import { Panel } from "./Panel.tsx";
interface MenuProps { title: string; }
export function Menu({ title }: MenuProps) {
  return <Panel title={title}><Text size={8}>item</Text></Panel>;
}`,
    });
    assert.deepEqual(typeCheckProject(project), []);
    assert.match(project["Menu.tsx"]!.code, /override readonly layoutContents = true;/);
    const { Menu } = await loadProject<{ Menu: new (p: { title: string }) => Entity & { updateProps(p: { title: string }): void } }>(
      project,
      "Menu.tsx"
    );
    const world = new World();
    const menu = new Menu({ title: "BUILD" });
    world.mount(menu);
    world.flush();
    assert.equal(menu.layoutContents, true);
    const panel = menu.children[0] as Flex;
    assert.ok(panel instanceof Flex);
    assert.deepEqual(
      panel.children.map((c) => (c as Text).text),
      ["BUILD", "item"]
    );
    menu.updateProps({ title: "SELL" });
    world.flush();
    assert.equal((panel.children[0] as Text).text, "SELL");
  });

  it("renders a condition of elements, or nothing", async () => {
    const compiled = compile(
      `
interface FlashProps { on: boolean; big: boolean; }
export function Flash({ on, big }: FlashProps) {
  return on ? <Text size={big ? 16 : 8}>on</Text> : null;
}
export function Spark({ on }: FlashProps) {
  return on && <Text size={8}>spark</Text>;
}
export function Either({ on }: FlashProps) {
  return on ? <Text size={8}>yes</Text> : <Shape kind="rect" width={2} height={2} />;
}
export function Nothing() {
  return null;
}`,
      "Flash.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    type C = new (p?: { on: boolean; big: boolean }) => Entity & { updateProps(p: { on: boolean; big: boolean }): void };
    const { Flash, Spark, Either, Nothing } = await load<{ Flash: C; Spark: C; Either: C; Nothing: C }>(compiled);
    const world = new World();
    const flash = new Flash({ on: false, big: true });
    const spark = new Spark({ on: true, big: false });
    const either = new Either({ on: true, big: false });
    const nothing = new Nothing();
    for (const c of [flash, spark, either, nothing]) world.mount(c);
    world.flush();
    assert.equal(flash.children.length, 0);
    assert.deepEqual(
      spark.children.map((c) => (c as Text).text),
      ["spark"]
    );
    assert.ok(either.children[0] instanceof Text);
    assert.equal(nothing.children.length, 0);
    flash.updateProps({ on: true, big: true });
    either.updateProps({ on: false, big: false });
    world.flush();
    assert.equal((flash.children[0] as Text).size, 16);
    assert.ok(either.children[0] instanceof Shape);
    assert.equal(either.children.length, 1);
  });
});
