import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Flex, Text, type GameObject, type TextProps } from "@rge/runtime";
import { FrameBuilder } from "../src/draw.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

type TextRecord = Extract<DecodedRecord, { op: "text" }>;
type Region = Extract<DecodedRecord, { op: "spriteRegion" }>;

function draw(root: GameObject, warnings: string[] = [], retain = false): DecodedRecord[] {
  const backend = new RecordingBackend({ textureSizes: { "assets/font.png": { width: 160, height: 96 } } });
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    textureSize: (handle) => backend.textureSize(handle) ?? { width: 0, height: 0 },
    measureText: (text, size) => ({ width: text.length * 8, height: size }),
    warn: (m) => warnings.push(m),
    ...(retain ? { retain: "check" as const } : {}),
  });
  const built = builder.build(root, 400, 300);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return [...backend.lastFrame.records];
}

const text = (props: Partial<TextProps> & { text?: string }): Text => new Text({ text: "Hi", size: 10, ...props });
const texts = (records: readonly DecodedRecord[]): TextRecord[] => records.filter((r): r is TextRecord => r.op === "text");
const at = (r: TextRecord): string => `${r.x},${r.y}`;

describe("<Text shadow>", () => {
  it("draws nothing extra without one: the text is one record, as it always was", () => {
    assert.deepEqual(texts(draw(text({}))).map((r) => [r.text, r.color]), [["Hi", "#ffffffff"]]);
  });

  it("draws the text under itself a pixel right and down in the shadow's colour, then the text", () => {
    const records = texts(draw(text({ shadow: "black" })));
    assert.deepEqual(records.map((r) => [at(r), r.color]), [["1,1", "#000000ff"], ["0,0", "#ffffffff"]]);
  });

  it("falls where shadowX and shadowY say, and either can be 0 or negative", () => {
    assert.deepEqual(texts(draw(text({ shadow: "black", shadowX: -2, shadowY: 3 }))).map(at), ["-2,3", "0,0"]);
    assert.deepEqual(texts(draw(text({ shadow: "black", shadowX: 0, shadowY: 0 }))).map(at), ["0,0", "0,0"]);
  });

  it("is a shadow of no offset when the offset is not a number, rather than a text lost", () => {
    assert.deepEqual(texts(draw(text({ shadow: "black", shadowX: Number.NaN, shadowY: Number.POSITIVE_INFINITY }))).map(at), ["0,0", "0,0"]);
  });

  it("is the text's own position and colour for the text itself, whatever the effects drew", () => {
    const t = text({ shadow: "black", color: "red" });
    t.transform.x = 30;
    t.transform.y = 7;
    const records = texts(draw(t));
    assert.deepEqual(records.map((r) => [at(r), r.color]), [["31,8", "#000000ff"], ["30,7", "#ff0000ff"]]);
  });
});

describe("<Text outline>", () => {
  const offsets = (records: readonly TextRecord[]): string[] => records.slice(0, -1).map(at);

  it("draws the text in the outline colour at each of the 8 pixels around it, then the text", () => {
    const records = texts(draw(text({ outline: "black" })));
    assert.equal(records.length, 9);
    assert.deepEqual(new Set(offsets(records)), new Set(["-1,-1", "0,-1", "1,-1", "-1,0", "1,0", "-1,1", "0,1", "1,1"]));
    assert.ok(records.slice(0, -1).every((r) => r.color === "#000000ff"));
    assert.deepEqual([at(records.at(-1)!), records.at(-1)!.color], ["0,0", "#ffffffff"]);
  });

  it("is thicker with outlineWidth, a ring of the pixels within it, and no thicker than 3", () => {
    assert.equal(texts(draw(text({ outline: "black", outlineWidth: 2 }))).length, 21 - 1 + 1);
    assert.equal(texts(draw(text({ outline: "black", outlineWidth: 3 }))).length, 37 - 1 + 1);
    assert.equal(texts(draw(text({ outline: "black", outlineWidth: 99 }))).length, 37, "clamped to 3");
    assert.equal(texts(draw(text({ outline: "black", outlineWidth: 1.4 }))).length, 9, "to a whole pixel");
  });

  it("draws no outline for a width under 1 or that is not a number, only the text", () => {
    for (const outlineWidth of [0, -2, 0.4, Number.NaN]) assert.equal(texts(draw(text({ outline: "black", outlineWidth }))).length, 1, String(outlineWidth));
  });

  it("is a shadow of the outlined shape when there are both: the outline's every offset, moved by the shadow's, then the outline, then the text", () => {
    const records = texts(draw(text({ outline: "white", shadow: "black", shadowX: 2, shadowY: 2, color: "red" })));
    assert.equal(records.length, 9 + 8 + 1);
    const shadow = records.slice(0, 9);
    assert.ok(shadow.every((r) => r.color === "#000000ff"));
    assert.deepEqual(new Set(shadow.map(at)), new Set(["1,1", "2,1", "3,1", "1,2", "2,2", "3,2", "1,3", "2,3", "3,3"]));
    assert.ok(records.slice(9, 17).every((r) => r.color === "#ffffffff"));
    assert.deepEqual([at(records[17]!), records[17]!.color], ["0,0", "#ff0000ff"]);
  });
});

describe("<Text> effects are drawn with the text", () => {
  it("scale and turn with it: an offset is in the text's own axes", () => {
    const t = text({ shadow: "black", shadowX: 2, shadowY: 0 });
    t.transform.scaleX = 3;
    t.transform.rotation = Math.PI / 2;
    const [shadow, main] = texts(draw(t));
    // 2 pixels along the text's x, tripled by the scale, then turned a quarter: straight down 6
    assert.ok(Math.abs(shadow!.x) < 1e-9 && Math.abs(shadow!.y - 6) < 1e-9, at(shadow!));
    assert.deepEqual([shadow!.scaleX, shadow!.rotation], [3, Math.PI / 2]);
    assert.deepEqual([main!.x, main!.y], [0, 0]);
  });

  it("repeat each line of wrapped text, all the effects first and then the lines themselves", () => {
    const records = texts(draw(text({ text: "aa bb", maxWidth: 20, shadow: "black" })));
    assert.deepEqual(records.map((r) => [r.text, at(r), r.color]), [
      ["aa", "1,1", "#000000ff"],
      ["bb", "1,11", "#000000ff"],
      ["aa", "0,0", "#ffffffff"],
      ["bb", "0,10", "#ffffffff"],
    ]);
  });

  it("repeat the glyphs of a bitmap font, tinted, in the same order", () => {
    const regions = draw(text({ text: "AB", font: "font.png", shadow: "black" })).filter((r): r is Region => r.op === "spriteRegion");
    assert.equal(regions.length, 4);
    assert.deepEqual(regions.map((r) => r.tint), ["#000000ff", "#000000ff", "#ffffffff", "#ffffffff"]);
    assert.deepEqual([regions[0]!.x, regions[0]!.y, regions[2]!.x, regions[2]!.y], [1, 1, 0, 0]);
  });

  it("take no room: a box that fits its text is as big as it was", () => {
    const size = (props: Partial<TextProps>): number[] => {
      const f = new Flex({ padding: 2 });
      f.addChild(text(props));
      const builder = new FrameBuilder({ loadTexture: () => 0, measureText: (t, s) => ({ width: t.length * 8, height: s }) });
      builder.build(f, 400, 300);
      return [f.box.size[0] as number, f.box.size[1] as number];
    };
    assert.deepEqual(size({ shadow: "black", outline: "white", outlineWidth: 3 }), size({}));
  });

  it("warn once of a colour that cannot be read, and draw it magenta", () => {
    const warnings: string[] = [];
    const records = texts(draw(text({ shadow: "not-a-colour" }), warnings));
    assert.equal(records[0]!.color, "#ff00ffff");
    assert.equal(warnings.filter((m) => /not-a-colour/.test(m)).length, 1);
  });

  it("are the same frame when it is built again from scratch (retain check), and an empty text draws none", () => {
    const root = new Entity();
    root.addChild(text({ outline: "black", shadow: "gray" }));
    root.addChild(text({ text: "", outline: "black", shadow: "gray" }));
    assert.equal(texts(draw(root, [], true)).length, 9 + 8 + 1);
  });
});
