/**
 * `<Flex>`: the layout container (U2 in docs/UI_PLAN.md). The compiler learns its props from the runtime manifest, adds
 * only the size check and the `flex-start` hint, and what layout means is the player's, tested in packages/player; these
 * tests compile real components and lay them out through the frame builder.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Flex, Shape, World, type GameObject } from "@rge/runtime";
import { FrameBuilder } from "@rge/player";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
interface Row {
  id: string;
  width: number;
}

function Shelf() {
  const [open, setOpen] = useState(false);
  const [spacing, setSpacing] = useState(2);
  const [rows, setRows] = useState<Row[]>([{ id: "a", width: 10 }, { id: "b", width: 20 }]);
  return (
    <Flex gap={spacing} padding={1} background="purple" direction="row" alignItems="center" justifyContent="start">
      {open && <Shape kind="rect" width={5} height={5} />}
      {rows.map((r) => (
        <Shape key={r.id} kind="rect" width={r.width} height={4} />
      ))}
    </Flex>
  );
}

function Menu() {
  return (
    <Flex direction="column" minWidth={300} maxWidth={500} background="purple">
      <Flex width="grow" minHeight={80} paddingX={16} gap={32} alignItems="center">
        <Flex width="grow">
          <Text size={20}>Copy</Text>
        </Flex>
        <Sprite image="icon.png" />
      </Flex>
      <Flex width="grow" minHeight={80} paddingX={16} gap={32} alignItems="center">
        <Flex width="grow">
          <Text size={20}>Select all</Text>
        </Flex>
        <Sprite image="icon.png" />
      </Flex>
    </Flex>
  );
}
`;

interface ShelfInstance extends Flex {
  setOpen(value: boolean): void;
  setSpacing(value: number): void;
  setRows(value: { id: string; width: number }[]): void;
}

let Shelf: new () => ShelfInstance;
let Menu: new () => Flex;

before(async () => {
  ({ Shelf, Menu } = await load<{ Shelf: typeof Shelf; Menu: typeof Menu }>(compile(SOURCE, "FlexGame.tsx")));
});

function layOut(root: GameObject, builder = new FrameBuilder({ loadTexture: () => 0, measureText: (text, size) => ({ width: text.length * 10, height: size }), textureSize: () => ({ width: 16, height: 16 }) })): FrameBuilder {
  builder.build(root, 640, 360);
  return builder;
}

describe("Flex: a compiled component", () => {
  it("takes its props from the element, static or from state, and is a Flex", () => {
    const shelf = new Shelf();
    new World().mount(shelf);
    assert.ok(shelf instanceof Flex);
    assert.deepEqual([shelf.direction, shelf.alignItems, shelf.justifyContent, shelf.gap, shelf.padding, shelf.background], ["row", "center", "start", 2, 1, "purple"]);
  });

  it("lays its children out, and lays them out again when state changes the spacing", () => {
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    const builder = layOut(shelf);
    const [a, b] = shelf.children as [Shape, Shape];
    assert.deepEqual([a.layoutX, b.layoutX], [1, 1 + 10 + 2]);
    assert.deepEqual([a.layoutY, b.layoutY], [1, 1], "centred: the tallest child (4) fills the inner height");
    shelf.setSpacing(10);
    world.flush();
    layOut(shelf, builder);
    assert.deepEqual([a.layoutX, b.layoutX], [1, 21]);
  });

  it("reflows when a conditional child turns on and off", () => {
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    const builder = layOut(shelf);
    assert.equal(shelf.children.length, 2);
    shelf.setOpen(true);
    world.flush();
    layOut(shelf, builder);
    const [extra, a, b] = shelf.children as [Shape, Shape, Shape];
    assert.equal(extra.width, 5);
    assert.deepEqual([extra.layoutX, a.layoutX, b.layoutX], [1, 1 + 5 + 2, 1 + 5 + 2 + 10 + 2]);
    assert.equal(shelf.box.size[0], 1 + 5 + 2 + 10 + 2 + 20 + 1);
    shelf.setOpen(false);
    world.flush();
    layOut(shelf, builder);
    assert.deepEqual([a.layoutX, b.layoutX], [1, 13], "the ones after it close up");
  });

  it("reflows when a keyed list gains, loses and reorders items, keeping each item's own slot", () => {
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    const builder = layOut(shelf);
    shelf.setRows([{ id: "b", width: 20 }, { id: "c", width: 7 }, { id: "a", width: 10 }]);
    world.flush();
    layOut(shelf, builder);
    assert.deepEqual((shelf.children as Shape[]).map((s) => [s.width, s.layoutX]), [[20, 1], [7, 1 + 20 + 2], [10, 1 + 20 + 2 + 7 + 2]]);
  });

  it("draws the background behind the children, the size of the box", () => {
    const shelf = new Shelf();
    new World().mount(shelf);
    const builder = new FrameBuilder({ loadTexture: () => 0 });
    const frame = builder.build(shelf, 640, 360);
    const r = frame.list.records;
    // view (7 doubles), then the background rect: x, y, rot, sx, sy, width, height, colour
    assert.equal(r[7], 3, "a rect record");
    assert.deepEqual([r[13], r[14]], [1 + 10 + 2 + 20 + 1, 1 + 4 + 1], "the box's width and height");
  });
});

describe("Flex: the video's context menu", () => {
  it("fits its widest row, holds its minimum width, grows every row to it, and puts each icon at the right edge", () => {
    const menu = new Menu();
    new World().mount(menu);
    layOut(menu);
    const [copy, selectAll] = menu.children as [Flex, Flex];
    // The widest row fits 16 + 100 + 32 + 16 + 16 = 180, so the 300 minimum holds.
    assert.equal(menu.box.size[0], 300);
    assert.deepEqual([copy.box.size[0], selectAll.box.size[0]], [300, 300], "every row grows to the menu's width");
    // Rows are at least 80 high; the menu is both of them.
    assert.deepEqual([copy.box.size[1], selectAll.box.size[1]], [80, 80]);
    assert.equal(menu.box.size[1], 160);
    assert.deepEqual([copy.layoutY, selectAll.layoutY], [0, 80]);
    for (const row of [copy, selectAll]) {
      const [label, icon] = row.children as [Flex, GameObject];
      assert.equal(label.layoutX, 16, "the label sits at the left");
      assert.equal(label.box.size[0], 300 - 32 - 16 - 32, "and takes the free space, which pushes the icon right");
      assert.equal(icon.layoutX, 300 - 16 - 16, "the icon ends 16 from the right edge");
      assert.equal(icon.layoutX - (label.layoutX + label.box.size[0]), 32, "a gap of 32 between them");
      assert.equal(icon.layoutY, (80 - 16) / 2, "centred vertically in a row of minimum height");
      assert.equal(label.layoutY, (80 - 20) / 2);
    }
  });

  it("stops at its maximum width, letting a longer label overflow until text wraps", () => {
    const menu = new Menu();
    new World().mount(menu);
    const builder = new FrameBuilder({ loadTexture: () => 0, measureText: (text, size) => ({ width: text.length * 10, height: size }), textureSize: () => ({ width: 16, height: 16 }) });
    const [, second] = menu.children as [Flex, Flex];
    const label = second.children[0] as Flex;
    (label.children[0] as unknown as { text: string }).text = "x".repeat(60);
    builder.build(menu, 640, 360);
    assert.equal(menu.box.size[0], 500, "the menu stops at its maximum");
    assert.equal(second.box.size[0], 16 + 600 + 32 + 16 + 16, "a row never goes below its minimum, so it overflows the menu");
    assert.ok((label.box.size[0] as number) >= 600, "and the label keeps its width");
  });
});

const PRESS = `
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Flex width={96} height={32} alignItems="center" justifyContent="center" onPress={() => setCount((c) => c + 1)}>
      <Text size={16} width={80} align="center">
        Count: {count}
      </Text>
    </Flex>
  );
}
`;

describe("Flex onPress and Text align", () => {
  it("presses a Flex through the world, running the handler against the component's state", async () => {
    const { Counter } = await load<{ Counter: new () => Flex & { readonly text: { text: string; width: number | undefined; align: string } } }>(compile(PRESS, "Press.tsx"));
    const world = new World();
    const counter = new Counter();
    world.mount(counter);
    assert.equal(counter.onPress !== undefined, true);
    new FrameBuilder({ loadTexture: () => 0 }).build(counter, 640, 360);
    assert.equal(world.reportPress(counter, 10, 10), true);
    world.flush();
    assert.equal(counter.text.text, "Count: 1");
    assert.equal(world.reportPress(counter, 200, 10), false, "outside the 96 × 32 box");
    assert.deepEqual([counter.text.width, counter.text.align], [80, "center"]);
  });

  it("type-checks a Flex onPress and a Text's width and align, in source and in the generated module", () => {
    assert.deepEqual(typeCheck(compile(PRESS, "Press.tsx")), []);
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        { fileName: `${process.cwd()}/.test-output/Press${Math.random()}.tsx`, text: `import { Flex, Text } from "@rge/runtime/jsx";\nfunction C({ wide }: { wide: boolean }) { return ${element}; }` },
      ]);
    assert.deepEqual(check(`<Flex onPress={() => {}}><Text width={40} align={wide ? "left" : "right"}>x</Text></Flex>`), []);
    assert.ok(check(`<Text align={wide ? "left" : "middle"}>x</Text>`).length > 0);
  });

  it("checks a Text's align literal with a suggestion", () => {
    const errors = compileErrors(`function C() { return <Text align="centre">x</Text>; }`);
    assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
    assert.match(errors[0]!.message, /<Text align> must be one of "left", "center", "right", not 'centre' \(did you mean "center"\?\)/);
    assert.doesNotThrow(() => compile(`function C() { return <Text align="right" width={30}>x</Text>; }`));
  });

  it("reserves the new names", () => {
    for (const name of ["onPress", "contains"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Flex />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), `Flex ${name}`);
    }
    for (const name of ["align", "width"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Text>x</Text>; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), `Text ${name}`);
    }
  });
});

describe("Flex: diagnostics", () => {
  it("checks the keyword props against their choices, with a suggestion, and explains CSS's spelling", () => {
    for (const [attribute, expected] of [
      [`direction="colum"`, /<Flex direction> must be one of "row", "column", not 'colum' \(did you mean "column"\?\)/],
      [`alignItems="flex-start"`, /<Flex alignItems> must be one of "start", "center", "end", "stretch", not 'flex-start' \(did you mean "start"\?\)/],
      [`justifyContent="flex-end"`, /did you mean "end"\?/],
      [`justifyContent="space-betwen"`, /did you mean "space-between"\?/],
      [`anchor="middle"`, /<Flex anchor> must be one of "top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", not 'middle'/],
      [`to="top-righ"`, /<Flex to> must be one of .*did you mean "top-right"\?/],
      [`overflow="scrol"`, /<Flex overflow> must be one of "visible", "hidden", "scroll", not 'scrol' \(did you mean "scroll"\?\)/],
    ] as const) {
      const errors = compileErrors(`function C() { return <Flex ${attribute} />; }`);
      assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue], attribute);
      assert.match(errors[0]!.message, expected);
    }
  });

  it("accepts a number, fit, grow and a percentage for a size, and rejects anything else written out", () => {
    for (const value of [`{120}`, `"fit"`, `"grow"`, `"50%"`, `"12.5%"`, `"100%"`, `"0%"`]) {
      assert.doesNotThrow(() => compile(`function C() { return <Flex width=${value} height=${value} />; }`), value);
    }
    for (const [value, hint] of [[`"grwo"`, `did you mean "grow"`], [`"fill"`, ""], [`"101%"`, ""], [`"50"`, ""], [`"50 %"`, ""], [`{true}`, ""]] as const) {
      const errors = compileErrors(`function C() { return <Flex width=${value} />; }`);
      assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue], value);
      assert.match(errors[0]!.message, /<Flex width> must be a number of pixels, "fit", "grow", or a percentage/);
      if (hint) assert.ok(errors[0]!.message.includes(hint), errors[0]!.message);
    }
  });

  it("leaves an expression to the type-check, which knows the type of a size", () => {
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        { fileName: `${process.cwd()}/.test-output/Flex${Math.random()}.tsx`, text: `import { Flex } from "@rge/runtime/jsx";\nfunction C({ big }: { big: boolean }) { return ${element}; }` },
      ]);
    assert.deepEqual(check(`<Flex width={big ? "grow" : 120} height={big ? "50%" : "fit"} gap={4} padding={2} paddingX={3} minWidth={10} />`), []);
    assert.ok(check(`<Flex width={big ? "grwo" : 120} />`).length > 0, "a bad keyword inside an expression");
    assert.ok(check(`<Flex direction={big ? "row" : "diagonal"} />`).length > 0);
    assert.ok(check(`<Flex gap="wide" />`).length > 0);
  });

  it("is a container, can be placed with transform, takes elements as children, and type-checks generated", () => {
    assert.doesNotThrow(() => compile(`function C() { return <Flex transform={{ x: 4 }}><Shape kind="rect" width={1} height={1} /></Flex>; }`));
    assert.deepEqual(typeCheck(compile(SOURCE, "FlexGame.tsx")), []);
  });

  it("reserves its names for a component rooted at one", () => {
    for (const name of ["direction", "gap", "padding", "width", "minWidth", "background", "box"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Flex />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });

  it("takes the built-in's name, so a component cannot be called Flex", () => {
    const errors = compileErrors(`function Flex() { return <Entity name="Flex" />; }`);
    assert.ok(errors.some((d) => /conflicts with a runtime intrinsic/.test(d.message)));
  });
});

describe("Flex: floating props", () => {
  it("accepts float as a bare attribute, with anchors and offsets, and sets them on the box", () => {
    const out = compile(`function C() { return <Flex width={40} height={20}><Flex float anchor="top-right" to="top-right" offsetX={-4} offsetY={4} width={8} height={8} /></Flex>; }`);
    assert.match(JSON.stringify(out), /float: true, anchor: \\"top-right\\"|float: true, anchor: "top-right"/);
  });
});

describe("Flex: border, rounded corners, and hover and focus colours", () => {
  const STYLED = `
function Tile() {
  const [accent, setAccent] = useState("gold");
  const [round, setRound] = useState(4);
  return (
    <Flex
      width={40}
      height={20}
      background="navy"
      borderWidth={2}
      borderColor={accent}
      borderRadius={round}
      hoverBackground="#334"
      hoverBorderColor="white"
      focusable
      focusBackground="#223"
      focusBorderColor="yellow"
      pressedBackground="#112"
      pressedBorderColor="orange"
      disabled={round > 100}
      disabledBackground="gray"
      disabledBorderColor="silver"
      transition={0.15}
      overflow={round > 100 ? "scroll" : "hidden"}
      scrollY={round}
    />
  );
}
`;

  it("takes every prop from the element, static or from state, and updates them when state changes", async () => {
    const { Tile } = await load<{ Tile: new () => Flex & { setAccent(v: string): void; setRound(v: number): void } }>(compile(STYLED, "FlexStyled.tsx"));
    const world = new World();
    const tile = new Tile();
    world.mount(tile);
    assert.deepEqual(
      [tile.background, tile.borderWidth, tile.borderColor, tile.borderRadius, tile.hoverBackground, tile.hoverBorderColor, tile.focusBackground, tile.focusBorderColor],
      ["navy", 2, "gold", 4, "#334", "white", "#223", "yellow"],
    );
    assert.deepEqual([tile.pressedBackground, tile.pressedBorderColor, tile.disabled, tile.disabledBackground, tile.disabledBorderColor], ["#112", "orange", false, "gray", "silver"]);
    assert.equal(tile.transition, 0.15);
    assert.deepEqual([tile.overflow, tile.scrollX, tile.scrollY], ["hidden", 0, 4]);
    tile.setAccent("red");
    tile.setRound(800);
    world.flush();
    assert.deepEqual([tile.borderColor, tile.borderRadius, tile.disabled], ["red", 800, true], "disabled follows state");
    assert.deepEqual([tile.overflow, tile.scrollY], ["scroll", 800], "and overflow and the scroll offset");
  });

  it("type-checks the generated code, and rejects a prop of the wrong type, in the source", () => {
    assert.deepEqual(typeCheck(compile(STYLED, "FlexStyled.tsx")), []);
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        { fileName: `${process.cwd()}/.test-output/Styled${Math.random()}.tsx`, text: `import { Flex } from "@rge/runtime/jsx";\nfunction C({ wide }: { wide: boolean }) { return ${element}; }` },
      ]);
    assert.deepEqual(check(`<Flex borderWidth={wide ? 2 : 0} borderColor="red" borderRadius={4} hoverBackground="blue" focusBorderColor="white" pressedBackground="navy" disabled={wide} disabledBorderColor="gray" transition={wide ? 0.2 : 0} />`), []);
    assert.ok(check(`<Flex transition="slow" />`).length > 0, "a transition is a number of seconds");
    assert.deepEqual(check(`<Flex overflow={wide ? "scroll" : "hidden"} scrollX={0} scrollY={wide ? 9999 : 0} />`), []);
    assert.ok(check(`<Flex overflow="auto" />`).length > 0, "overflow is one of three words");
    assert.ok(check(`<Flex scrollY="end" />`).length > 0, "a scroll offset is a number");
    assert.ok(check(`<Flex disabled="yes" />`).length > 0, "disabled is a boolean");
    assert.ok(check(`<Flex borderWidth="thick" />`).length > 0, "a width is a number");
    assert.ok(check(`<Flex hoverBackground={4} />`).length > 0, "a colour is a string");
    assert.ok(check(`<Flex hoverWidth={4} />`).length > 0, "and a made-up prop is not accepted");
  });

  it("reserves the new names for a component rooted at a Flex", () => {
    for (const name of ["borderWidth", "borderColor", "borderRadius", "hoverBackground", "hoverBorderColor", "focusBackground", "focusBorderColor", "pressedBackground", "pressedBorderColor", "disabledBackground", "disabledBorderColor", "disabled", "transition", "transitionState", "overflow", "scrollX", "scrollY"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Flex />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });
});
