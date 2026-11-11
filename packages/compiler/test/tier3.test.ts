/**
 * Tier 3 (docs/TOWER_DEFENSE_PLAN.md): spread props on component elements. `<Enemy {...e} />` spreads for real in the generated
 * code; a named prop after a spread wins; a spread in a keyed list re-renders only the items whose object was replaced.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World } from "@rge/runtime";
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
  const [items, setItems] = useState<Item[]>([{ id: 1, x: 10, label: "a" }, { id: 2, x: 20, label: "b" }]);
  return <Entity name="Row">{items.map((i) => <Box key={i.id} {...i} />)}</Entity>;
}

function Named() {
  const [o, setO] = useState<BoxProps>({ x: 1, label: "from-object" });
  return (
    <Entity name="Named">
      <Box {...o} x={9} />
      <Box {...o} />
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
  setItems(items: { id: number; x: number; label: string }[]): void;
  readonly boxItems: Map<number, BoxInstance>;
  readonly items: { id: number; x: number; label: string }[];
}
interface NamedInstance extends Entity {
  setO(o: { x: number; label: string }): void;
  readonly box: BoxInstance;
  readonly box2: BoxInstance;
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
    assert.deepEqual(first!.props.map((p) => p.kind), ["SpreadProp", "StaticProp"], "the spread, then the named prop that wins over it");
    assert.deepEqual(second!.props.map((p) => p.kind), ["SpreadProp"]);
    const spread = first!.props[0]!;
    assert.deepEqual(spread.kind === "SpreadProp" && spread.dependencies, [{ kind: "State", state: "Named.o" }]);
  });

  it("spreads for real in the constructor call and in updateProps, with the named props in order", () => {
    assert.match(compiled.code, /new Box\(\{ \.\.\.\(this\.o\), x: 9 \}\)/);
    assert.match(compiled.code, /new Box\(\{ \.\.\.\(this\.o\) \}\)/);
    assert.match(compiled.code, /\.updateProps\(\{ \.\.\.\(this\.o\), x: 9 \}\)/, "a named prop after the spread is sent with it, so it still wins");
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
    assert.deepEqual(boxes.map((b) => [b.props.x, b.props.label]), [[10, "a"], [20, "b"]]);
    row.setItems([{ id: 1, x: 11, label: "a" }, { id: 2, x: 20, label: "b" }]);
    world.flush();
    assert.deepEqual([...row.boxItems.values()].map((b) => b.props.x), [11, 20]);
  });

  it("marks only the item whose object changed", () => {
    const world = new World();
    const row = new Row();
    world.mount(row);
    const [a, b] = [...row.boxItems.values()] as [BoxInstance, BoxInstance];
    const marked: string[] = [];
    for (const [name, box] of [["a", a], ["b", b]] as const) {
      const mark = box.markDirty.bind(box);
      box.markDirty = () => {
        marked.push(name);
        mark();
      };
    }
    // A new array with a new object for a, and the same object for b.
    row.setItems([{ id: 1, x: 12, label: "a" }, { ...row.items[1]! }]);
    world.flush();
    assert.deepEqual(marked, ["a"], "b's props were equal key by key, so b was not marked");
  });

  it("lets a named prop after the spread win, through updates", () => {
    const world = new World();
    const named = new Named();
    world.mount(named);
    assert.equal(named.box.props.x, 9);
    assert.equal(named.box2.props.x, 1, "no named prop: the object's x");
    named.setO({ x: 4, label: "new" });
    world.flush();
    assert.equal(named.box.props.x, 9, "still the named prop after the update");
    assert.equal(named.box2.props.x, 4);
    assert.equal(named.box.props.label, "new");
  });
});

describe("spread props: what is still rejected", () => {
  it("rejects a spread onto a built-in, with a reason", () => {
    const errors = compileErrors(`interface ShapeSize { width: number; height: number }
function C() { const [p] = useState<ShapeSize>({ width: 4, height: 4 }); return <Entity name="C"><Shape kind="rect" {...p} /></Entity>; }`);
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
  const [spots, setSpots] = useState<Spot[]>([{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }, { id: 3, on: true, x: 3 }]);
  return <Entity name="Switching">{spots.map((s) => (s.on ? <Dot key={s.id} x={s.x} /> : <Ring key={s.id} x={s.x} />))}</Entity>;
}

function Only() {
  const [spots, setSpots] = useState<Spot[]>([{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }, { id: 3, on: true, x: 3 }]);
  return <Entity name="Only">{spots.map((s) => s.on && <Dot key={s.id} x={s.x} />)}</Entity>;
}

function WithNull() {
  const [spots, setSpots] = useState<Spot[]>([{ id: 1, on: true, x: 1 }, { id: 2, on: false, x: 2 }]);
  return <Entity name="WithNull">{spots.map((s) => (s.on ? <Dot key={s.id} x={s.x} /> : null))}</Entity>;
}
`;

interface SpotData {
  id: number;
  on: boolean;
  x: number;
}
interface SpotsInstance extends Entity {
  setSpots(spots: SpotData[]): void;
}

describe("conditionals in a list's map: runtime", () => {
  let Switching: new () => SpotsInstance;
  let Only: new () => SpotsInstance;
  let WithNull: new () => SpotsInstance;
  before(async () => {
    ({ Switching, Only, WithNull } = await load<{ Switching: typeof Switching; Only: typeof Only; WithNull: typeof WithNull }>(compile(COND, "Cond.tsx")));
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
    s.setSpots([{ id: 1, on: true, x: 1 }, { id: 2, on: true, x: 2 }, { id: 3, on: true, x: 3 }]);
    world.flush();
    assert.deepEqual(kinds(s), ["dot", "dot", "dot"]);
    assert.deepEqual(xs(s), [1, 2, 3]);
    s.setSpots([{ id: 1, on: false, x: 1 }, { id: 2, on: true, x: 2 }, { id: 3, on: false, x: 30 }]);
    world.flush();
    assert.deepEqual(kinds(s), ["ring", "dot", "ring"]);
    assert.deepEqual(xs(s), [1, 2, 30], "and the new instance has the item's current props");
  });

  it("updates the current branch's props, adds and removes items", () => {
    const world = new World();
    const s = new Switching();
    world.mount(s);
    s.setSpots([{ id: 3, on: true, x: 33 }, { id: 4, on: false, x: 4 }, { id: 1, on: true, x: 1 }]);
    world.flush();
    assert.deepEqual(kinds(s), ["dot", "ring", "dot"]);
    assert.deepEqual(xs(s), [33, 4, 1]);
  });

  it("`cond && <El/>` leaves out the items for which it is false, and brings them in when it turns true", () => {
    const world = new World();
    const o = new Only();
    world.mount(o);
    assert.deepEqual(xs(o), [1, 3]);
    o.setSpots([{ id: 1, on: true, x: 1 }, { id: 2, on: true, x: 2 }, { id: 3, on: false, x: 3 }]);
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
    assert.match(compiled.code, /const \$list = this\.spots\.filter\(\(s\) => s\.on\);/);
    assert.match(compiled.code, /const \$branch = s\.on \? 0 : 1;/);
    assert.match(compiled.code, /if \(s\.on\) \{\n\s+\$item = new Dot\(/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("rejects different keys in the two branches", () => {
    const errors = compileErrors(`${COND}\nfunction Bad() { const [spots] = useState<Spot[]>([]); return <Entity name="B">{spots.map((s) => (s.on ? <Dot key={s.id} x={1} /> : <Ring key={s.x} x={1} />))}</Entity>; }`);
    assert.equal(errors[0]?.code, DiagnosticCode.InvalidList);
    assert.match(errors[0]!.message, /same `key`/);
  });

  it("still rejects a fragment as a branch, and the index in a conditional list", () => {
    const fragment = compileErrors(`${COND}\nfunction Bad() { const [spots] = useState<Spot[]>([]); return <Entity name="B">{spots.map((s) => (s.on ? <><Dot key={s.id} x={1} /></> : null))}</Entity>; }`);
    assert.equal(fragment[0]?.code, DiagnosticCode.InvalidList);
    const index = compileErrors(`${COND}\nfunction Bad() { const [spots] = useState<Spot[]>([]); return <Entity name="B">{spots.map((s, i) => s.on && <Dot key={s.id} x={i} />)}</Entity>; }`);
    assert.match(index[0]!.message, /cannot take the index/);
  });
});
