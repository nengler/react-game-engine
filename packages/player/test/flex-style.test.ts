import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Entity, Flex, Hud, Shape, getSoundSink, type FlexProps, type GameObject } from "@rge/runtime";

import { FrameBuilder } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { KEYS, RGE_IN_LEN, RGE_OP_BOX_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

type Box = Extract<DecodedRecord, { op: "box" }>;
type Rect = Extract<DecodedRecord, { op: "rect" }>;

const WINDOW = { width: 200, height: 100, title: "test" };

function draw(root: GameObject): DecodedRecord[] {
  const backend = new RecordingBackend();
  const builder = new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path) });
  const built = builder.build(root, WINDOW.width, WINDOW.height);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return [...backend.lastFrame.records];
}

const boxes = (records: readonly DecodedRecord[]): Box[] => records.filter((r): r is Box => r.op === "box");
const rects = (records: readonly DecodedRecord[]): Rect[] => records.filter((r): r is Rect => r.op === "rect");

function button(props: FlexProps, child: GameObject = new Shape({ kind: "rect", width: 10, height: 10 })): Flex {
  const f = new Flex({ width: 40, height: 20, ...props });
  f.addChild(child);
  return f;
}

describe("<Flex> border and borderRadius", () => {
  it("draws a background alone as the plain rect it always was", () => {
    const records = draw(button({ background: "red" }));
    assert.equal(boxes(records).length, 0);
    assert.deepEqual(rects(records)[0], {
      op: "rect",
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 40,
      height: 20,
      color: "#ff0000ff",
    });
  });

  it("draws a box record for a border, the size of the box, with the fill, the border colour, its width and the radius", () => {
    const records = draw(button({ background: "red", borderWidth: 2, borderColor: "blue", borderRadius: 4 }));
    assert.deepEqual(boxes(records), [
      {
        op: "box",
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        width: 40,
        height: 20,
        fill: "#ff0000ff",
        borderColor: "#0000ffff",
        borderWidth: 2,
        radius: 4,
      },
    ]);
    assert.equal(rects(records).length, 1, "only the child's rect: the box replaces the background's");
  });

  it("draws a border with no background (a transparent fill), and a radius with no border", () => {
    assert.deepEqual(
      boxes(draw(button({ borderWidth: 1, borderColor: "white" }))).map((b) => [b.fill, b.borderColor, b.borderWidth, b.radius]),
      [["#00000000", "#ffffffff", 1, 0]]
    );
    assert.deepEqual(
      boxes(draw(button({ background: "red", borderRadius: 6 }))).map((b) => [b.fill, b.borderColor, b.borderWidth, b.radius]),
      [["#ff0000ff", "#00000000", 0, 6]]
    );
  });

  it("draws no border without a colour, or without a width", () => {
    assert.equal(boxes(draw(button({ background: "red", borderWidth: 2 }))).length, 0, "no colour");
    assert.equal(rects(draw(button({ background: "red", borderWidth: 2 })))[0]?.color, "#ff0000ff");
    assert.equal(boxes(draw(button({ background: "red", borderColor: "blue" }))).length, 0, "no width");
    assert.equal(boxes(draw(button({ borderRadius: 4 }))).length, 0, "a radius alone has nothing to round");
  });

  it("is drawn at the box's place and size, in a Hud too, and under its children", () => {
    const layer = new Hud();
    const f = button({ background: "red", borderWidth: 1, borderColor: "blue" });
    f.transform.x = 30;
    layer.addChild(f);
    const records = draw(layer);
    assert.deepEqual(
      records.map((r) => r.op),
      ["view", "view", "box", "rect"],
      "the world's view, then the HUD's"
    );
    assert.ok(records[2]?.op === "box");
    assert.equal(records[2].x, 30);
  });

  it("takes room: the border counts as padding on every side, in a box that fits its children", () => {
    const child = new Shape({ kind: "rect", width: 10, height: 6 });
    const f = new Flex({ padding: 2, borderWidth: 3, borderColor: "blue" });
    f.addChild(child);
    const records = draw(f);
    assert.deepEqual(
      boxes(records).map((b) => [b.width, b.height]),
      [[10 + 2 * 5, 6 + 2 * 5]]
    );
    assert.deepEqual([child.layoutX, child.layoutY], [5, 5]);
  });

  it("takes no room without a colour in any state, and the same room whatever state it is drawn in", () => {
    const fit = (props: FlexProps): number[] => {
      const f = new Flex(props);
      f.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
      draw(f);
      return [f.box.size[0] as number, f.box.size[1] as number];
    };
    assert.deepEqual(fit({ borderWidth: 4 }), [10, 10]);
    assert.deepEqual(fit({ borderWidth: 4, borderColor: "red" }), [18, 18]);
    assert.deepEqual(
      fit({ borderWidth: 4, hoverBorderColor: "red" }),
      [18, 18],
      "the room is kept while the border is not shown, so nothing moves on hover"
    );
  });
});

describe("<Flex> hover and focus props, in the loop", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  /** A window with one 40 × 20 button at its top left; `queue` is the mouse of each step. */
  function run(
    props: FlexProps,
    mice: readonly ({ x: number; y: number } | null)[],
    setup?: (flex: Flex, world: ReturnType<typeof createPlayer>["world"]) => void
  ) {
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = button(props);
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    setup?.(f, p.world);
    const shown: string[][] = [];
    for (const mouse of mice) {
      backend.queueInput(mouse === null ? {} : { mouse });
      p.step();
      const frame = backend.lastFrame.records;
      const b = boxes(frame)[0];
      const r = rects(frame)[0];
      shown.push(b !== undefined ? [b.fill, b.borderColor] : [r?.color ?? "none"]);
    }
    p.close();
    return shown;
  }

  const IN = { x: 10, y: 10 };
  const OUT = { x: 150, y: 80 };

  it("draws hoverBackground and hoverBorderColor while the mouse is over the box, and the plain colours again after", () => {
    const shown = run({ background: "red", borderWidth: 1, borderColor: "blue", hoverBackground: "#00ff00", hoverBorderColor: "white" }, [
      OUT,
      IN,
      IN,
      OUT,
      OUT,
    ]);
    assert.deepEqual(shown.at(0), ["#ff0000ff", "#0000ffff"]);
    // Hover is read at the start of a step and drawn in the same step's frame or the next, so look at where it settled.
    assert.deepEqual(shown.at(2), ["#00ff00ff", "#ffffffff"]);
    assert.deepEqual(shown.at(4), ["#ff0000ff", "#0000ffff"]);
  });

  it("changes only what a hover prop names", () => {
    const shown = run({ background: "red", borderWidth: 1, borderColor: "blue", hoverBorderColor: "white" }, [IN, IN, IN]);
    assert.deepEqual(shown.at(2), ["#ff0000ff", "#ffffffff"]);
  });

  it("can give a background where there was none, and a border colour where there was none", () => {
    assert.deepEqual(run({ hoverBackground: "#00ff00" }, [OUT, IN, IN]).at(2), ["#00ff00ff"]);
    assert.deepEqual(run({ borderWidth: 2, hoverBorderColor: "white" }, [IN, IN, IN]).at(2), ["#00000000", "#ffffffff"]);
    assert.deepEqual(
      run({ borderWidth: 2, hoverBorderColor: "white" }, [OUT, OUT, OUT]).at(2),
      ["#ffffffff"],
      "and the box draws nothing while it is not hovered: this is only its child's rect"
    );
  });

  it("makes the box take the mouse, and lets a press through to what is under it", () => {
    const presses: string[] = [];
    const backend = new RecordingBackend();
    const root = new Entity();
    const under = new Flex({ width: 40, height: 20, onPress: () => presses.push("under") });
    const over = new Flex({ width: 40, height: 20, hoverBackground: "#00ff00" });
    root.addChild(under);
    root.addChild(over);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    for (const input of [{ mouse: IN }, { mouse: IN }, { mouse: IN, pressed: ["MouseLeft"] as const }, { mouse: IN }]) {
      backend.queueInput({ ...input, pressed: input.pressed === undefined ? undefined : [...input.pressed] });
      p.step();
    }
    p.close();
    assert.deepEqual(presses, ["under"]);
    assert.ok(
      boxes(backend.lastFrame.records).length === 0 && rects(backend.lastFrame.records).some((r) => r.color === "#00ff00ff"),
      "and it is drawn hovered"
    );
  });

  it("draws focusBackground and focusBorderColor while the box has the focus", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = button({
      background: "red",
      borderWidth: 1,
      borderColor: "blue",
      focusable: true,
      focusBackground: "yellow",
      focusBorderColor: "white",
    });
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const look = (): string[] => {
      p.step();
      const b = boxes(backend.lastFrame.records)[0] as Box;
      return [b.fill, b.borderColor];
    };
    assert.deepEqual(look(), ["#ff0000ff", "#0000ffff"]);
    p.world.focus(f);
    assert.deepEqual(look(), ["#ffff00ff", "#ffffffff"]);
    p.world.focus(null);
    assert.deepEqual(look(), ["#ff0000ff", "#0000ffff"]);
    p.close();
  });

  it("shows the hover colours over the focus colours when both apply, and the focus colours where hover names none", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = button({
      background: "red",
      borderWidth: 1,
      borderColor: "blue",
      focusable: true,
      focusBackground: "yellow",
      focusBorderColor: "white",
      hoverBackground: "#00ff00",
    });
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    p.world.focus(f);
    let last: Box | undefined;
    for (let i = 0; i < 3; i++) {
      backend.queueInput({ mouse: IN });
      p.step();
      last = boxes(backend.lastFrame.records)[0];
    }
    assert.deepEqual([last?.fill, last?.borderColor], ["#00ff00ff", "#ffffffff"]);
    p.close();
  });

  it("does not move the layout when the mouse comes and goes", () => {
    const sizes: number[] = [];
    const backend = new RecordingBackend();
    const root = new Entity();
    const f = new Flex({ padding: 3, borderWidth: 2, hoverBorderColor: "white" });
    f.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    for (const mouse of [OUT, { x: 5, y: 5 }, { x: 5, y: 5 }, OUT]) {
      backend.queueInput({ mouse });
      p.step();
      sizes.push(f.box.size[0] as number);
    }
    p.close();
    assert.deepEqual(sizes, [20, 20, 20, 20]);
  });

  it("writes the box record at its length", () => {
    assert.equal(RGE_OP_BOX_LEN, 12);
  });
});

describe("<Flex> pressed and disabled props, in the loop", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  const IN = { x: 10, y: 10 };
  const OUT = { x: 150, y: 80 };
  type Input = { mouse: { x: number; y: number }; pressed?: string[]; down?: string[] };

  /** One 40 × 20 button; the fill of the Flex's own box after each step. */
  function run(props: FlexProps, inputs: readonly Input[]): { fills: string[]; presses: number } {
    const backend = new RecordingBackend();
    const root = new Entity();
    let presses = 0;
    root.addChild(button({ onPress: () => presses++, ...props }));
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const fills: string[] = [];
    for (const input of inputs) {
      backend.queueInput(input);
      p.step();
      const frame = backend.lastFrame.records;
      const b = boxes(frame)[0];
      fills.push(b !== undefined ? b.fill : (rects(frame)[0]?.color ?? "none"));
    }
    p.close();
    return { fills, presses };
  }

  const STYLED: FlexProps = {
    background: "#111111",
    hoverBackground: "#222222",
    pressedBackground: "#333333",
    disabledBackground: "#444444",
  };

  it("draws pressedBackground while the button is held on the box, and the hover colour again once it is let go", () => {
    const { fills, presses } = run(STYLED, [
      { mouse: OUT },
      { mouse: IN },
      { mouse: IN },
      { mouse: IN, pressed: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
      { mouse: IN },
      { mouse: IN },
    ]);
    assert.equal(fills[2], "#222222ff", "hovered");
    assert.equal(fills[5], "#333333ff", "held: pressed, over hover");
    assert.equal(fills[7], "#222222ff", "let go: hover again");
    assert.equal(presses, 1);
  });

  it("drops the pressed look while the mouse is dragged off the box, and brings it back on return", () => {
    const { fills } = run(STYLED, [
      { mouse: IN },
      { mouse: IN, pressed: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
      { mouse: OUT, down: ["MouseLeft"] },
      { mouse: OUT, down: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
    ]);
    assert.equal(fills[2], "#333333ff");
    assert.equal(fills[4], "#111111ff", "off the box: plain");
    assert.equal(fills[6], "#333333ff", "back on it, with the button still held: pressed again");
  });

  it("shows only the disabled colours, whatever else is going on, and swallows the click", () => {
    const { fills, presses } = run({ ...STYLED, disabled: true }, [
      { mouse: OUT },
      { mouse: IN },
      { mouse: IN },
      { mouse: IN, pressed: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
      { mouse: IN },
    ]);
    assert.deepEqual(new Set(fills), new Set(["#444444ff"]));
    assert.equal(presses, 0);
  });

  it("without a disabled colour, a disabled box looks plain, not hovered or pressed", () => {
    const { fills } = run({ background: "#111111", hoverBackground: "#222222", pressedBackground: "#333333", disabled: true }, [
      { mouse: IN },
      { mouse: IN },
      { mouse: IN, pressed: ["MouseLeft"] },
      { mouse: IN, down: ["MouseLeft"] },
    ]);
    assert.deepEqual(new Set(fills), new Set(["#111111ff"]));
  });

  it("is pressable again the moment it is switched back on", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    let presses = 0;
    const f = button({ disabled: true, onPress: () => presses++ });
    root.addChild(f);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    const click = (): void => {
      backend.queueInput({ mouse: IN, pressed: ["MouseLeft"] });
      p.step();
      backend.queueInput({ mouse: IN });
      p.step();
    };
    click();
    f.disabled = false;
    click();
    p.close();
    assert.equal(presses, 1);
  });

  it("swallows a click so what is under a disabled box does not get it", () => {
    const backend = new RecordingBackend();
    const root = new Entity();
    const log: string[] = [];
    root.addChild(new Flex({ width: 40, height: 20, onPress: () => log.push("under") }));
    const over = new Flex({ width: 40, height: 20, disabled: true, onPress: () => log.push("over") });
    root.addChild(over);
    const p = createPlayer(backend, { ...WINDOW, root: () => root, warn: () => {} });
    for (const input of [{ mouse: IN }, { mouse: IN, pressed: ["MouseLeft"] }, { mouse: IN }]) {
      backend.queueInput(input);
      p.step();
    }
    p.close();
    assert.deepEqual(log, []);
  });

  it("keeps the room of a border that only a pressed or disabled colour shows, so nothing moves", () => {
    const size = (props: FlexProps): number => {
      const f = new Flex(props);
      f.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
      draw(f);
      return f.box.size[0] as number;
    };
    assert.equal(size({ borderWidth: 3 }), 10);
    assert.equal(size({ borderWidth: 3, pressedBorderColor: "red" }), 16);
    assert.equal(size({ borderWidth: 3, disabledBorderColor: "red" }), 16);
  });
});
