/**
 * Keyed lists in JSX: `{items.map((e) => <El key={e.id} ... />)}` builds, updates, removes and reorders instances by key, between
 * the static siblings. Also conditionals in a list's map and a list's items computed in the component. Children and conditions
 * inside list items are in list-item-children.test.ts, a list inside a list item in nested-lists.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, Sprite, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import {
  cleanOutput,
  closeCompiler,
  compile,
  compileErrors,
  getCompiler,
  load,
  typeCheck,
  withAuthoringImports as withAuthoring,
  elementOf,
  component,
  codes,
} from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const PACK = `
interface EnemyData {
  id: string;
  speed: number;
}

interface EnemyProps {
  speed: number;
  onDefeated?: () => void;
}

function Enemy({ speed, onDefeated }: EnemyProps) {
  return <Entity name="Enemy" x={speed} />;
}

function Pack() {
  const s = useMutable({ enemies: [] as EnemyData[], defeated: "", showBoss: false });
  return (
    <Entity name="Pack">
      <Sprite image="bg.png" />
      {s.enemies.map((e) => (
        <Enemy
          key={e.id}
          speed={e.speed}
          onDefeated={() => {
            s.defeated = \`\${e.id}@\${e.speed}\`;
            s.enemies = s.enemies.filter((x) => x.id !== e.id);
          }}
        />
      ))}
      <Sprite image="fg.png" />
      {s.showBoss && (
        <Entity name="Boss">
          {s.enemies.filter((e) => e.speed > 5).map((e, i) => <Sprite key={e.id} image={e.id + ".png"} x={i * 10} />)}
        </Entity>
      )}
    </Entity>
  );
}
`;

interface EnemyBInstance extends Entity {
  props: { speed: number; onDefeated?: () => void };
}
interface PackInstance extends Entity {
  readonly enemyItems: Map<string | number, EnemyBInstance>;
  readonly sprite: Sprite;
  readonly sprite2: Sprite;
  entity: Entity | null;
  readonly sprite3Items: Map<string | number, Sprite>;
  s: { enemies: EnemyData2[]; defeated: string; showBoss: boolean };
}
interface EnemyData2 {
  id: string;
  speed: number;
}

let Pack: new () => PackInstance;

before(async () => {
  ({ Pack } = await load<{ Pack: typeof Pack }>(compile(PACK, "Pack.tsx")));
});

/** A mounted Pack holding `enemies`. */
function pack(enemies: EnemyData2[] = []): { world: World; pack: PackInstance } {
  const world = new World();
  const p = new Pack();
  world.mount(p);
  p.s.enemies = enemies;
  world.flush();
  return { world, pack: p };
}

const ids = (p: PackInstance): string[] => p.children.map((c) => (c instanceof Sprite ? c.image : `${(c as EnemyBInstance).props.speed}`));

describe("keyed lists: IR shape", () => {
  it("lowers a map over state to a KeyedListChild", () => {
    const c = component(PACK, "Pack");
    const list = c.root.children[1]!;
    assert.equal(list.kind, "KeyedListChild");
    if (list.kind !== "KeyedListChild") return;
    assert.deepEqual(list.source, { kind: "StateRead", state: "Pack.s.enemies" });
    assert.deepEqual(list.dependencies, [{ kind: "State", state: "Pack.s.enemies" }]);
    assert.equal(list.item.name, "e");
    assert.equal(list.index, null);
    assert.deepEqual(list.key, {
      kind: "MemberRead",
      object: { kind: "ParamRead", param: list.item.id, name: "e" },
      name: "id",
      optional: false,
    });
    assert.equal(list.element.fieldName, "enemy");
    const speed = list.element.props.find((p) => p.name === "speed");
    assert.deepEqual(
      speed && speed.kind === "DynamicProp" && speed.dependencies,
      [{ kind: "Item" }],
      "a prop that reads the item is re-applied per item"
    );
    assert.equal(list.element.props.find((p) => p.name === "onDefeated")?.kind, "CallbackProp");
  });

  it("takes a filtered source and an index", () => {
    const c = component(PACK, "Pack");
    const boss = elementOf(c.root.children[3]!);
    const list = boss.children[0]!;
    assert.ok(list.kind === "KeyedListChild");
    assert.equal(list.source.kind, "Call");
    assert.equal(list.index?.name, "i");
    const x = list.element.transform.find((p) => p.name === "x");
    assert.deepEqual(x?.kind === "DynamicProp" && x.dependencies, [{ kind: "Item" }]);
  });

  it("takes a prop as the source", () => {
    const c = component(
      `interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  return <Entity name="C">{items.map((it) => <Sprite key={it.id} image={it.id} />)}</Entity>;
}`,
      "C"
    );
    const list = c.root.children[0]!;
    assert.ok(list.kind === "KeyedListChild");
    assert.deepEqual(list.dependencies, [{ kind: "Prop", name: "items" }]);
  });
});

describe("keyed lists: generated code", () => {
  it("keeps the instances in a map and the key order in a private field", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /readonly enemyItems: Map<string \| number, Enemy> = new Map\(\);/);
    assert.match(code, /#enemyOrder: \(string \| number\)\[\] = \[\];/);
    assert.match(
      code,
      /#enemyRecords: Map<string \| number, \{ current: Pack\["\$s_enemies"\]\[number\] \}> = new Map\(\);/,
      "a callback reads the item"
    );
    assert.doesNotMatch(code, /#sprite3Records/, "no callback reads the item: no records");
  });

  it("checks keys first, then updates, adds at (slot, position), removes and reorders", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /const \$keys = \$list\.map\(\(e\) => e\.id\);/);
    assert.match(code, /throw new Error\("Duplicate key " \+ JSON\.stringify\(\$key\) \+ " in the <Enemy> list of Pack\."\)/);
    assert.match(code, /\$parent\.queueAddChild\(\$item, 1, \$n\);/);
    assert.match(code, /\$item\.updateProps\(\{ speed: e\.speed \}\);/);
    assert.match(code, /\$parent\.queueRemoveChild\(\$item\);/);
    assert.match(code, /\$parent\.queueReorder\(1, \$keys\.map\(\(\$k\) => this\.enemyItems\.get\(\$k\)!\)\);/);
    assert.match(code, /this\.addChild\(this\.sprite2, 2\);/, "static siblings get slots");
  });

  it("names the index in the key's callback only when the key reads it: a game may check its generated code for unused parameters", () => {
    // The boss's list is `(e, i) => <Sprite key={e.id} … x: i * 10 />`: the index places the item, the key does not read it.
    const { code } = compile(PACK, "Pack.tsx");
    assert.doesNotMatch(code, /\$list\.map\(\(e, i\) =>/);
    assert.match(code, /for \(let i = 0; i < \$list\.length; i\+\+\) \{\s*const e = \$list\[i\]!;/, "the loop that reads it still has it");
    const byIndex = getCompiler().compile(
      "C.tsx",
      withAuthoring(`interface Item { id: string }
function C() {
  const s = useMutable({ items: [] as Item[] });
  return <Entity name="C">{s.items.map((e, i) => <Sprite key={i} image={e.id} />)}</Entity>;
}`)
    );
    assert.match(byIndex.ok ? byIndex.code : "", /const \$keys = \$list\.map\(\(e, i\) => i\);/, "a key that is the index names it");
  });

  it("reads the current item inside a callback, through a holder the item keeps", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /const \$rec = \{ current: e \};/);
    assert.match(code, /this\.#enemyRecords\.set\(\$key, \$rec\);/);
    assert.match(code, /this\.#enemyRecords\.get\(\$key\)!\.current = e;/, "refreshed on every render");
    assert.match(code, /this\.\$set_s_defeated\(`\$\{\$rec\.current\.id\}@\$\{\$rec\.current\.speed\}`\);/);
    assert.match(code, /this\.#\$s_enemiesNext\.filter\(\(x\) => x\.id !== \$rec\.current\.id\)/);
  });

  it("empties a list when its conditional subtree unmounts", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /this\.entity = null;\n\s+this\.sprite3Items\.clear\(\);\n\s+this\.#sprite3Order = \[\];/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(PACK, "Pack.tsx")), []);
  });

  it("type-checks authored source with a list", () => {
    const source = `import { useMutable, Entity, Sprite } from "@tsengine/runtime/jsx";
interface Item { id: string; n: number }
function C() {
  const s = useMutable({ items: [] as Item[] });
  return <Entity name="C">{s.items.map((e, i) => <Sprite key={e.id} image={e.id} x={i * e.n} />)}</Entity>;
}`;
    assert.ok(getCompiler().compile("C.tsx", source).ok);
    assert.deepEqual(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5bSource.tsx`, text: source }]), []);
  });
});

describe("keyed lists: runtime behaviour", () => {
  it("adds items by key between the static siblings", () => {
    const { pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
    ]);
    assert.deepEqual(ids(p), ["bg.png", "1", "2", "fg.png"]);
    assert.deepEqual([...p.enemyItems.keys()], ["a", "b"]);
  });

  it("updates an item in place; an unchanged item keeps its identity and is not re-rendered", () => {
    const { world, pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
    ]);
    const [a, b] = [p.enemyItems.get("a")!, p.enemyItems.get("b")!];
    const renders = { a: 0, b: 0 };
    for (const [name, item] of [
      ["a", a],
      ["b", b],
    ] as const) {
      const render = item.render.bind(item);
      item.render = () => {
        renders[name]++;
        render();
      };
    }
    p.s.enemies = [
      { id: "a", speed: 1 },
      { id: "b", speed: 5 },
    ];
    assert.equal(world.flush(), 2, "the pack and the changed item render once each");
    assert.deepEqual(renders, { a: 0, b: 1 });
    assert.equal(p.enemyItems.get("a"), a);
    assert.equal(p.enemyItems.get("b"), b);
    assert.equal(b.props.speed, 5);
    assert.equal(b.transform.x, 5, "the item's own JSX followed its prop");
  });

  it("removes items whose key is gone", () => {
    const { world, pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
      { id: "c", speed: 3 },
    ]);
    const b = p.enemyItems.get("b")!;
    p.s.enemies = [
      { id: "a", speed: 1 },
      { id: "c", speed: 3 },
    ];
    world.flush();
    assert.deepEqual(ids(p), ["bg.png", "1", "3", "fg.png"]);
    assert.equal(b.parent, null);
    assert.equal(b.world, null);
    assert.equal(p.enemyItems.has("b"), false);
  });

  it("reorders by key, keeping instances, with static siblings in place", () => {
    const { world, pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
      { id: "c", speed: 3 },
    ]);
    const before = [...p.enemyItems.values()];
    p.s.enemies = [
      { id: "c", speed: 3 },
      { id: "x", speed: 9 },
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
    ];
    world.flush();
    assert.deepEqual(ids(p), ["bg.png", "3", "9", "1", "2", "fg.png"]);
    assert.ok(
      before.every((item) => [...p.enemyItems.values()].includes(item)),
      "same instances"
    );
    assert.equal(p.children[0], p.sprite);
    assert.equal(p.children.at(-1), p.sprite2);
  });

  it("updates the items' props when the keys are the same as last render, and still catches a duplicate after that", () => {
    const { world, pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
    ]);
    const before = [...p.enemyItems.values()];
    // The same keys in the same order: the bookkeeping is skipped, the props are not.
    p.s.enemies = [
      { id: "a", speed: 5 },
      { id: "b", speed: 6 },
    ];
    world.flush();
    assert.deepEqual(ids(p), ["bg.png", "5", "6", "fg.png"]);
    assert.deepEqual([...p.enemyItems.values()], before, "same instances, same order");
    p.s.enemies = [
      { id: "a", speed: 5 },
      { id: "a", speed: 6 },
    ];
    assert.throws(() => world.flush(), /Duplicate key "a" in the <Enemy> list of Pack/);
  });

  it("throws on a duplicate key without changing the list", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }]);
    const a = p.enemyItems.get("a");
    p.s.enemies = [
      { id: "a", speed: 1 },
      { id: "a", speed: 2 },
    ];
    assert.throws(() => world.flush(), /Duplicate key "a" in the <Enemy> list of Pack/);
    assert.deepEqual([...p.enemyItems.keys()], ["a"]);
    assert.equal(p.enemyItems.get("a"), a);
  });

  it("gives a callback the item's current value, not the one it was created with", () => {
    const { world, pack: p } = pack([
      { id: "a", speed: 1 },
      { id: "b", speed: 2 },
    ]);
    p.s.enemies = [
      { id: "a", speed: 7 },
      { id: "b", speed: 2 },
    ];
    world.flush();
    p.enemyItems.get("a")!.props.onDefeated!();
    world.flush();
    assert.equal(p.s.defeated, "a@7");
    assert.deepEqual(p.s.enemies, [{ id: "b", speed: 2 }]);
    assert.deepEqual(ids(p), ["bg.png", "2", "fg.png"]);
  });

  it("renders a filtered list inside a conditional, and starts it afresh when it remounts", () => {
    const { world, pack: p } = pack([
      { id: "slow", speed: 1 },
      { id: "fast", speed: 8 },
      { id: "faster", speed: 9 },
    ]);
    p.s.showBoss = true;
    world.flush();
    const boss = p.entity!;
    assert.deepEqual(
      boss.children.map((c) => [(c as Sprite).image, c.transform.x]),
      [
        ["fast.png", 0],
        ["faster.png", 10],
      ]
    );
    p.s.enemies = [
      { id: "faster", speed: 9 },
      { id: "fast", speed: 8 },
    ];
    world.flush();
    assert.deepEqual(
      boss.children.map((c) => [(c as Sprite).image, c.transform.x]),
      [
        ["faster.png", 0],
        ["fast.png", 10],
      ],
      "the index follows the order"
    );
    p.s.showBoss = false;
    world.flush();
    assert.equal(p.entity, null);
    assert.equal(p.sprite3Items.size, 0);
    p.s.showBoss = true;
    world.flush();
    assert.notEqual(p.entity, boss);
    assert.deepEqual(
      p.entity!.children.map((c) => (c as Sprite).image),
      ["faster.png", "fast.png"]
    );
  });

  it("builds the list in the constructor from a prop", async () => {
    const { C } = await load<{ C: new (props: { items: { id: string }[] }) => Entity }>(
      compile(`interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  return <Entity name="C">{items.map((it) => <Sprite key={it.id} image={it.id} />)}</Entity>;
}`)
    );
    const c = new C({ items: [{ id: "a" }, { id: "b" }] });
    assert.deepEqual(
      c.children.map((s) => (s as Sprite).image),
      ["a", "b"]
    );
  });
});

describe("keyed lists: diagnostics", () => {
  const list = (
    item: string,
    state = `const s = useMutable({ items: [] as Item[] });\n  const items = s.items;`
  ) => `interface Item { id: string; n: number }
function C() {
  ${state}
  return <Entity name="C">{${item}}</Entity>;
}`;
  const listCodes = (item: string, state?: string) => codes(list(item, state));

  it("requires a key that reads the item", () => {
    assert.deepEqual(listCodes(`items.map((e) => <Sprite image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <Sprite key="k" image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <Sprite key={1} image={e.id} />)`), [DiagnosticCode.InvalidList]);
  });

  it("warns about an index key, but compiles it", () => {
    const result = getCompiler().compile("C.tsx", withAuthoring(list(`items.map((e, i) => <Sprite key={i} image={e.id} />)`)));
    assert.ok(result.ok);
    assert.deepEqual(
      result.diagnostics.map((d) => [d.code, d.severity]),
      [[DiagnosticCode.InvalidList, "warning"]]
    );
  });

  it("takes one element from an inline arrow", () => {
    // `cond && <El/>` and `cond ? <A/> : <B/>` are allowed now: see "conditionals in a list's map" below.
    assert.deepEqual(listCodes(`items.map((e) => e.n > 0 || <Sprite key={e.id} image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <><Sprite key={e.id} image={e.id} /></>)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => { const x = 1; return <Sprite key={e.id} image={e.id} />; })`), [
      DiagnosticCode.InvalidList,
    ]);
    // Children on an item, nested and conditional, are allowed now (list-item-children.test.ts), and so is a list inside an item (nested-lists.test.ts).
    assert.doesNotThrow(() =>
      compile(list(`items.map((e) => <Entity key={e.id}><Entity name="x"><Sprite image={e.id} /></Entity></Entity>)`))
    );
    assert.doesNotThrow(() =>
      compile(list(`items.map((e) => <Entity key={e.id}>{items.map((f) => <Sprite key={f.id} image={f.id} />)}</Entity>)`))
    );
    assert.deepEqual(listCodes(`items.map()`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map(({ id }) => <Sprite key={id} image={id} />)`), [DiagnosticCode.InvalidList]);
    assert.doesNotThrow(
      () => compile(list(`items.map((e) => { return <Sprite key={e.id} image={e.id} />; })`)),
      "a block with one return is fine"
    );
  });

  it("takes any array the component can compute, but not through `?.`", () => {
    for (const source of [
      `[{ id: "a" }, { id: "b" }]`,
      `items.slice(1)`,
      `items.map((e) => ({ id: e.id, n: e.n * 2 }))`,
      `items.filter((e) => e.n > 0).slice(0, 3)`,
    ]) {
      const compiled = compile(list(`${source}.map((e) => <Sprite key={e.id} image={e.id} />)`));
      assert.match(compiled.code, /\$spriteList\(\) \{ return /, source);
      assert.deepEqual(typeCheck(compiled), [], source);
    }
    assert.deepEqual(listCodes(`items?.map((e) => <Sprite key={e.id} image={e.id} />)`), [DiagnosticCode.InvalidList]);
  });

  it("does not let a callback read the index", () => {
    const P = `interface Item { id: string; n: number }
interface RowProps { onPick: () => void }
function Row({ onPick }: RowProps) { return <Entity name="r" />; }
function C() {
  const s = useMutable({ items: [] as Item[], picked: 0 });
  return <Entity name="C">{s.items.map((e, i) => <Row key={e.id} onPick={() => { s.picked = i; }} />)}</Entity>;
}`;
    assert.deepEqual(codes(P), [DiagnosticCode.InvalidList]);
  });

  it("reserves $ names for generated code", () => {
    assert.deepEqual(listCodes(`items.map(($e) => <Sprite key={$e.id} image={$e.id} />)`), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects key on a component's root (it goes where the component is used); a key on a child is a keyed element", () => {
    assert.deepEqual(codes(`function A() { return <Entity name="A" key="x"><Sprite image="a" /></Entity>; }`), [
      DiagnosticCode.UnsupportedAttribute,
    ]);
    assert.doesNotThrow(() =>
      compile(`function A() { const s = useMutable({ k: 0 }); return <Entity name="A"><Sprite key={s.k} image="a" /></Entity>; }`)
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Conditionals inside a list's map
// ---------------------------------------------------------------------------------------------------------------------------

const COND = `
interface Spot {
  id: number;
  on: boolean;
  x: number;
}

interface DotProps {
  x: number;
}

function Dot({ x }: DotProps) {
  return <Entity name="dot" x={x} />;
}

function Ring({ x }: DotProps) {
  return <Entity name="ring" x={x} />;
}

function Switching() {
  const st = useMutable({
    spots: [{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }, { id: 3, on: true, x: 3 }] as Spot[],
  });
  return <Entity name="Switching">{st.spots.map((s) => (s.on ? <Dot key={s.id} x={s.x} /> : <Ring key={s.id} x={s.x} />))}</Entity>;
}

function Only() {
  const st = useMutable({
    spots: [{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }, { id: 3, on: true, x: 3 }] as Spot[],
  });
  return <Entity name="Only">{st.spots.map((s) => s.on && <Dot key={s.id} x={s.x} />)}</Entity>;
}

function WithNull() {
  const st = useMutable({ spots: [{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }] as Spot[] });
  return <Entity name="WithNull">{st.spots.map((s) => (s.on ? <Dot key={s.id} x={s.x} /> : null))}</Entity>;
}
`;

interface SpotData {
  id: number;
  on: boolean;
  x: number;
}
interface SpotsInstance extends Entity {
  st: { spots: SpotData[] };
}

describe("conditionals in a list's map: runtime", () => {
  let Switching: new () => SpotsInstance;
  let Only: new () => SpotsInstance;
  let WithNull: new () => SpotsInstance;
  before(async () => {
    ({ Switching, Only, WithNull } = await load<{ Switching: typeof Switching; Only: typeof Only; WithNull: typeof WithNull }>(
      compile(COND, "Cond.tsx")
    ));
  });

  const kinds = (e: Entity): string[] => e.children.map((c) => (c as Entity).name);
  const xs = (e: Entity): number[] => e.children.map((c) => c.transform.x);

  it("`cond ? <A/> : <B/>` builds the branch each item is in, in order", () => {
    const world = new World();
    const s = new Switching();
    world.mount(s);
    assert.deepEqual(kinds(s), ["dot", "ring", "dot"]);
    assert.deepEqual(xs(s), [1, 2, 3]);
  });

  it("an item that switches branch keeps its position among its siblings", () => {
    const world = new World();
    const s = new Switching();
    world.mount(s);
    s.st.spots = [
      { id: 1, on: true, x: 1 },
      { id: 2, on: true, x: 2 },
      { id: 3, on: true, x: 3 },
    ];
    world.flush();
    assert.deepEqual(kinds(s), ["dot", "dot", "dot"]);
    assert.deepEqual(xs(s), [1, 2, 3]);
    s.st.spots = [
      { id: 1, on: false, x: 1 },
      { id: 2, on: true, x: 2 },
      { id: 3, on: false, x: 30 },
    ];
    world.flush();
    assert.deepEqual(kinds(s), ["ring", "dot", "ring"]);
    assert.deepEqual(xs(s), [1, 2, 30], "and the new instance has the item's current props");
  });

  it("updates the current branch's props, adds and removes items", () => {
    const world = new World();
    const s = new Switching();
    world.mount(s);
    s.st.spots = [
      { id: 3, on: true, x: 33 },
      { id: 4, on: false, x: 4 },
      { id: 1, on: true, x: 1 },
    ];
    world.flush();
    assert.deepEqual(kinds(s), ["dot", "ring", "dot"]);
    assert.deepEqual(xs(s), [33, 4, 1]);
  });

  it("`cond && <El/>` leaves out the items for which it is false, and brings them in when it turns true", () => {
    const world = new World();
    const o = new Only();
    world.mount(o);
    assert.deepEqual(xs(o), [1, 3]);
    o.st.spots = [
      { id: 1, on: true, x: 1 },
      { id: 2, on: true, x: 2 },
      { id: 3, on: false, x: 3 },
    ];
    world.flush();
    assert.deepEqual(xs(o), [1, 2], "item 2 appears between, item 3 is gone");
  });

  it("`cond ? <A/> : null` is the same as `cond && <A/>`", () => {
    const world = new World();
    const n = new WithNull();
    world.mount(n);
    assert.deepEqual(xs(n), [1]);
  });
});

describe("conditionals in a list's map: generated code and diagnostics", () => {
  const compiled = compile(COND, "Cond.tsx");

  it("lowers a ternary to one list with an alternate element, and `&&` to a condition", () => {
    const sw = compiled.ir.components.find((c) => c.name === "Switching")!.root.children[0]!;
    assert.equal(sw.kind, "KeyedListChild");
    if (sw.kind !== "KeyedListChild") return;
    assert.equal(sw.condition?.kind, "MemberRead");
    assert.equal(sw.alternate?.component.kind, "Local");
    const only = compiled.ir.components.find((c) => c.name === "Only")!.root.children[0]!;
    assert.ok(only.kind === "KeyedListChild" && only.condition !== null && only.alternate === null);
  });

  it("filters the `&&` form and tests the branch of a ternary with the condition itself (so TypeScript narrows it)", () => {
    assert.match(compiled.code, /const \$list = this\.\$st_spots\.filter\(\(s\) => s\.on\);/);
    assert.match(compiled.code, /const \$branch = s\.on \? 0 : 1;/);
    // Each branch's item is given getters that say nothing once it is in the other branch.
    assert.match(compiled.code, /if \(s\.on\) \{\n\s+\$item = this\.withPropGetters\(new Dot\(/);
    assert.match(compiled.code, /if \(!\(s\.on\)\) return undefined; \$assume\(s\.on\);/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("rejects different keys in the two branches", () => {
    const errors = compileErrors(
      `${COND}\nfunction Bad() { const st = useMutable({ spots: [] as Spot[] }); return <Entity name="B">{st.spots.map((s) => (s.on ? <Dot key={s.id} x={1} /> : <Ring key={s.x} x={1} />))}</Entity>; }`
    );
    assert.equal(errors[0]?.code, DiagnosticCode.InvalidList);
    assert.match(errors[0]!.message, /same `key`/);
  });

  it("still rejects a fragment as a branch, and the index in a conditional list", () => {
    const fragment = compileErrors(
      `${COND}\nfunction Bad() { const st = useMutable({ spots: [] as Spot[] }); return <Entity name="B">{st.spots.map((s) => (s.on ? <><Dot key={s.id} x={1} /></> : null))}</Entity>; }`
    );
    assert.equal(fragment[0]?.code, DiagnosticCode.InvalidList);
    const index = compileErrors(
      `${COND}\nfunction Bad() { const st = useMutable({ spots: [] as Spot[] }); return <Entity name="B">{st.spots.map((s, i) => s.on && <Dot key={s.id} x={i} />)}</Entity>; }`
    );
    assert.match(index[0]!.message, /cannot take the index/);
  });
});

describe("a list's items computed in the component", () => {
  const SOURCE = `
interface Enemy { id: string; map: string; kind: "beetle" | "wisp"; x: number; }
interface Run { map: string; enemies: Enemy[]; }
const FRAME = { beetle: 4, wisp: 5 } as const;
function onMap(run: Run): Enemy[] {
  return run.enemies.filter((e) => e.map === run.map);
}

export function Foes() {
  const st = useMutable({
    run: { map: "a", enemies: [{ id: "b1", map: "a", kind: "beetle", x: 1 }, { id: "w1", map: "b", kind: "wisp", x: 2 }] } as Run,
  });
  return (
    <Entity name="Foes">
      <Entity name="byHelper">
        {onMap(st.run).map((e) => <Sprite key={e.id} image="things.png" frame={FRAME[e.kind]} x={e.x} />)}
      </Entity>
      <Entity name="byMember">
        {st.run.enemies.map((e) => ({ id: e.id, frame: FRAME[e.kind] })).map((s) => <Sprite key={s.id} image="things.png" frame={s.frame} />)}
      </Entity>
    </Entity>
  );
}`;

  it("type-checks, and follows the state the computation reads", async () => {
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Foes } = await load<{ Foes: new () => Entity & { st: { [field: string]: unknown } } }>(compiled);
    const world = new World();
    const foes = new Foes();
    world.mount(foes);
    world.flush();
    const frames = (name: string) => (foes.children.find((c) => (c as Entity).name === name)!.children as Sprite[]).map((s) => s.frame);
    assert.deepEqual(frames("byHelper"), [4]);
    assert.deepEqual(frames("byMember"), [4, 5]);
    const beetle = foes.children[0]!.children[0];
    foes.st.run = {
      map: "a",
      enemies: [
        { id: "b1", map: "a", kind: "beetle", x: 9 },
        { id: "w1", map: "a", kind: "wisp", x: 2 },
      ],
    };
    world.flush();
    assert.deepEqual(frames("byHelper"), [4, 5]);
    assert.equal(foes.children[0]!.children[0], beetle, "an item keeps its instance by key");
    assert.equal((beetle as Sprite).transform.x, 9);
  });
});
