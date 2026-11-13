import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Flex, Shape, getSoundSink, type FlexProps, type GameObject } from "@rge/runtime";
import { FrameBuilder } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

type Region = Extract<DecodedRecord, { op: "spriteRegion" }>;

const SIZES = {
  "assets/skin.png": { width: 24, height: 24 },
  "assets/hover.png": { width: 24, height: 24 },
  "assets/wide.png": { width: 30, height: 12 },
};

function draw(root: GameObject, warnings: string[] = [], sizes = true): DecodedRecord[] {
  const backend = new RecordingBackend({ textureSizes: SIZES, missingTextures: ["assets/gone.png"] });
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    ...(sizes ? { textureSize: (handle: number) => backend.textureSize(handle) ?? { width: 0, height: 0 } } : {}),
    warn: (m) => warnings.push(m),
  });
  const built = builder.build(root, 400, 300);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return [...backend.lastFrame.records];
}

const regions = (records: readonly DecodedRecord[]): Region[] => records.filter((r): r is Region => r.op === "spriteRegion");
const part = (r: Region): number[] => [r.x, r.y, r.scaleX, r.scaleY, r.srcX, r.srcY, r.srcW, r.srcH];

function panel(props: FlexProps): Flex {
  return new Flex({ width: 100, height: 60, ...props });
}

describe("<Flex backgroundImage>", () => {
  it("cuts the image into nine: corners at their size, edges stretched along one axis, the middle along both", () => {
    const parts = regions(draw(panel({ backgroundImage: "skin.png", slice: 8 }))).map(part);
    assert.deepEqual(parts, [
      // x, y, scale x, scale y, then the part of the image: x, y, width, height
      [0, 0, 1, 1, 0, 0, 8, 8],
      [8, 0, 84 / 8, 1, 8, 0, 8, 8],
      [92, 0, 1, 1, 16, 0, 8, 8],
      [0, 8, 1, 44 / 8, 0, 8, 8, 8],
      [8, 8, 84 / 8, 44 / 8, 8, 8, 8, 8],
      [92, 8, 1, 44 / 8, 16, 8, 8, 8],
      [0, 52, 1, 1, 0, 16, 8, 8],
      [8, 52, 84 / 8, 1, 8, 16, 8, 8],
      [92, 52, 1, 1, 16, 16, 8, 8],
    ]);
  });

  it("draws every part from the one texture, untinted and unflipped, at its own corner", () => {
    for (const r of regions(draw(panel({ backgroundImage: "skin.png", slice: 8 })))) {
      assert.equal(r.texture, "assets/skin.png");
      assert.deepEqual([r.originX, r.originY, r.flipX, r.flipY, r.tint], [0, 0, false, false, "#ffffffff"]);
    }
  });

  it("puts the image over the background colour and the border, under the children", () => {
    const f = panel({ background: "navy", backgroundImage: "skin.png", slice: 8 });
    f.addChild(new Shape({ kind: "rect", width: 5, height: 5 }));
    const ops = draw(f).map((r) => r.op);
    assert.deepEqual(ops, ["view", "rect", ...Array(9).fill("spriteRegion"), "rect"]);
  });

  it("takes each side's slice from its own prop, then the axis-free slice, then 0", () => {
    const parts = regions(draw(panel({ backgroundImage: "skin.png", slice: 4, sliceBottom: 10, sliceLeft: 2 }))).map(part);
    // columns: left 2, right 4 (from slice); rows: top 4, bottom 10
    assert.deepEqual(parts[0], [0, 0, 1, 1, 0, 0, 2, 4]);
    assert.deepEqual(parts[2], [96, 0, 1, 1, 20, 0, 4, 4]);
    assert.deepEqual(parts[6], [0, 50, 1, 1, 0, 14, 2, 10]);
    assert.deepEqual(parts[8], [96, 50, 1, 1, 20, 14, 4, 10]);
  });

  it("stretches the whole image as one part when there is no slice", () => {
    assert.deepEqual(regions(draw(panel({ backgroundImage: "skin.png" }))).map(part), [[0, 0, 100 / 24, 60 / 24, 0, 0, 24, 24]]);
  });

  it("is placed by the box's transform, and turned and scaled with it", () => {
    const f = panel({ backgroundImage: "skin.png", slice: 8 });
    f.transform.x = 50;
    f.transform.y = 20;
    const [first, , third] = regions(draw(f));
    assert.deepEqual([first?.x, first?.y], [50, 20]);
    assert.deepEqual([third?.x, third?.y], [142, 20]);
    const turned = panel({ backgroundImage: "skin.png", slice: 8 });
    turned.transform.rotation = Math.PI / 2;
    turned.transform.scaleX = 2;
    const parts = regions(draw(turned));
    const corner = parts[2] as Region; // 92 across the box, which is doubled by the scale and then turned a quarter
    assert.ok(Math.abs(corner.x) < 1e-9 && Math.abs(corner.y - 184) < 1e-9, `${corner.x}, ${corner.y}`);
    assert.equal(corner.rotation, Math.PI / 2);
    assert.equal(corner.scaleX, 2, "a corner keeps its size, which the box's own scale doubles");
  });

  it("cuts slices that are bigger than the image down to fit it, and leaves out a part with nothing in it", () => {
    const parts = regions(draw(panel({ backgroundImage: "skin.png", slice: 20 }))).map(part);
    // 20 + 20 is more than the 24 pixels there are: 12 and 12, and no middle
    assert.equal(parts.length, 4);
    assert.deepEqual(parts[0], [0, 0, 1, 1, 0, 0, 12, 12]);
    assert.deepEqual(parts[3], [88, 48, 1, 1, 12, 12, 12, 12]);
  });

  it("shrinks the corners together when the box is smaller than they are", () => {
    const parts = regions(draw(panel({ width: 10, height: 10, backgroundImage: "skin.png", slice: 8 }))).map(part);
    // 16 of corners in 10: all of them 5/8 of their size, no middle
    assert.equal(parts.length, 4);
    assert.deepEqual(parts[0], [0, 0, 5 / 8, 5 / 8, 0, 0, 8, 8]);
    assert.deepEqual(parts[3], [5, 5, 5 / 8, 5 / 8, 16, 16, 8, 8]);
  });

  it("draws a magenta box the size of the box for an image that is missing, and says so once", () => {
    const warnings: string[] = [];
    const records = draw(panel({ backgroundImage: "gone.png", slice: 8 }), warnings);
    assert.deepEqual(records.slice(1).map((r) => (r.op === "rect" ? [r.width, r.height, r.color] : r.op)), [[100, 60, "#ff00ffff"]]);
    assert.equal(warnings.filter((m) => /gone\.png/.test(m)).length, 1);
  });

  it("draws nothing, and says so once, when the backend cannot say how big the picture is", () => {
    const warnings: string[] = [];
    const records = draw(panel({ backgroundImage: "skin.png", slice: 8 }), warnings, false);
    assert.equal(regions(records).length, 0);
    assert.ok(warnings.some((m) => /texture sizes/.test(m)));
  });

  it("draws no image for an empty name or a box with no size", () => {
    assert.equal(regions(draw(panel({ backgroundImage: "" }))).length, 0);
    assert.equal(regions(draw(panel({ width: 0, backgroundImage: "skin.png", slice: 8 }))).length, 0);
  });

  it("is the same frame when it is built again from scratch (retain check)", () => {
    const root = new Entity();
    root.addChild(panel({ backgroundImage: "skin.png", slice: 8 }));
    const backend = new RecordingBackend({ textureSizes: SIZES });
    const builder = new FrameBuilder({ loadTexture: (p) => backend.loadTexture(p), textureSize: (h) => backend.textureSize(h) ?? { width: 0, height: 0 }, retain: "check" });
    builder.build(root, 400, 300);
    builder.build(root, 400, 300);
  });

  it("is hoverable, so it takes the mouse, if it has a hover image", () => {
    const f = panel({ backgroundImage: "skin.png", hoverBackgroundImage: "hover.png" });
    const built = new FrameBuilder({ loadTexture: () => 1, textureSize: () => ({ width: 24, height: 24 }) }).build(f, 400, 300);
    assert.deepEqual(built.pointers, [f]);
  });
});

describe("<Flex> state images, in the loop", () => {
  afterEach(() => {
    assert.equal(getSoundSink(), null, "every test closes its player");
  });
  const IN = { x: 10, y: 10 };
  const OUT = { x: 300, y: 200 };

  function textures(props: FlexProps, inputs: readonly { mouse: { x: number; y: number }; pressed?: string[]; down?: string[] }[]): string[] {
    const backend = new RecordingBackend({ textureSizes: SIZES });
    const root = new Entity();
    root.addChild(panel({ slice: 8, onPress: () => {}, ...props }));
    const p = createPlayer(backend, { width: 400, height: 300, title: "t", root: () => root, warn: () => {} });
    const seen: string[] = [];
    for (const input of inputs) {
      backend.queueInput(input);
      p.step();
      seen.push(regions(backend.lastFrame.records)[0]?.texture ?? "none");
    }
    p.close();
    return seen;
  }

  it("shows the hover image while the mouse is over the box, and the plain one again after", () => {
    const seen = textures({ backgroundImage: "skin.png", hoverBackgroundImage: "hover.png" }, [{ mouse: OUT }, { mouse: IN }, { mouse: IN }, { mouse: OUT }, { mouse: OUT }]);
    assert.equal(seen[0], "assets/skin.png");
    assert.equal(seen[2], "assets/hover.png");
    assert.equal(seen[4], "assets/skin.png");
  });

  it("takes the state's image over the plain one in the order of the colours: disabled over pressed over hover", () => {
    const props: FlexProps = { backgroundImage: "skin.png", hoverBackgroundImage: "hover.png", pressedBackgroundImage: "wide.png" };
    const pressed = textures(props, [{ mouse: IN }, { mouse: IN }, { mouse: IN, pressed: ["MouseLeft"] }, { mouse: IN, down: ["MouseLeft"] }, { mouse: IN, down: ["MouseLeft"] }]);
    assert.equal(pressed.at(-1), "assets/wide.png");
    const off = textures({ ...props, disabled: true, disabledBackgroundImage: "off.png" }, [{ mouse: IN }, { mouse: IN }, { mouse: IN, pressed: ["MouseLeft"] }, { mouse: IN, down: ["MouseLeft"] }]);
    assert.equal(off.at(-1), "assets/off.png", "disabled shows only its own image, whatever the mouse is doing");
  });

  it("keeps the plain image for a state that has none of its own", () => {
    const seen = textures({ backgroundImage: "skin.png", pressedBackgroundImage: "hover.png" }, [{ mouse: OUT }, { mouse: IN }, { mouse: IN }]);
    assert.equal(seen.at(-1), "assets/skin.png");
  });
});
