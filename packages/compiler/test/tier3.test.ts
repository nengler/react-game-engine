import assert from "node:assert/strict";
/**
 * Tier 3 (docs/TOWER_DEFENSE_PLAN.md): spread props on component elements. `<Enemy {...e} />` spreads for real in the generated
 * code; a named prop after a spread wins; a spread in a keyed list re-renders only the items whose object was replaced.
 */
import { after, before, describe, it } from "node:test";

import { Entity, Pointer, Shape, Text, World } from "@rge/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SPREAD = `
interface BoxProps {
  x: number;
  label: string;
}

function Box({ x, label }: BoxProps) {
  return <Entity name={label} transform={{ x }} />;
}

interface Item {
  id: number;
  x: number;
  label: string;
}

function Row() {
  const s = useMutable({ items: [{ id: 1, x: 10, label: "a" }, { id: 2, x: 20, label: "b" }] as Item[] });
  return <Entity name="Row">{s.items.map((i) => <Box key={i.id} {...i} />)}</Entity>;
}

function Named() {
  const s = useMutable({ o: { x: 1, label: "from-object" } as BoxProps });
  return (
    <Entity name="Named">
      <Box {...s.o} x={9} />
      <Box {...s.o} />
    </Entity>
  );
}

function Fixed() {
  return <Entity name="Fixed"><Box {...{ x: 3, label: "lit" }} /></Entity>;
}
`;

interface BoxInstance extends Entity {
  x: number;
  label: string;
  props: { x: number; label: string };
}
interface RowInstance extends Entity {
  readonly boxItems: Map<number, BoxInstance>;
  s: { items: { id: number; x: number; label: string }[] };
}
interface NamedInstance extends Entity {
  readonly box: BoxInstance;
  readonly box2: BoxInstance;
  s: { [field: string]: unknown };
}

let Row: new () => RowInstance;
let Named: new () => NamedInstance;

before(async () => {
  ({ Row, Named } = await load<{ Row: typeof Row; Named: typeof Named }>(compile(SPREAD, "Spread.tsx")));
});

describe("spread props: IR and generated code", () => {
  const compiled = compile(SPREAD, "Spread.tsx");

  it("lowers a spread to a SpreadProp that keeps its place among the props and depends on what it reads", () => {
    const named = compiled.ir.components.find((c) => c.name === "Named")!;
    const [first, second] = named.root.children.map((c) => elementOf(c));
    assert.deepEqual(
      first!.props.map((p) => p.kind),
      ["SpreadProp", "StaticProp"],
      "the spread, then the named prop that wins over it"
    );
    assert.deepEqual(
      second!.props.map((p) => p.kind),
      ["SpreadProp"]
    );
    const spread = first!.props[0]!;
    assert.deepEqual(spread.kind === "SpreadProp" && spread.dependencies, [{ kind: "State", state: "Named.s.o" }]);
  });

  it("spreads for real in the constructor call and in updateProps, with the named props in order", () => {
    assert.match(compiled.code, /new Box\(\{ \.\.\.\(this\.\$s_o\), x: 9 \}\)/);
    assert.match(compiled.code, /new Box\(\{ \.\.\.\(this\.\$s_o\) \}\)/);
    assert.match(
      compiled.code,
      /\.updateProps\(\{ \.\.\.\(this\.\$s_o\), x: 9 \}\)/,
      "a named prop after the spread is sent with it, so it still wins"
    );
    assert.match(compiled.code, /new Box\(\{ \.\.\.\(i\) \}\)/, "in a list the item is the spread");
    assert.match(compiled.code, /\$item\.updateProps\(\{ \.\.\.\(i\) \}\)/);
  });

  it("does not update a spread that reads nothing", () => {
    const fixed = compiled.code.slice(compiled.code.indexOf("class Fixed"));
    assert.match(fixed, /new Box\(\{ \.\.\.\(\{ x: 3, label: "lit" \}\) \}\)/);
    assert.doesNotMatch(fixed, /updateProps/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("spread props: runtime", () => {
  it("builds each list item from its object, and applies a replaced object", () => {
    const world = new World();
    const row = new Row();
    world.mount(row);
    const boxes = [...row.boxItems.values()];
    assert.deepEqual(
      boxes.map((b) => [b.props.x, b.props.label]),
      [
        [10, "a"],
        [20, "b"],
      ]
    );
    row.s.items = [
      { id: 1, x: 11, label: "a" },
      { id: 2, x: 20, label: "b" },
    ];
    world.flush();
    assert.deepEqual(
      [...row.boxItems.values()].map((b) => b.props.x),
      [11, 20]
    );
  });

  it("marks only the item whose object changed", () => {
    const world = new World();
    const row = new Row();
    world.mount(row);
    const [a, b] = [...row.boxItems.values()] as [BoxInstance, BoxInstance];
    const marked: string[] = [];
    for (const [name, box] of [
      ["a", a],
      ["b", b],
    ] as const) {
      const mark = box.markDirty.bind(box);
      box.markDirty = () => {
        marked.push(name);
        mark();
      };
    }
    // A new array with a new object for a, and the same object for b.
    row.s.items = [{ id: 1, x: 12, label: "a" }, { ...row.s.items[1]! }];
    world.flush();
    assert.deepEqual(marked, ["a"], "b's props were equal key by key, so b was not marked");
  });

  it("lets a named prop after the spread win, through updates", () => {
    const world = new World();
    const named = new Named();
    world.mount(named);
    assert.equal(named.box.props.x, 9);
    assert.equal(named.box2.props.x, 1, "no named prop: the object's x");
    named.s.o = { x: 4, label: "new" };
    world.flush();
    assert.equal(named.box.props.x, 9, "still the named prop after the update");
    assert.equal(named.box2.props.x, 4);
    assert.equal(named.box.props.label, "new");
  });
});

describe("spread props: what is still rejected", () => {
  it("rejects a spread onto a built-in, with a reason", () => {
    const errors = compileErrors(`interface ShapeSize { width: number; height: number }
function C() { const s = useMutable({ p: { width: 4, height: 4 } as ShapeSize }); return <Entity name="C"><Shape kind="rect" {...s.p} /></Entity>; }`);
    assert.equal(errors[0]?.code, DiagnosticCode.UnsupportedAttribute);
    assert.match(errors[0]!.message, /Spreading props onto a built-in/);
  });

  it("still rejects computed attribute names and a spread of something that is not an expression the compiler can read", () => {
    const errors = compileErrors(`function Box({ x }: { x: number }) { return <Entity name="B" transform={{ x }} />; }
function C() { return <Entity name="C"><Box {...window.props} /></Entity>; }`);
    assert.ok(errors.length > 0);
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
  return <Entity name="dot" transform={{ x }} />;
}

function Ring({ x }: DotProps) {
  return <Entity name="ring" transform={{ x }} />;
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

// ---------------------------------------------------------------------------------------------------------------------------
// Forwarding {children}
// ---------------------------------------------------------------------------------------------------------------------------

const FORWARD = `
interface BoxProps {
  title: string;
  children: Child;
}

function Box({ title, children }: BoxProps) {
  return (
    <Entity name={title}>
      <Entity name="body">{children}</Entity>
    </Entity>
  );
}

function Frame({ title, children }: BoxProps) {
  return (
    <Entity name="frame">
      <Box title={title}>{children}</Box>
    </Entity>
  );
}

function Outer({ title, children }: BoxProps) {
  return (
    <Entity name="outer">
      <Frame title={title}>{children}</Frame>
    </Entity>
  );
}

function Use() {
  const s = useMutable({ on: true, ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Outer title="t">
        <Entity name="static" />
        {s.on && <Entity name="maybe" />}
        <Entity name="last" />
      </Outer>
    </Entity>
  );
}

function UseList() {
  const s = useMutable({ ids: [1, 2] as number[] });
  return <Entity name="use"><Outer title="t">{s.ids.map((i) => <Entity key={i} name={"n" + i} />)}</Outer></Entity>;
}

function UseMixed() {
  const s = useMutable({ on: false, ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Outer title="t">
        <Entity name="head" />
        {s.ids.map((i) => <Entity key={i} name={"n" + i} />)}
        {s.on && <Entity name="maybe" />}
        <Entity name="foot" />
      </Outer>
    </Entity>
  );
}

function Card({ title, children }: BoxProps) {
  return (
    <Entity name="card">
      <Box title={title}>
        <Entity name="title" />
        {children}
        <Entity name="footer" />
      </Box>
    </Entity>
  );
}

function UseCard() {
  const s = useMutable({ ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Card title="t">
        <Entity name="first" />
        {s.ids.map((i) => <Entity key={i} name={"n" + i} />)}
      </Card>
    </Entity>
  );
}
`;

interface UseInstance extends Entity {
  s: { [field: string]: unknown };
}
interface UseListInstance extends Entity {
  s: { [field: string]: unknown };
}
type UseMixedInstance = UseListInstance;

describe("forwarding {children}", () => {
  let Use: new () => UseInstance;
  let UseList: new () => UseListInstance;
  let UseMixed: new () => UseMixedInstance;
  let UseCard: new () => UseMixedInstance;
  before(async () => {
    ({ Use, UseList, UseMixed, UseCard } = await load<{
      Use: typeof Use;
      UseList: typeof UseList;
      UseMixed: typeof UseMixed;
      UseCard: typeof UseCard;
    }>(compile(FORWARD, "Forward.tsx")));
  });

  /** The names under the `body` entity of the innermost Box. */
  const bodyNames = (root: Entity): string[] => {
    let node: Entity = root;
    while (node.name !== "body") {
      const next = node.children.find((c) => (c as Entity).name !== undefined && (c as Entity).name !== "") as Entity | undefined;
      if (next === undefined) throw new Error("no body");
      node = next;
    }
    return node.children.map((c) => (c as Entity).name);
  };

  it("hands static, conditional and list children through two forwards into the innermost container", () => {
    const world = new World();
    const u = new Use();
    world.mount(u);
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "maybe", "last"]);
    u.s.on = false;
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "last"]);
    u.s.on = true;
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "maybe", "last"], "a child that comes back lands between its siblings");
  });

  it("forwards a list passed as the whole of the children, with its adds, removals and reorders", () => {
    const world = new World();
    const l = new UseList();
    world.mount(l);
    world.flush();
    assert.deepEqual(bodyNames(l), ["n1", "n2"]);
    l.s.ids = [3, 2, 1];
    world.flush();
    assert.deepEqual(bodyNames(l), ["n3", "n2", "n1"]);
    l.s.ids = [2];
    world.flush();
    assert.deepEqual(bodyNames(l), ["n2"]);
  });

  it("marks a forwarding component as one that accepts passed children", () => {
    const u = new UseList();
    assert.ok(u.children.length > 0);
    const outer = u.children[0]!;
    assert.equal(outer.acceptsPassedChildren, true);
  });

  const compiled = compile(FORWARD, "Forward.tsx");

  it("generates one line in the constructor: the forwarding target", () => {
    assert.match(compiled.code, /this\.passedChildrenForward = this\.box;/);
    assert.match(compiled.code, /this\.passedChildrenForward = this\.frame;/);
    assert.match(compiled.code, /this\.passedChildrenHost = this\.entity2;|this\.passedChildrenHost = this\.\w+;/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("passes a list beside other children, keeping its place through two forwards as it grows, shrinks and reorders", () => {
    const world = new World();
    const m = new UseMixed();
    world.mount(m);
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n1", "n2", "foot"]);
    m.s.ids = [3, 2, 1];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n3", "n2", "n1", "foot"]);
    m.s.on = true;
    m.s.ids = [2];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n2", "maybe", "foot"]);
    m.s.ids = [2, 4];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n2", "n4", "maybe", "foot"]);
  });

  it("forwards {children} between a component's own children: <Box><Title />{children}<Footer /></Box>", () => {
    const world = new World();
    const c = new UseCard();
    world.mount(c);
    world.flush();
    assert.deepEqual(bodyNames(c), ["title", "first", "n1", "n2", "footer"]);
    c.s.ids = [2, 1, 5];
    world.flush();
    assert.deepEqual(bodyNames(c), ["title", "first", "n2", "n1", "n5", "footer"]);
  });

  it("rejects a forwarded {children} inside a condition", () => {
    const head = `interface P { children: Child }\nfunction Box({ children }: P) { return <Entity name="b">{children}</Entity>; }\n`;
    const conditional = compileErrors(
      `${head}function Mod({ children }: P) { const s = useMutable({ on: true }); return <Entity name="m">{s.on && <Box>{children}</Box>}</Entity>; }`
    );
    assert.equal(conditional[0]?.code, DiagnosticCode.UnsupportedJsxChild);
    assert.match(conditional[0]!.message, /always present/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Children on list items
// ---------------------------------------------------------------------------------------------------------------------------

const ITEM_CHILDREN = `
interface Opt {
  id: number;
  label: string;
  ok: boolean;
}

interface BtnProps {
  on: boolean;
  onPress: () => void;
  children: Child;
}

function Btn({ on, onPress, children }: BtnProps) {
  return (
    <Entity name={on ? "on" : "off"}>
      <Pointer width={4} height={4} onPress={() => onPress()} />
      <Entity name="content">{children}</Entity>
    </Entity>
  );
}

interface TagProps {
  text: string;
}

function Tag({ text }: TagProps) {
  return <Entity name={text} />;
}

function Menu() {
  const s = useMutable({
    opts: [{ id: 1, label: "a", ok: true }, { id: 2, label: "b", ok: false }] as Opt[],
    picked: 0,
  });
  return (
    <Entity name="Menu">
      {s.opts.map((o) => (
        <Btn key={o.id} on={o.ok} onPress={() => { s.picked = o.id; }}>
          <Tag text={o.label} />
          <Tag text={"#" + o.id} />
        </Btn>
      ))}
    </Entity>
  );
}

function Rows() {
  const s = useMutable({ opts: [{ id: 1, label: "a", ok: true }] as Opt[] });
  return (
    <Entity name="Rows">
      {s.opts.map((o) => (
        <Entity key={o.id} name={o.label}>
          <Shape kind="rect" width={o.id} height={1} />
        </Entity>
      ))}
    </Entity>
  );
}
`;

interface MenuInstance extends Entity {
  readonly picked: number;
  s: { [field: string]: unknown };
}

describe("children on list items", () => {
  let Menu: new () => MenuInstance;
  let Rows: new () => MenuInstance;
  before(async () => {
    ({ Menu, Rows } = await load<{ Menu: typeof Menu; Rows: typeof Rows }>(compile(ITEM_CHILDREN, "Items.tsx")));
  });

  /** For each item: its button's name and the names inside its `content` entity. */
  const summary = (menu: Entity): [string, string[]][] =>
    menu.children.map((btn) => {
      const content = btn.children.find((c) => (c as Entity).name === "content") as Entity;
      return [(btn as Entity).name, content.children.map((c) => (c as Entity).name)];
    });

  it("builds each item's children with it, reading the item", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    assert.deepEqual(summary(m), [
      ["on", ["a", "#1"]],
      ["off", ["b", "#2"]],
    ]);
  });

  it("applies the item's new value to its children, and to a new item", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    m.s.opts = [
      { id: 1, label: "A", ok: false },
      { id: 2, label: "b", ok: false },
      { id: 3, label: "c", ok: true },
    ];
    world.flush();
    assert.deepEqual(summary(m), [
      ["off", ["A", "#1"]],
      ["off", ["b", "#2"]],
      ["on", ["c", "#3"]],
    ]);
  });

  it("removes an item's children with it, and a callback reads the item's current value", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    m.s.opts = [{ id: 2, label: "b", ok: false }];
    world.flush();
    assert.deepEqual(summary(m), [["off", ["b", "#2"]]]);
    const pointer = (m.children[0] as Entity).children[0] as Pointer;
    world.reportPress(pointer, 1, 1);
    world.flush();
    assert.equal(m.s.picked, 2);
  });

  it("takes children on a built-in item too", () => {
    const world = new World();
    const r = new Rows();
    world.mount(r);
    world.flush();
    assert.equal(r.children.length, 1);
    assert.equal(r.children[0]!.children.length, 1);
    assert.equal((r.children[0]!.children[0] as Shape).width, 1);
  });

  const compiled = compile(ITEM_CHILDREN, "Items.tsx");
  it("type-checks the generated module and keeps the children in the item's record", () => {
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /kids: \{ tag: Tag \| null; tag2: Tag \| null \}/);
    assert.match(compiled.code, /\$item\.attachPassedChild\(\$rec\.kids\.tag, 0\)/);
  });

  it("takes a list inside an item's children (nested-lists.test.ts)", () => {
    const nested = compile(
      `${ITEM_CHILDREN}\nfunction Nested() { const s = useMutable({ opts: [] as Opt[] }); return <Entity name="B">{s.opts.map((o) => <Btn key={o.id} on onPress={() => {}}>{s.opts.map((p) => <Tag key={p.id} text="x" />)}</Btn>)}</Entity>; }`,
      "NestedItems.tsx"
    );
    assert.deepEqual(typeCheck(nested), []);
  });
});

const ITEM_CONDITIONS = `
interface Slot {
  id: number;
  label: string;
  count: number;
  locked: boolean;
}

interface Grid {
  slots: Slot[];
}

function Inventory() {
  const st = useMutable({
    grid: { slots: [{ id: 1, label: "key", count: 1, locked: false }, { id: 2, label: "", count: 0, locked: true }] } as Grid,
    picked: "",
  });
  return (
    <Entity name="Inventory">
      {st.grid.slots.map((s) => (
        <Entity key={s.id} name={"slot" + s.id}>
          <Shape kind="rect" width={10} height={10} />
          {s.count > 0 && (
            <Entity name="filled">
              <Text>{s.label}</Text>
              {s.count > 1 && <Text>{"x" + s.count}</Text>}
              <Pointer width={4} height={4} onPress={() => { st.picked = s.label; }} />
            </Entity>
          )}
          {s.locked ? <Entity name="lock" /> : null}
        </Entity>
      ))}
    </Entity>
  );
}
`;

interface InventoryInstance extends Entity {
  readonly picked: string;
  st: { [field: string]: unknown };
}

describe("conditions and nested children inside list items", () => {
  let Inventory: new () => InventoryInstance;
  before(async () => {
    ({ Inventory } = await load<{ Inventory: typeof Inventory }>(compile(ITEM_CONDITIONS, "Inventory.tsx")));
  });

  /** For each slot: the names of its children, and the texts inside its `filled` entity. */
  const summary = (inv: Entity): [string, string[], string[]][] =>
    inv.children.map((slot) => {
      const filled = slot.children.find((c) => (c as Entity).name === "filled");
      const texts = filled ? filled.children.filter((c): c is Text => c instanceof Text).map((t) => t.text) : [];
      return [(slot as Entity).name, slot.children.map((c) => (c instanceof Entity ? c.name : c.constructor.name)), texts];
    });

  it("builds only the children whose conditions hold, in their written places", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "filled"], ["key"]],
      ["slot2", ["Shape", "lock"], []],
    ]);
  });

  it("adds and removes them as the item changes, keeping the item's instance", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    const first = inv.children[0];
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 3, locked: false },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    assert.equal(inv.children[0], first);
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "filled"], ["key", "x3"]],
      ["slot2", ["Shape", "filled"], ["bell"]],
    ]);
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 0, locked: true },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "lock"], []],
      ["slot2", ["Shape", "filled"], ["bell"]],
    ]);
  });

  it("gives a child made later a callback that reads the item's current value", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 1, locked: false },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 1, locked: false },
        { id: 2, label: "shears", count: 1, locked: false },
      ],
    };
    world.flush();
    const filled = inv.children[1]!.children.find((c) => (c as Entity).name === "filled")!;
    world.reportPress(filled.children.find((c) => c instanceof Pointer) as Pointer, 1, 1);
    world.flush();
    assert.equal(inv.st.picked, "shears");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(ITEM_CONDITIONS, "Inventory.tsx")), []);
  });
});
