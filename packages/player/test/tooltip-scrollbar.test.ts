import assert from "node:assert/strict";
/** `<Tooltip>` (shown while its box has the mouse or the focus), scroll bars on a scroll box, and a scroll box keeping the focus in view. */
import { describe, it } from "node:test";

import { Entity, Flex, Hud, Shape, Text, Tooltip, World, type FlexProps, type GameObject } from "@rge/runtime";

import { FrameBuilder } from "../src/draw.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

function flex(props: FlexProps, ...children: GameObject[]): Flex {
  const f = new Flex(props);
  for (const child of children) f.addChild(child);
  return f;
}

const rows = (count: number, height = 10): Shape[] => Array.from({ length: count }, () => new Shape({ kind: "rect", width: 30, height }));

/** Builds frames of a mounted tree, as the player does, and decodes the last one. */
function frames(root: GameObject) {
  const world = new World();
  world.mount(root);
  world.flush();
  const backend = new RecordingBackend();
  const builder = new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path) });
  const draw = (): DecodedRecord[] => {
    const built = builder.build(root, 200, 100);
    backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
    return [...backend.lastFrame.records];
  };
  return { world, draw, builder };
}

const texts = (records: readonly DecodedRecord[]): string[] => records.flatMap((r) => (r.op === "text" ? [r.text] : []));
const boxes = (records: readonly DecodedRecord[]) => records.flatMap((r) => (r.op === "box" ? [r] : []));

describe("Tooltip", () => {
  const button = () => {
    const tip = new Tooltip();
    tip.addChild(new Text({ text: "5 gold" }));
    const box = flex({ width: 40, height: 12, focusable: true }, new Text({ text: "Sell" }), tip);
    const root = new Entity();
    box.transform.x = 50;
    box.transform.y = 50;
    root.addChild(box);
    return { root, box, tip };
  };

  it("is drawn only while its box has the mouse or the focus, above the box, and makes the box take the mouse", () => {
    const { root, box, tip } = button();
    const { world, draw, builder } = frames(root);
    assert.deepEqual(texts(draw()), ["Sell"], "not shown");
    assert.ok(builder.build(root, 200, 100).pointers.includes(box), "a box with a tooltip takes the mouse");
    world.reportHover(box);
    const shown = draw();
    assert.deepEqual(texts(shown).sort(), ["5 gold", "Sell"]);
    // Attached by its bottom middle to the box's top middle, 2 pixels up.
    assert.equal(tip.layoutY + (tip.box.size[1] as number), -2);
    assert.ok(Math.abs(tip.layoutX + (tip.box.size[0] as number) / 2 - 20) < 0.5, "centred over the box (to the pixel it snaps to)");
    world.reportHover(null);
    assert.deepEqual(texts(draw()), ["Sell"]);
    world.focus(box);
    assert.deepEqual(texts(draw()).sort(), ["5 gold", "Sell"], "the focus shows it too");
  });

  it("is drawn over what comes after it, and `show` forces it", () => {
    const { root, tip } = button();
    root.addChild(flex({ width: 10, height: 10, background: "#00ff00" }));
    tip.show = true;
    const { draw } = frames(root);
    const records = draw();
    const last = records.filter((r) => r.op === "text" || r.op === "rect" || r.op === "box").at(-1);
    assert.equal(last?.op === "text" ? last.text : last?.op, "5 gold", "z 100 puts it last");
    tip.show = false;
    assert.deepEqual(texts(draw()), ["Sell"]);
  });

  it("works in a Hud", () => {
    const { root, box } = button();
    const hud = new Hud();
    hud.addChild(root);
    const { world, draw } = frames(hud);
    assert.deepEqual(texts(draw()), ["Sell"]);
    world.reportHover(box);
    assert.deepEqual(texts(draw()).sort(), ["5 gold", "Sell"]);
  });
});

describe("scroll bars", () => {
  it("draws a bar inside the right edge as long as the box is to its content, where the scroll puts it", () => {
    const box = flex({ direction: "column", width: 40, height: 20, overflow: "scroll" }, ...rows(4));
    const { draw } = frames(box);
    let [bar] = boxes(draw());
    assert.deepEqual([bar?.x, bar?.y, bar?.width, bar?.height], [37, 0, 3, 10], "20 of 40 shows: half the height, at the top");
    box.scrollY = 20;
    [bar] = boxes(draw());
    assert.deepEqual([bar?.x, bar?.y, bar?.height], [37, 10, 10], "scrolled to the end: at the bottom");
  });

  it("draws none for content that fits, a box that does not scroll, or scrollbar={false}; and takes a colour and a width", () => {
    assert.deepEqual(boxes(frames(flex({ direction: "column", width: 40, height: 20, overflow: "scroll" }, ...rows(2))).draw()), []);
    assert.deepEqual(boxes(frames(flex({ direction: "column", width: 40, height: 20, overflow: "hidden" }, ...rows(4))).draw()), []);
    assert.deepEqual(
      boxes(frames(flex({ direction: "column", width: 40, height: 20, overflow: "scroll", scrollbar: false }, ...rows(4))).draw()),
      []
    );
    const [bar] = boxes(
      frames(
        flex({ direction: "column", width: 40, height: 20, overflow: "scroll", scrollbarWidth: 5, scrollbarColor: "#ff0000" }, ...rows(4))
      ).draw()
    );
    assert.equal(bar?.width, 5);
    assert.equal(bar?.fill, "#ff0000ff");
  });

  it("draws a bottom bar for a row, outside the box's own clip, and in a Hud", () => {
    const row = flex({ width: 40, height: 20, overflow: "scroll" }, ...rows(4));
    const records = frames(row).draw();
    const end = records.findIndex((r) => r.op === "scissorEnd");
    const bar = records.findIndex((r) => r.op === "box");
    assert.ok(end >= 0 && bar > end, "after the clip ends");
    const decoded = records[bar] as DecodedRecord & { op: "box" };
    assert.deepEqual([decoded.y, decoded.height, decoded.width], [17, 3, 40 / 3], "120 wide in 40: a third");
    const hud = new Hud();
    hud.addChild(flex({ direction: "column", width: 40, height: 20, overflow: "scroll" }, ...rows(4)));
    assert.equal(boxes(frames(hud).draw()).length, 1);
  });
});

describe("a scroll box and the focus", () => {
  it("scrolls a newly focused child into view, once, so the wheel can move away again", () => {
    const items = Array.from({ length: 6 }, () => flex({ width: 30, height: 10, focusable: true }));
    const box = flex({ direction: "column", width: 40, height: 20, overflow: "scroll", padding: 2 }, ...items);
    const { world, draw } = frames(box);
    draw();
    world.focus(items[4]!);
    draw();
    assert.equal(box.scrollY, 2 + 50 - (20 - 2), "its bottom at the bottom of the view, inside the padding: 34");
    box.scrollY = 0;
    draw();
    assert.equal(box.scrollY, 0, "the focus did not change: the box stays where it was moved");
    world.focus(items[0]!);
    draw();
    assert.equal(box.scrollY, 0, "already in view");
    box.scrollY = 30;
    world.focus(items[1]!);
    draw();
    assert.equal(box.scrollY, 10, "above the view: its top at the top, inside the padding");
  });
});
