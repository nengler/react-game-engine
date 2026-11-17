import assert from "node:assert/strict";
/**
 * `<Flex>`: the layout container (docs/LAYOUT.md). The compiler learns its props from the runtime manifest, adds
 * only the size check and the `flex-start` hint, and what layout means is the player's, tested in packages/player; these
 * tests compile real components and lay them out through the frame builder.
 */
import { after, before, describe, it } from "node:test";

import { FrameBuilder } from "@tsengine/player";
import {
  Button,
  createControls,
  createInputState,
  Flex,
  Menu as MenuBox,
  Shape,
  Slider,
  Text,
  TextInput,
  Toggle,
  Tooltip,
  World,
  type GameObject,
} from "@tsengine/runtime";

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
  const s = useMutable({ open: false, spacing: 2, rows: [{ id: "a", width: 10 }, { id: "b", width: 20 }] as Row[] });
  return (
    <Flex gap={s.spacing} padding={1} background="purple" direction="row" alignItems="center" justifyContent="start">
      {s.open && <Shape kind="rect" width={5} height={5} />}
      {s.rows.map((r) => (
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
  s: { [field: string]: unknown };
}

let Shelf: new () => ShelfInstance;
let Menu: new () => Flex;

before(async () => {
  ({ Shelf, Menu } = await load<{ Shelf: typeof Shelf; Menu: typeof Menu }>(compile(SOURCE, "FlexGame.tsx")));
});

function layOut(
  root: GameObject,
  builder = new FrameBuilder({
    loadTexture: () => 0,
    measureText: (text, size) => ({ width: text.length * 10, height: size }),
    textureSize: () => ({ width: 16, height: 16 }),
  })
): FrameBuilder {
  builder.build(root, 640, 360);
  return builder;
}

describe("Flex: a compiled component", () => {
  it("takes its props from the element, static or from state, and is a Flex", () => {
    const shelf = new Shelf();
    new World().mount(shelf);
    assert.ok(shelf instanceof Flex);
    assert.deepEqual(
      [shelf.direction, shelf.alignItems, shelf.justifyContent, shelf.gap, shelf.padding, shelf.background],
      ["row", "center", "start", 2, 1, "purple"]
    );
  });

  it("lays its children out, and lays them out again when state changes the spacing", () => {
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    const builder = layOut(shelf);
    const [a, b] = shelf.children as [Shape, Shape];
    assert.deepEqual([a.layoutX, b.layoutX], [1, 1 + 10 + 2]);
    assert.deepEqual([a.layoutY, b.layoutY], [1, 1], "centred: the tallest child (4) fills the inner height");
    shelf.s.spacing = 10;
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
    shelf.s.open = true;
    world.flush();
    layOut(shelf, builder);
    const [extra, a, b] = shelf.children as [Shape, Shape, Shape];
    assert.equal(extra.width, 5);
    assert.deepEqual([extra.layoutX, a.layoutX, b.layoutX], [1, 1 + 5 + 2, 1 + 5 + 2 + 10 + 2]);
    assert.equal(shelf.box.size[0], 1 + 5 + 2 + 10 + 2 + 20 + 1);
    shelf.s.open = false;
    world.flush();
    layOut(shelf, builder);
    assert.deepEqual([a.layoutX, b.layoutX], [1, 13], "the ones after it close up");
  });

  it("reflows when a keyed list gains, loses and reorders items, keeping each item's own slot", () => {
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    const builder = layOut(shelf);
    shelf.s.rows = [
      { id: "b", width: 20 },
      { id: "c", width: 7 },
      { id: "a", width: 10 },
    ];
    world.flush();
    layOut(shelf, builder);
    assert.deepEqual(
      (shelf.children as Shape[]).map((s) => [s.width, s.layoutX]),
      [
        [20, 1],
        [7, 1 + 20 + 2],
        [10, 1 + 20 + 2 + 7 + 2],
      ]
    );
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
    const builder = new FrameBuilder({
      loadTexture: () => 0,
      measureText: (text, size) => ({ width: text.length * 10, height: size }),
      textureSize: () => ({ width: 16, height: 16 }),
    });
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
  const s = useMutable({ count: 0 });
  return (
    <Flex width={96} height={32} alignItems="center" justifyContent="center" onPress={() => { s.count += 1; }}>
      <Text size={16} width={80} align="center">
        Count: {s.count}
      </Text>
    </Flex>
  );
}
`;

describe("Flex onPress and Text align", () => {
  it("presses a Flex through the world, running the handler against the component's state", async () => {
    const { Counter } = await load<{
      Counter: new () => Flex & { readonly text: { text: string; width: number | undefined; align: string } };
    }>(compile(PRESS, "Press.tsx"));
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
        {
          fileName: `${process.cwd()}/.test-output/Press${Math.random()}.tsx`,
          text: `import { Flex, Text } from "@tsengine/runtime/jsx";\nfunction C({ wide }: { wide: boolean }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(check(`<Flex onPress={() => {}}><Text width={40} align={wide ? "left" : "right"}>x</Text></Flex>`), []);
    assert.ok(check(`<Text align={wide ? "left" : "middle"}>x</Text>`).length > 0);
  });

  it("type-checks a Text's shadow and outline: colours and numbers, from state too", async () => {
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/TextFx${Math.random()}.tsx`,
          text: `import { Text } from "@tsengine/runtime/jsx";\nfunction C({ big }: { big: boolean }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      check(`<Text shadow="black" shadowX={big ? 2 : 1} shadowY={1} outline="white" outlineWidth={big ? 2 : 1}>Hi</Text>`),
      []
    );
    assert.ok(check(`<Text shadow={3}>Hi</Text>`).length > 0, "a shadow is a colour");
    assert.ok(check(`<Text outlineWidth="thick">Hi</Text>`).length > 0, "an outline width is a number");
    const { Label } = await load<{ Label: new () => Text & { s: { [field: string]: unknown } } }>(
      compile(
        `function Label() { const s = useMutable({ on: false }); return <Text shadow="black" shadowX={s.on ? 3 : 1} outline={s.on ? "red" : "blue"} outlineWidth={2}>Hi</Text>; }`,
        "TextFx.tsx"
      )
    );
    const label = new Label();
    new World().mount(label);
    assert.deepEqual([label.shadow, label.shadowX, label.shadowY, label.outline, label.outlineWidth], ["black", 1, 1, "blue", 2]);
    label.s.on = true;
    label.world!.flush();
    assert.deepEqual([label.shadowX, label.outline], [3, "red"]);
  });

  it("compiles a Slider and a Toggle whose onChange takes a number and a flag, and runs them against the component's state", async () => {
    const source = `
function Settings() {
  const s = useMutable({ volume: 3, sound: true, label: "" });
  return (
    <Flex direction="column" gap={4}>
      <Slider width={100} min={0} max={10} step={1} value={s.volume} onChange={(v) => { s.volume = Math.round(v); s.label = v > 5 ? "loud" : "quiet"; }} />
      <Toggle checked={s.sound} onChange={(on) => { s.sound = on; }} />
      <Text>{s.label}{s.sound ? " on" : " off"}</Text>
    </Flex>
  );
}`;
    const { Settings } = await load<{ Settings: new () => Flex }>(compile(source, "Settings.tsx"));
    const settings = new Settings();
    const world = new World();
    world.mount(settings);
    const [slider, toggle, text] = settings.children as [Slider, Toggle, Text];
    assert.ok(slider instanceof Slider && toggle instanceof Toggle);
    assert.deepEqual([slider.value, slider.min, slider.max, slider.step, toggle.checked], [3, 0, 10, 1, true]);
    slider.box.size[0] = 100;
    slider.box.size[1] = 14;
    assert.equal(world.reportPress(slider, 100, 5), true);
    world.flush();
    assert.equal(slider.value, 10, "the slider moved to the end and told the handler a number");
    assert.equal(text.text, "loud on");
    toggle.box.size[0] = 36;
    toggle.box.size[1] = 18;
    world.reportPress(toggle, 5, 5);
    world.flush();
    assert.equal(toggle.checked, false);
    assert.equal(text.text, "loud off", "and the toggle told its handler a flag");
  });

  it("compiles a Menu of Buttons with their labels as children, and onAdjust and onBack reach the component's handlers", async () => {
    const source = `
function Options({ onClose }: { onClose: () => void }) {
  const s = useMutable({ volume: 5, chosen: "" });
  return (
    <Menu gap={2} onBack={onClose}>
      <Button autoFocus onAdjust={(d) => { s.volume += d; }} onPress={() => { s.chosen = "volume"; }}>
        <Text>Volume {s.volume}</Text>
      </Button>
      <Button onPress={() => { s.chosen = "done"; }}>
        <Text>Done</Text>
      </Button>
    </Menu>
  );
}`;
    const closed: string[] = [];
    const { Options } = await load<{ Options: new (props: { onClose: () => void }) => MenuBox }>(compile(source, "Options.tsx"));
    const options = new Options({ onClose: () => closed.push("closed") });
    assert.ok(options instanceof MenuBox);
    const [volume, done] = options.children as [Button, Button];
    assert.ok(volume instanceof Button && done instanceof Button);
    done.transform.y = 20;
    const world = new World();
    world.mount(options);
    world.flush();
    const controls = createControls({
      left: ["ArrowLeft"],
      right: ["ArrowRight"],
      up: ["ArrowUp"],
      down: ["ArrowDown"],
      confirm: ["Z"],
      back: ["X"],
    });
    const press = (...pressed: string[]) => {
      world.tick(1 / 60, createInputState({ pressed }, controls));
      world.flush();
    };
    press();
    press("ArrowRight");
    press("ArrowRight");
    assert.equal((volume.children[0] as Text).text, "Volume 7");
    press("ArrowDown");
    assert.equal(world.focused, done);
    press("Z");
    press("X");
    assert.deepEqual(closed, ["closed"]);
  });

  it("type-checks a Slider's and a Toggle's props and the parameter of onChange, in the source and the generated module", () => {
    assert.deepEqual(
      typeCheck(
        compile(
          `function C() { const s = useMutable({ v: 1 }); return <Slider value={s.v} onChange={(x) => { s.v = x; }} />; }`,
          "SliderOk.tsx"
        )
      ),
      []
    );
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/Widget${Math.random()}.tsx`,
          text: `import { Slider, Toggle } from "@tsengine/runtime/jsx";\nfunction C({ n }: { n: number }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      check(`<Slider value={n} min={0} max={10} step={2} thumbWidth={6} fillColor="red" onChange={(v) => v.toFixed(1)} />`),
      []
    );
    assert.deepEqual(check(`<Toggle checked={n > 1} onColor="green" onChange={(on) => !on} />`), []);
    assert.ok(check(`<Slider value="loud" />`).length > 0, "a value is a number");
    assert.ok(check(`<Slider onChange={(v: string) => v} />`).length > 0, "onChange is given a number");
    assert.ok(check(`<Toggle checked="yes" />`).length > 0, "checked is a boolean");
    assert.ok(check(`<Toggle onChange={(on: number) => on} />`).length > 0, "onChange is given a flag");
    const checkMenu = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/MenuCheck${Math.random()}.tsx`,
          text: `import { Button, Menu, Text } from "@tsengine/runtime/jsx";\nfunction C({ n }: { n: number }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      checkMenu(
        `<Menu loop={false} onBack={() => n}><Button onAdjust={(d) => d.toFixed(0)} focusBackground="red"><Text>Go</Text></Button></Menu>`
      ),
      []
    );
    assert.ok(checkMenu(`<Button onAdjust={(d: string) => d} />`).length > 0, "onAdjust is given a number");
    assert.ok(checkMenu(`<Menu loop="yes" />`).length > 0, "loop is a boolean");
  });

  it("compiles a TextInput bound to state and a Tooltip in a Button, and type-checks their props", async () => {
    const source = `
function Name() {
  const s = useMutable({ name: "", sent: "" });
  return (
    <Flex direction="column">
      <TextInput autoFocus value={s.name} placeholder="Your name" maxLength={8} onChange={(v) => { s.name = v.toUpperCase(); }} onSubmit={(v) => { s.sent = v; }} />
      <Button onPress={() => { s.sent = s.name; }}>
        <Text>Go</Text>
        <Tooltip><Text>Send {s.name}</Text></Tooltip>
      </Button>
    </Flex>
  );
}`;
    const compiled = compile(source, "NameField.tsx");
    assert.deepEqual(typeCheck(compiled), []);
    const { Name } = await load<{ Name: new () => Flex & { s: { name: string; sent: string } } }>(compiled);
    const name = new Name();
    const world = new World();
    world.mount(name);
    world.flush();
    const type = (typed: string, ...pressed: string[]) => {
      world.tick(1 / 60, createInputState({ typed, pressed }));
      world.flush();
    };
    type("");
    type("ada");
    const field = name.children[0] as TextInput;
    assert.equal(name.s.name, "ADA");
    assert.equal(field.value, "ADA", "the state's value is written back into the field");
    type("", "Enter");
    assert.equal(name.s.sent, "ADA");
    const tip = (name.children[1] as Button).children[1] as Tooltip;
    assert.ok(tip instanceof Tooltip);
    assert.equal((tip.children[0] as Text).text, "Send ADA");
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/TextCheck${Math.random()}.tsx`,
          text: `import { Flex, Text, TextInput, Tooltip } from "@tsengine/runtime/jsx";\nfunction C({ n }: { n: string }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(check(`<TextInput value={n} onChange={(v) => v.trim()} onSubmit={(v) => v.length} textSize={8} />`), []);
    assert.ok(check(`<TextInput value={3} />`).length > 0, "a value is a string");
    assert.ok(check(`<TextInput onChange={(v: number) => v} />`).length > 0, "onChange is given a string");
    assert.ok(check(`<Tooltip show="yes" />`).length > 0, "show is a boolean");
    assert.ok(compileErrors(`function C() { return <TextInput><Text>no</Text></TextInput>; }`).length > 0, "a TextInput takes no children");
  });

  it("checks a Text's align literal with a suggestion", () => {
    const errors = compileErrors(`function C() { return <Text align="centre">x</Text>; }`);
    assert.deepEqual(
      errors.map((d) => d.code),
      [DiagnosticCode.InvalidPropValue]
    );
    assert.match(errors[0]!.message, /<Text align> must be one of "left", "center", "right", not 'centre' \(did you mean "center"\?\)/);
    assert.doesNotThrow(() => compile(`function C() { return <Text align="right" width={30}>x</Text>; }`));
  });
});

describe("Flex: diagnostics", () => {
  it("checks the keyword props against their choices, with a suggestion, and explains CSS's spelling", () => {
    for (const [attribute, expected] of [
      [`direction="colum"`, /<Flex direction> must be one of "row", "column", not 'colum' \(did you mean "column"\?\)/],
      [
        `alignItems="flex-start"`,
        /<Flex alignItems> must be one of "start", "center", "end", "stretch", not 'flex-start' \(did you mean "start"\?\)/,
      ],
      [`justifyContent="flex-end"`, /did you mean "end"\?/],
      [`justifyContent="space-betwen"`, /did you mean "space-between"\?/],
      [
        `anchor="middle"`,
        /<Flex anchor> must be one of "top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", not 'middle'/,
      ],
      [`to="top-righ"`, /<Flex to> must be one of .*did you mean "top-right"\?/],
      [`overflow="scrol"`, /<Flex overflow> must be one of "visible", "hidden", "scroll", not 'scrol' \(did you mean "scroll"\?\)/],
    ] as const) {
      const errors = compileErrors(`function C() { return <Flex ${attribute} />; }`);
      assert.deepEqual(
        errors.map((d) => d.code),
        [DiagnosticCode.InvalidPropValue],
        attribute
      );
      assert.match(errors[0]!.message, expected);
    }
  });

  it("accepts a number, fit, grow and a percentage for a size, and rejects anything else written out", () => {
    for (const value of [`{120}`, `"fit"`, `"grow"`, `"50%"`, `"12.5%"`, `"100%"`, `"0%"`]) {
      assert.doesNotThrow(() => compile(`function C() { return <Flex width=${value} height=${value} />; }`), value);
    }
    for (const [value, hint] of [
      [`"grwo"`, `did you mean "grow"`],
      [`"fill"`, ""],
      [`"101%"`, ""],
      [`"50"`, ""],
      [`"50 %"`, ""],
      [`{true}`, ""],
    ] as const) {
      const errors = compileErrors(`function C() { return <Flex width=${value} />; }`);
      assert.deepEqual(
        errors.map((d) => d.code),
        [DiagnosticCode.InvalidPropValue],
        value
      );
      assert.match(errors[0]!.message, /<Flex width> must be a number of pixels, "fit", "grow", or a percentage/);
      if (hint) assert.ok(errors[0]!.message.includes(hint), errors[0]!.message);
    }
  });

  it("leaves an expression to the type-check, which knows the type of a size", () => {
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/Flex${Math.random()}.tsx`,
          text: `import { Flex } from "@tsengine/runtime/jsx";\nfunction C({ big }: { big: boolean }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      check(`<Flex width={big ? "grow" : 120} height={big ? "50%" : "fit"} gap={4} padding={2} paddingX={3} minWidth={10} />`),
      []
    );
    assert.ok(check(`<Flex width={big ? "grwo" : 120} />`).length > 0, "a bad keyword inside an expression");
    assert.ok(check(`<Flex direction={big ? "row" : "diagonal"} />`).length > 0);
    assert.ok(check(`<Flex gap="wide" />`).length > 0);
  });

  it("is a container, can be placed with transform, takes elements as children, and type-checks generated", () => {
    assert.doesNotThrow(() => compile(`function C() { return <Flex x={4}><Shape kind="rect" width={1} height={1} /></Flex>; }`));
    assert.deepEqual(typeCheck(compile(SOURCE, "FlexGame.tsx")), []);
  });

  it("lets state take its names, kept in `$name` fields", () => {
    for (const name of ["direction", "gap", "padding", "width", "minWidth", "background", "box"]) {
      assert.ok(compile(`function C() { const ${name} = useMutable({ n: 1 }); return <Flex />; }`).code.includes(`get $${name}()`), name);
    }
  });

  it("lets a component of the game's own called Menu or Button shadow the built-in, as a name does in React", async () => {
    const source = `
function Button({ label }: { label: string }) {
  return <Flex padding={2}><Text>{label}</Text></Flex>;
}

function Menu() {
  return (
    <Flex direction="column">
      <Button label="Play" />
    </Flex>
  );
}`;
    const { Menu: Mine } = await load<{ Menu: new () => Flex }>(compile(source, "OwnMenu.tsx"));
    const menu = new Mine();
    assert.ok(!(menu instanceof MenuBox), "the file's own Menu, not the built-in");
    assert.ok(!(menu.children[0] instanceof Button) && menu.children[0] instanceof Flex);
    const errors = compileErrors(
      `import { Entity, Flex } from "@tsengine/runtime/jsx"; function Flex() { return <Entity name="Flex" />; }`
    );
    assert.ok(errors.some((d) => /conflicts with the built-in <Flex> this file imports/.test(d.message)));
  });
});

describe("Flex: floating props", () => {
  it("accepts float as a bare attribute, with anchors and offsets, and sets them on the box", () => {
    const out = compile(
      `function C() { return <Flex width={40} height={20}><Flex float anchor="top-right" to="top-right" offsetX={-4} offsetY={4} width={8} height={8} /></Flex>; }`
    );
    assert.match(JSON.stringify(out), /float: true, anchor: \\"top-right\\"|float: true, anchor: "top-right"/);
  });
});

describe("Flex: border, rounded corners, and hover and focus colours", () => {
  const STYLED = `
function Tile() {
  const s = useMutable({ accent: "gold", round: 4 });
  return (
    <Flex
      width={40}
      height={20}
      background="navy"
      borderWidth={2}
      borderColor={s.accent}
      borderRadius={s.round}
      hoverBackground="#334"
      hoverBorderColor="white"
      focusable
      focusBackground="#223"
      focusBorderColor="yellow"
      pressedBackground="#112"
      pressedBorderColor="orange"
      disabled={s.round > 100}
      disabledBackground="gray"
      disabledBorderColor="silver"
      transition={0.15}
      overflow={s.round > 100 ? "scroll" : "hidden"}
      scrollY={s.round}
      opacity={s.round > 100 ? 0.5 : 1}
      wrap={s.round < 100}
      rowGap={s.round}
      columnGap={2}
      backgroundImage="skin.png"
      slice={8}
      sliceBottom={s.round}
      hoverBackgroundImage="skin-hover.png"
      focusBackgroundImage="skin-focus.png"
      pressedBackgroundImage="skin-down.png"
      disabledBackgroundImage="skin-off.png"
    />
  );
}
`;

  it("takes every prop from the element, static or from state, and updates them when state changes", async () => {
    const { Tile } = await load<{ Tile: new () => Flex & { s: { [field: string]: unknown } } }>(compile(STYLED, "FlexStyled.tsx"));
    const world = new World();
    const tile = new Tile();
    world.mount(tile);
    assert.deepEqual(
      [
        tile.background,
        tile.borderWidth,
        tile.borderColor,
        tile.borderRadius,
        tile.hoverBackground,
        tile.hoverBorderColor,
        tile.focusBackground,
        tile.focusBorderColor,
      ],
      ["navy", 2, "gold", 4, "#334", "white", "#223", "yellow"]
    );
    assert.deepEqual(
      [tile.pressedBackground, tile.pressedBorderColor, tile.disabled, tile.disabledBackground, tile.disabledBorderColor],
      ["#112", "orange", false, "gray", "silver"]
    );
    assert.equal(tile.transition, 0.15);
    assert.deepEqual([tile.overflow, tile.scrollX, tile.scrollY], ["hidden", 0, 4]);
    assert.equal(tile.opacity, 1);
    assert.deepEqual([tile.wrap, tile.rowGap, tile.columnGap], [true, 4, 2]);
    assert.deepEqual([tile.backgroundImage, tile.slice, tile.sliceBottom, tile.sliceTop], ["skin.png", 8, 4, undefined]);
    assert.deepEqual(
      [tile.hoverBackgroundImage, tile.focusBackgroundImage, tile.pressedBackgroundImage, tile.disabledBackgroundImage],
      ["skin-hover.png", "skin-focus.png", "skin-down.png", "skin-off.png"]
    );
    tile.s.accent = "red";
    tile.s.round = 800;
    world.flush();
    assert.deepEqual([tile.borderColor, tile.borderRadius, tile.disabled], ["red", 800, true], "disabled follows state");
    assert.deepEqual([tile.overflow, tile.scrollY, tile.opacity], ["scroll", 800, 0.5], "and overflow, the scroll offset and the opacity");
  });

  it("type-checks the generated code, and rejects a prop of the wrong type, in the source", () => {
    assert.deepEqual(typeCheck(compile(STYLED, "FlexStyled.tsx")), []);
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/Styled${Math.random()}.tsx`,
          text: `import { Flex } from "@tsengine/runtime/jsx";\nfunction C({ wide }: { wide: boolean }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      check(
        `<Flex borderWidth={wide ? 2 : 0} borderColor="red" borderRadius={4} hoverBackground="blue" focusBorderColor="white" pressedBackground="navy" disabled={wide} disabledBorderColor="gray" transition={wide ? 0.2 : 0} />`
      ),
      []
    );
    assert.ok(check(`<Flex transition="slow" />`).length > 0, "a transition is a number of seconds");
    assert.deepEqual(check(`<Flex overflow={wide ? "scroll" : "hidden"} scrollX={0} scrollY={wide ? 9999 : 0} />`), []);
    assert.ok(check(`<Flex overflow="auto" />`).length > 0, "overflow is one of three words");
    assert.ok(check(`<Flex scrollY="end" />`).length > 0, "a scroll offset is a number");
    assert.deepEqual(check(`<Flex backgroundImage="a.png" slice={wide ? 8 : 4} sliceTop={2} hoverBackgroundImage="b.png" />`), []);
    assert.ok(check(`<Flex slice="8" />`).length > 0, "a slice is a number of pixels");
    assert.ok(check(`<Flex backgroundImage={3} />`).length > 0, "an image is a name");
    assert.deepEqual(check(`<Flex opacity={wide ? 0.5 : 1} />`), []);
    assert.ok(check(`<Flex opacity="half" />`).length > 0, "an opacity is a number");
    assert.deepEqual(check(`<Flex wrap rowGap={wide ? 4 : 2} columnGap={1} gap={2} />`), []);
    assert.ok(check(`<Flex wrap="yes" />`).length > 0, "wrap is a boolean");
    assert.ok(check(`<Flex rowGap="wide" />`).length > 0, "a gap is a number of pixels");
    assert.ok(check(`<Flex disabled="yes" />`).length > 0, "disabled is a boolean");
    assert.ok(check(`<Flex borderWidth="thick" />`).length > 0, "a width is a number");
    assert.ok(check(`<Flex hoverBackground={4} />`).length > 0, "a colour is a string");
    assert.ok(check(`<Flex hoverWidth={4} />`).length > 0, "and a made-up prop is not accepted");
  });
});

describe("Flex: a size worked out as a percentage", () => {
  // The generated render() works a value out into a temporary before writing it; the temporary is typed as the field, so a
  // template literal checks as `${number}%` (as it does written in place in the editor), not as a plain string.
  it("typechecks a width or height made from a template literal, on the root and on a child", () => {
    const compiled = compile(`
export function Bar({ pct, fill }: { pct: number; fill: number }) {
  return (
    <Flex width={\`\${pct}%\`} height={4} direction="row">
      <Flex width={\`\${fill}%\`} height={\`\${pct / 2}%\`} background="#fff" />
    </Flex>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /const \$\d+: Bar\["width"\] = `\$\{this\.props\.pct\}%`;/);
  });

  it("still refuses a string that is not a size, on the root and on a child", () => {
    const compiled = compile(`
export function Bar({ pct }: { pct: number }) {
  return (
    <Flex width={\`\${pct}px\`} height={4}>
      <Flex height={\`\${pct}em\`} />
    </Flex>
  );
}`);
    const errors = typeCheck(compiled);
    // The child's value is checked where it is made and where render() updates it.
    assert.ok(errors.some((error) => /`\$\{number\}px`' is not assignable to type 'FlexSizing'/.test(error.message)));
    assert.ok(errors.some((error) => /`\$\{number\}em`' is not assignable to type 'FlexSizing/.test(error.message)));
    for (const error of errors) assert.match(error.message, /is not assignable to type 'FlexSizing/);
  });
});
