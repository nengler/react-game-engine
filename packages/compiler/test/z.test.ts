import assert from "node:assert/strict";
/**
 * `z`: draw order, written in `transform` beside `x` and `y` (DESIGN.md, "What is drawn"). The compiler
 * treats it like any transform field; what it means is the player's draw pass, tested in packages/player.
 */
import { after, before, describe, it } from "node:test";

import { FrameBuilder } from "@tsengine/player";
import { Entity, Shape, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
interface CardProps {
  lift: number;
}

function Card({ lift }: CardProps) {
  const s = useMutable({ front: false });
  useUpdate(() => { s.front = true; });
  return (
    <Entity name="Card" transform={{ z: lift }}>
      <Shape kind="rect" width={1} height={1} transform={{ z: 2 }} />
      <Shape kind="rect" width={2} height={1} transform={{ z: s.front ? 5 : -5 }} />
    </Entity>
  );
}

function Table() {
  return (
    <Entity name="Table">
      <Card lift={0} />
      <Card lift={1} transform={{ z: 10 }} />
    </Entity>
  );
}
`;

interface Instance extends Entity {
  readonly shape: Shape;
  readonly shape2: Shape;
}

let Card: new (props: { lift: number }) => Instance;
let Table: new () => Entity & { readonly card: Instance; readonly card2: Instance };

before(async () => {
  ({ Card, Table } = await load<{ Card: typeof Card; Table: typeof Table }>(compile(SOURCE, "Cards.tsx")));
});

describe("z in transform", () => {
  it("is an ordinary transform field: static ones are set once, ones that read state or props in render", () => {
    const compiled = compile(SOURCE, "Cards.tsx");
    const card = compiled.ir.components.find((c) => c.name === "Card")!;
    assert.deepEqual(
      card.root.transform.map((p) => [p.name, p.kind]),
      [["z", "DynamicProp"]],
      "from a prop"
    );
    const [fixed, moving] = card.root.children.map((c) => elementOf(c));
    assert.deepEqual(
      fixed!.transform.map((p) => [p.name, p.kind]),
      [["z", "StaticProp"]]
    );
    assert.deepEqual(
      moving!.transform.map((p) => [p.name, p.kind]),
      [["z", "DynamicProp"]]
    );
    assert.match(compiled.code, /this\.shape\.transform\.z = 2;/);
    assert.match(compiled.code, /const (\$\d+) = this\.\$s_front \? 5 : \(-5\);[^]*?this\.shape2\.transform\.z = \1;/);
  });

  it("places a component with `transform={{ z }}` in its placement, under the component's own", () => {
    const world = new World();
    const table = new Table();
    world.mount(table);
    assert.equal(table.card2.placement.z, 10);
    assert.equal(table.card2.transform.z, 1, "the component's own, from its prop");
  });

  it("changes the order things are drawn in as state moves z, and a placed component raises its whole subtree", () => {
    const world = new World();
    const table = new Table();
    world.mount(table);
    const builder = new FrameBuilder({ loadTexture: () => 0 });
    const widths = (): number[] => {
      const built = builder.build(world.root, 100, 100);
      const records = built.list.records;
      const out: number[] = [];
      for (let at = 7; at < built.list.length; at += 9) out.push(records[at + 6] as number);
      return out;
    };
    // Before the first tick: each card's second shape is at -5. Card 1 is lifted by 10 + 1 (its placement and its prop).
    assert.deepEqual(widths(), [2, 1, 2, 1], "mounted, before any update");
    world.tick(0.016);
    // After: the second shape is at +5. Card 0: shapes at 2 and 5; card 1: at 13 and 16.
    assert.deepEqual(widths(), [1, 2, 1, 2]);
  });
});

describe("z: diagnostics", () => {
  it("rejects a duplicate z and a field that is not one, naming the fields", () => {
    const duplicate = compileErrors(`function C() { return <Entity name="C" transform={{ z: 1, z: 2 }} />; }`);
    assert.ok(duplicate.some((d) => d.code === DiagnosticCode.InvalidTransformAttribute));
    const unknown = compileErrors(`function C() { return <Entity name="C" transform={{ depth: 1 }} />; }`);
    assert.match(unknown[0]!.message, /'depth' is not a transform field \(x, y, z, rotation, scaleX, scaleY, global, opacity\)/);
  });

  it("type-checks z as a number in authored source", async () => {
    const { getCompiler } = await import("./helpers.ts");
    const check = (z: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/Z${Math.random()}.tsx`,
          text: `import { Entity } from "@tsengine/runtime/jsx";\nfunction C() { return <Entity name="C" transform={{ z: ${z} }} />; }`,
        },
      ]);
    assert.deepEqual(check("3"), []);
    assert.ok(check(`"front"`).length > 0);
  });
});
