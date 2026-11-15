import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Camera, Collider, Entity, Flex, GameObject, Hud, Pointer, Screen, Shape, Text, getSoundSink } from "@rge/runtime";

import { FrameBuilder } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

function draw(
  root: GameObject,
  width = 640,
  height = 360
): { records: DecodedRecord[]; warnings: string[]; built: ReturnType<FrameBuilder["build"]> } {
  const backend = new RecordingBackend();
  const warnings: string[] = [];
  const builder = new FrameBuilder({ loadTexture: (path) => backend.loadTexture(path), warn: (m) => warnings.push(m) });
  const built = builder.build(root, width, height);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return { records: [...backend.lastFrame.records], warnings, built };
}

const box = (x: number, width = 10): Shape => {
  const shape = new Shape({ kind: "rect", width, height: 10 });
  shape.transform.x = x;
  return shape;
};

const ops = (records: readonly DecodedRecord[]): string[] => records.map((r) => (r.op === "rect" ? `rect@${r.x}` : r.op));

function hud(...children: GameObject[]): Hud {
  const layer = new Hud();
  for (const child of children) layer.addChild(child);
  return layer;
}

describe("<Hud>: what is drawn", () => {
  it("draws after the world, through a second view that ignores the camera", () => {
    const root = new Entity();
    const camera = new Camera({ zoom: 2 });
    camera.transform.x = 50;
    camera.addChild(box(1));
    root.addChild(hud(box(100)));
    root.addChild(camera); // later in the tree than the HUD, and still drawn before it
    root.addChild(box(2));
    const { records } = draw(root);
    assert.deepEqual(ops(records), ["view", "rect@1", "rect@2", "view", "rect@100"]);
    const world = records[0];
    const layer = records[3];
    assert.ok(world?.op === "view" && layer?.op === "view");
    assert.equal(world.a, 2, "the world is zoomed");
    assert.deepEqual(layer, { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, "the HUD is not");
  });

  it("is placed by its own transform, and its children by theirs", () => {
    const layer = hud(box(5));
    layer.transform.x = 20;
    layer.transform.y = 7;
    const { records } = draw(layer);
    assert.ok(records[2]?.op === "rect");
    assert.deepEqual([records[2].x, records[2].y], [25, 7]);
  });

  it("orders what is inside by z, and the layers in tree order", () => {
    const high = box(1);
    high.transform.z = 5;
    const root = new Entity();
    root.addChild(hud(high, box(2)));
    root.addChild(hud(box(3)));
    const { records } = draw(root);
    assert.deepEqual(
      ops(records),
      ["view", "view", "rect@2", "rect@1", "rect@3"],
      "a high z inside the first layer does not lift it over the second"
    );
  });

  it("does not let the HUD's z reach into the world's order, or the world's into the HUD's", () => {
    const root = new Entity();
    const worldHigh = box(1);
    worldHigh.transform.z = 100;
    root.addChild(worldHigh);
    root.addChild(box(2));
    const low = box(3);
    low.transform.z = -100;
    root.addChild(hud(box(4), low));
    assert.deepEqual(ops(draw(root).records), ["view", "rect@2", "rect@1", "view", "rect@3", "rect@4"]);
  });

  it("treats a HUD inside a HUD as a plain container", () => {
    const { records } = draw(hud(box(1), hud(box(2))));
    assert.deepEqual(ops(records), ["view", "view", "rect@1", "rect@2"]);
  });

  it("ignores a camera and a collider inside it, warning once about the camera", () => {
    const touched: string[] = [];
    const root = new Entity();
    root.addChild(new Collider({ width: 10, height: 10, onCollisionEnter: () => touched.push("world") }));
    root.addChild(hud(new Camera(), new Camera(), new Collider({ width: 10, height: 10, onCollisionEnter: () => touched.push("hud") })));
    const { built, warnings } = draw(root);
    assert.equal(built.colliders.length, 1, "only the world's collider takes part in collisions");
    assert.deepEqual(touched, []);
    assert.equal(built.camera, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /<Camera> inside a <Hud>/);
  });

  it("draws text in the HUD, in game pixels under a <Screen>", () => {
    const screen = new Screen({ width: 320, height: 180, pixelPerfect: false });
    const camera = new Camera();
    camera.transform.x = 500;
    screen.addChild(camera);
    screen.addChild(hud(new Text({ text: "Score" })));
    const { records, built } = draw(screen, 1280, 720);
    const layer = records.find((r, i) => r.op === "view" && i > 0);
    assert.deepEqual(layer, { op: "view", a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 }, "a HUD pixel is 4 window pixels, whatever the camera does");
    assert.deepEqual(built.hudView, { a: 4, b: 0, c: 0, d: 4, e: 0, f: 0 });
  });

  it("is drawn in game pixels inside a pixel-perfect canvas, where the canvas record does the scaling", () => {
    const screen = new Screen({ width: 320, height: 180 });
    screen.addChild(hud(box(8)));
    const { records, built } = draw(screen, 1280, 720);
    assert.deepEqual(ops(records), ["canvas", "view", "view", "rect@8"]);
    assert.deepEqual(records[2], { op: "view", a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.equal(built.hudView.a, 4, "the mouse still comes from the window");
  });

  it("is drawn before the border bars, which stay last", () => {
    const screen = new Screen({ width: 100, height: 50, pixelPerfect: false });
    screen.addChild(hud(box(1)));
    const { records } = draw(screen, 320, 200);
    // The world's view (nothing in it), the HUD's view and its box, then a view of window pixels and four bars.
    // The world's view (nothing in it), the HUD's view and its box, then a view of window pixels and four bars: left, right, top, bottom.
    assert.deepEqual(ops(records), ["view", "view", "rect@1", "view", "rect@0", "rect@310", "rect@10", "rect@10"]);
  });
});

describe("<Hud>: pointers", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  const WINDOW = { width: 640, height: 360, title: "test" };

  it("presses a HUD pointer where it is drawn, however the camera moves and zooms", () => {
    const presses: string[] = [];
    const button = new Pointer({ width: 40, height: 20, onPress: () => presses.push("hud") });
    button.transform.x = 100;
    button.transform.y = 50;
    const camera = new Camera({ zoom: 3 });
    camera.transform.x = 900;
    camera.transform.y = -400;
    const root = new Entity();
    root.addChild(camera);
    root.addChild(hud(button));
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => root });
    backend.queueInput({ mouse: { x: 120, y: 60 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    assert.deepEqual(presses, ["hud"]);
    backend.queueInput({ mouse: { x: 99, y: 60 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    p.close();
    assert.deepEqual(presses, ["hud"], "a press beside it hits nothing");
  });

  it("gives the press to a HUD pointer before a world pointer under it", () => {
    const presses: string[] = [];
    const world = new Pointer({ width: 100, height: 100, onPress: () => presses.push("world") });
    const button = new Pointer({ width: 50, height: 50, onPress: () => presses.push("hud") });
    const root = new Entity();
    root.addChild(world);
    root.addChild(hud(button));
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => root });
    backend.queueInput({ mouse: { x: 10, y: 10 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    backend.queueInput({ mouse: { x: 80, y: 80 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    p.close();
    assert.deepEqual(presses, ["hud", "world"]);
  });

  it("takes a press through a <Screen> in the HUD's game pixels, and none from the bars", () => {
    const presses: string[] = [];
    const button = new Pointer({ width: 10, height: 10, onPress: () => presses.push("hud") });
    const screen = new Screen({ width: 100, height: 50 });
    screen.addChild(hud(button));
    const backend = new RecordingBackend();
    // A 640 × 360 window shows 100 × 50 at ×6, at (20, 30).
    const p = createPlayer(backend, { ...WINDOW, root: () => screen });
    backend.queueInput({ mouse: { x: 20 + 6 * 5, y: 30 + 6 * 5 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    backend.queueInput({ mouse: { x: 10, y: 45 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    p.close();
    assert.deepEqual(presses, ["hud"]);
  });
});

describe("<Flex> in the frame", () => {
  const rects = (records: readonly DecodedRecord[]) =>
    records.flatMap((r) => (r.op === "rect" ? [[r.x, r.y, r.width, r.height, r.color] as const] : []));

  it("draws its background first, behind its children, the size of the box, at the box's place", () => {
    const row = new Flex({ background: "red", padding: 2, gap: 4 });
    row.transform.x = 100;
    row.addChild(box(0, 10));
    row.addChild(box(0, 10));
    const { records } = draw(row);
    assert.deepEqual(rects(records), [
      [100, 0, 2 + 10 + 4 + 10 + 2, 14, "#ff0000ff"],
      [102, 2, 10, 10, "#ffffffff"],
      [116, 2, 10, 10, "#ffffffff"],
    ]);
  });

  it("fills the window with a growing root, and again at another size after a resize", () => {
    const root = new Flex({ width: "grow", height: "grow", background: "blue", padding: 8 });
    root.addChild(box(0, 4));
    const builder = new FrameBuilder({ loadTexture: () => 0 });
    const first = builder.build(root, 640, 360);
    assert.deepEqual(rects(decode(first)).at(0)?.slice(2, 4), [640, 360]);
    const second = builder.build(root, 1280, 720);
    assert.deepEqual(rects(decode(second)).at(0)?.slice(2, 4), [1280, 720]);
    assert.deepEqual([(root.children[0] as GameObject).layoutX, (root.children[0] as GameObject).layoutY], [8, 8]);
  });

  it("fills the game's canvas, not the window, under a <Screen>", () => {
    const screen = new Screen({ width: 320, height: 180 });
    const layer = hud(new Flex({ width: "grow", height: "grow", background: "blue" }));
    screen.addChild(layer);
    const { records } = draw(screen, 1280, 720);
    assert.deepEqual(rects(records), [[0, 0, 320, 180, "#0000ffff"]]);
  });

  it("pins a corner of the HUD: a column that grows, with space between a top row and a bottom row", () => {
    const top = new Shape({ kind: "rect", width: 30, height: 10 });
    const bottom = new Shape({ kind: "rect", width: 30, height: 20 });
    const column = new Flex({ direction: "column", width: "grow", height: "grow", justifyContent: "space-between", padding: 16 });
    column.addChild(top);
    column.addChild(bottom);
    const screen = new Screen({ width: 320, height: 180 });
    screen.addChild(hud(column));
    draw(screen, 640, 360);
    assert.deepEqual([top.layoutY, bottom.layoutY], [16, 180 - 16 - 20]);
  });

  it("lays out a Flex inside a Flex as part of its parent: the inner one grows into the outer's width", () => {
    const inner = new Flex({ background: "green", width: "grow" });
    inner.addChild(new Shape({ kind: "rect", width: 10, height: 5 }));
    const outer = new Flex({ width: 100, background: "red" });
    outer.addChild(inner);
    const { records } = draw(outer);
    assert.deepEqual(
      rects(records).map((r) => r.slice(0, 4)),
      [
        [0, 0, 100, 5],
        [0, 0, 100, 5],
        [0, 0, 10, 5],
      ]
    );
  });
});

function decode(built: ReturnType<FrameBuilder["build"]>): DecodedRecord[] {
  const backend = new RecordingBackend();
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return [...backend.lastFrame.records];
}

describe("<Text align>", () => {
  const textRecords = (root: GameObject) => draw(root).records.flatMap((r) => (r.op === "text" ? [r] : []));
  const label = (props: { width?: number; align?: "left" | "center" | "right" }): Text => {
    const text = new Text({ text: "Hello", size: 10, ...props }); // 5 characters: 30 wide under the recorder's estimate
    text.transform.x = 100;
    text.transform.y = 7;
    return text;
  };

  it("sits at the start of its box by default, centred or at the end when asked, on whole pixels", () => {
    assert.deepEqual(
      textRecords(label({ width: 80 })).map((t) => [t.x, t.y]),
      [[100, 7]]
    );
    assert.deepEqual(
      textRecords(label({ width: 80, align: "left" })).map((t) => t.x),
      [100]
    );
    assert.deepEqual(
      textRecords(label({ width: 80, align: "center" })).map((t) => t.x),
      [100 + 25]
    );
    assert.deepEqual(
      textRecords(label({ width: 80, align: "right" })).map((t) => t.x),
      [100 + 50]
    );
    assert.deepEqual(
      textRecords(label({ width: 31, align: "center" })).map((t) => t.x),
      [101],
      "(31 - 30) / 2 = 0.5 -> 1"
    );
  });

  it("does nothing without a width, since the box is then the text itself", () => {
    assert.deepEqual(
      textRecords(label({ align: "center" })).map((t) => t.x),
      [100]
    );
    assert.deepEqual(
      textRecords(label({ align: "right" })).map((t) => t.x),
      [100]
    );
  });

  it("overflows a box that is too small, from the start for left and by the excess for the others", () => {
    assert.deepEqual(
      textRecords(label({ width: 10, align: "left" })).map((t) => t.x),
      [100]
    );
    assert.deepEqual(
      textRecords(label({ width: 10, align: "center" })).map((t) => t.x),
      [90]
    );
    assert.deepEqual(
      textRecords(label({ width: 10, align: "right" })).map((t) => t.x),
      [80]
    );
  });

  it("shifts along the text's own axis when it is turned or scaled", () => {
    const text = label({ width: 80, align: "right" });
    text.transform.rotation = Math.PI / 2;
    text.transform.scaleX = 2;
    const [record] = textRecords(text);
    // 50 pixels along a quarter turn, scaled by 2: 100 down.
    assert.ok(Math.abs((record?.x ?? NaN) - 100) < 1e-9 && Math.abs((record?.y ?? NaN) - 107) < 1e-9, `${record?.x}, ${record?.y}`);
  });

  it("is the width layout uses, so a row of fixed-width labels lines up", () => {
    const a = new Text({ text: "Hi", size: 10, width: 60, align: "right" });
    const b = new Text({ text: "Hello", size: 10, width: 60, align: "right" });
    const column = new Flex({ direction: "column" });
    column.addChild(a);
    column.addChild(b);
    const { records } = draw(column);
    const texts = records.flatMap((r) => (r.op === "text" ? [r] : []));
    assert.deepEqual(
      texts.map((t) => t.x + t.text.length * 6),
      [60, 60],
      "both end at the right edge of the 60 box"
    );
    assert.equal(column.box.size[0], 60);
  });
});

describe("<Flex onPress>", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  const WINDOW = { width: 640, height: 360, title: "test" };
  const press = (backend: RecordingBackend, player: { step(): boolean }, x: number, y: number): void => {
    backend.queueInput({ mouse: { x, y }, pressed: ["MouseLeft"] });
    player.step();
    player.step();
  };

  it("is pressed over its laid-out box, which fit its label, and nowhere else", () => {
    const presses: string[] = [];
    const button = new Flex({ padding: 4, onPress: () => presses.push("button") });
    button.transform.x = 100;
    button.transform.y = 50;
    button.addChild(new Shape({ kind: "rect", width: 40, height: 10 }));
    const root = new Entity();
    root.addChild(button);
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => root });
    press(backend, p, 101, 51); // the padding, inside the box
    press(backend, p, 147, 63); // the far corner: 48 × 18
    press(backend, p, 149, 51); // just right of it
    press(backend, p, 101, 69); // just below it
    p.close();
    assert.deepEqual(presses, ["button", "button"]);
  });

  it("is pressed through a HUD while the camera moves and zooms, and a Pointer on top of it wins", () => {
    const presses: string[] = [];
    const button = new Flex({ width: 60, height: 20, onPress: () => presses.push("flex") });
    button.transform.x = 10;
    const over = new Pointer({ width: 20, height: 20, onPress: () => presses.push("pointer") });
    over.transform.x = 10;
    const camera = new Camera({ zoom: 3 });
    camera.transform.x = 500;
    const root = new Entity();
    root.addChild(camera);
    root.addChild(hud(button, over));
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => root });
    press(backend, p, 50, 10); // on the Flex only
    press(backend, p, 15, 10); // on both: the Pointer is later in the tree, so on top
    p.close();
    assert.deepEqual(presses, ["flex", "pointer"]);
  });

  it("follows z, like a Pointer: a Flex raised over another gets the press", () => {
    const presses: string[] = [];
    const low = new Flex({ width: 50, height: 50, onPress: () => presses.push("low") });
    const high = new Flex({ width: 50, height: 50, onPress: () => presses.push("high") });
    high.transform.z = -5;
    const root = new Entity();
    root.addChild(low);
    root.addChild(high);
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { ...WINDOW, root: () => root });
    press(backend, p, 10, 10);
    p.close();
    assert.deepEqual(presses, ["low"], "high is behind (z -5), so low, drawn later, is on top");
  });

  it("is not pressable without an onPress, and a Flex that is not laid out yet has no box", () => {
    const quiet = new Flex({ width: 50, height: 50 });
    assert.equal(quiet.contains(10, 10), false, "no layout has run, so no box");
    const root = new Entity();
    root.addChild(quiet);
    const built = draw(root).built;
    assert.equal(built.pointers.length, 0);
  });
});

describe("<Flex float> in the frame", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });

  it("draws a badge in its button's corner, above the button's own children by z, under a <Hud>", () => {
    const button = new Flex({ width: 40, height: 20, background: "gray" });
    const badge = new Flex({ float: true, anchor: "center", to: "top-right", width: 10, height: 10, background: "red" });
    badge.transform.z = 1;
    button.addChild(badge);
    const hudLayer = hud(button);
    hudLayer.transform.x = 100;
    const { records } = draw(hudLayer);
    const rects = records.flatMap((r) => (r.op === "rect" ? [[r.x, r.y, r.width, r.height, r.color] as const] : []));
    assert.deepEqual(rects, [
      [100, 0, 40, 20, "#808080ff"],
      [100 + 40 - 5, -5, 10, 10, "#ff0000ff"],
    ]);
  });

  it("presses a floating box before the box it covers, and not a floating box's neighbours through it", () => {
    const presses: string[] = [];
    const button = new Flex({ width: 40, height: 20, onPress: () => presses.push("button") });
    const badge = new Flex({
      float: true,
      anchor: "top-right",
      to: "top-right",
      width: 16,
      height: 16,
      onPress: () => presses.push("badge"),
    });
    badge.transform.z = 1;
    button.addChild(badge);
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { width: 640, height: 360, title: "t", root: () => hud(button), warn: () => {} });
    backend.queueInput({});
    p.step();
    // The badge covers (24..40, 0..16) of the button.
    backend.queueInput({ mouse: { x: 30, y: 8 }, pressed: ["MouseLeft"] });
    p.step();
    backend.queueInput({ mouse: { x: 10, y: 8 }, pressed: ["MouseLeft"] });
    p.step();
    p.step();
    p.close();
    assert.deepEqual(presses, ["badge", "button"]);
  });

  it("is anchored to the screen's corners when it is the HUD's root, wherever the window is", () => {
    const corner = new Flex({
      float: true,
      anchor: "bottom-right",
      to: "bottom-right",
      offsetX: -8,
      offsetY: -8,
      width: 20,
      height: 10,
      background: "blue",
    });
    const screen = new Screen({ width: 320, height: 180 });
    screen.addChild(hud(corner));
    const { records } = draw(screen, 1280, 720);
    const rect = records.find((r) => r.op === "rect");
    assert.deepEqual(rect && rect.op === "rect" ? [rect.x, rect.y] : null, [320 - 8 - 20, 180 - 8 - 10]);
  });
});
