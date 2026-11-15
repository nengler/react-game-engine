/**
 * Spread props on component elements (docs/DESIGN.md, "Spread props"; first used by Hearth). `<Enemy {...e} />` spreads for real in
 * the generated code; a named prop after a spread wins; a spread in a keyed list re-renders only the items whose object was replaced.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, World } from "@tsengine/runtime";

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
