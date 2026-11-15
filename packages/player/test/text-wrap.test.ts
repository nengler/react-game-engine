import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Flex, GameObject, Shape, Text } from "@rge/runtime";

import { FrameBuilder } from "../src/draw.ts";
import { KEYS, RGE_IN_LEN } from "../src/protocol.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

/** A backend that measures the built-in font as 6 pixels a character and a line as `size` tall (so tests can count). */
function build(
  root: GameObject,
  options: { font?: string; sizes?: Record<string, { width: number; height: number }> } = {}
): { records: DecodedRecord[]; builder: FrameBuilder; measured: string[] } {
  const backend = new RecordingBackend({ textureSizes: options.sizes ?? {} });
  const measured: string[] = [];
  const builder = new FrameBuilder({
    loadTexture: (path) => backend.loadTexture(path),
    textureSize: (handle) => backend.textureSize(handle),
    measureText: (text, size) => (measured.push(text), { width: [...text].length * 6, height: size }),
    font: options.font,
  });
  const built = builder.build(root, 320, 180);
  backend.frame(0, built.list.records, built.list.length, built.list.texts, new Float64Array(RGE_IN_LEN), new Uint8Array(KEYS.length));
  return { records: [...backend.lastFrame.records], builder, measured };
}

const lines = (records: readonly DecodedRecord[]) => records.flatMap((r) => (r.op === "text" ? [{ text: r.text, x: r.x, y: r.y }] : []));

describe("<Text maxWidth>: the built-in font", () => {
  it("breaks at spaces so no line is wider than maxWidth, one record a line, one line height apart", () => {
    // 6 px a character: 60 px is 10 characters.
    const text = new Text({ text: "the quick brown fox jumps", size: 10, maxWidth: 60 });
    text.transform.x = 5;
    text.transform.y = 7;
    const out = lines(build(text).records);
    assert.deepEqual(
      out.map((l) => l.text),
      ["the quick", "brown fox", "jumps"]
    );
    assert.deepEqual(
      out.map((l) => [l.x, l.y]),
      [
        [5, 7],
        [5, 17],
        [5, 27],
      ]
    );
  });

  it("puts lineGap between lines", () => {
    const text = new Text({ text: "aa bb cc dd", size: 10, maxWidth: 30, lineGap: 3 });
    const out = lines(build(text).records);
    assert.deepEqual(
      out.map((l) => [l.text, l.y]),
      [
        ["aa bb", 0],
        ["cc dd", 13],
      ]
    );
  });

  it("always breaks at a newline, with or without a maxWidth", () => {
    assert.deepEqual(
      lines(build(new Text({ text: "one\\ntwo".replace("\\n", "\n"), size: 10 })).records).map((l) => l.text),
      ["one", "two"]
    );
    assert.deepEqual(
      lines(build(new Text({ text: "a b\nc", size: 10, maxWidth: 100 })).records).map((l) => l.text),
      ["a b", "c"]
    );
  });

  it("breaks inside a word only when the word alone is wider than maxWidth", () => {
    const text = new Text({ text: "ok supercalifragilistic ok", size: 10, maxWidth: 30 });
    const out = lines(build(text).records).map((l) => l.text);
    assert.deepEqual(out, ["ok", "super", "calif", "ragil", "istic", "ok"]);
    assert.ok(out.every((l) => [...l].length * 6 <= 30));
  });

  it("aligns each line by itself, inside width when there is one, else inside maxWidth", () => {
    const centred = lines(build(new Text({ text: "aaaa bb", size: 10, maxWidth: 30, align: "center" })).records);
    assert.deepEqual(
      centred.map((l) => [l.text, l.x]),
      [
        ["aaaa", 3],
        ["bb", 9],
      ]
    );
    const right = lines(build(new Text({ text: "aaaa bb", size: 10, maxWidth: 30, width: 50, align: "right" })).records);
    assert.deepEqual(
      right.map((l) => [l.text, l.x]),
      [
        ["aaaa", 26],
        ["bb", 38],
      ]
    );
  });

  it("is wrapped once, however many frames draw it", () => {
    const text = new Text({ text: "the quick brown fox jumps over", size: 10, maxWidth: 60 });
    const first = build(text);
    const before = first.measured.length;
    for (let i = 0; i < 5; i++) first.builder.build(text, 320, 180);
    assert.equal(first.measured.length, before, "no further measuring for the same text");
  });
});

describe("<Text reveal>", () => {
  it("draws the first n characters and lays out the whole text", () => {
    const text = new Text({ text: "the quick brown fox", size: 10, maxWidth: 60, reveal: 12 });
    const out = lines(build(text).records);
    // "the quick" is characters 0..8, its separator is 9, "brown fox" starts at 10: 12 characters show "br".
    assert.deepEqual(
      out.map((l) => l.text),
      ["the quick", "br"]
    );
  });

  it("shows nothing at 0 and everything at or past the end, and never rewraps as it grows", () => {
    const full = lines(build(new Text({ text: "the quick brown fox", size: 10, maxWidth: 60 })).records).map((l) => l.text);
    assert.deepEqual(lines(build(new Text({ text: "the quick brown fox", size: 10, maxWidth: 60, reveal: 0 })).records), []);
    for (const n of [5, 9, 10, 15, 19, 99]) {
      const part = lines(build(new Text({ text: "the quick brown fox", size: 10, maxWidth: 60, reveal: n })).records).map((l) => l.text);
      assert.ok(
        part.every((p, i) => (full[i] as string).startsWith(p)),
        `reveal ${n}: ${JSON.stringify(part)} are the starts of ${JSON.stringify(full)}`
      );
    }
    assert.deepEqual(
      lines(build(new Text({ text: "the quick brown fox", size: 10, maxWidth: 60, reveal: 99 })).records).map((l) => l.text),
      full
    );
  });

  it("a text without maxWidth can be revealed too, aligned as if it were whole", () => {
    const out = lines(build(new Text({ text: "abcd", size: 10, width: 60, align: "center", reveal: 2 })).records);
    assert.deepEqual(
      out.map((l) => [l.text, l.x]),
      [["ab", 18]]
    );
  });
});

describe("a wrapped <Text> in a <Flex>", () => {
  it("measures as the widest line by the line count, so a column lays out round it", () => {
    const column = new Flex({ direction: "column", gap: 2 });
    const text = new Text({ text: "the quick brown fox jumps", size: 10, maxWidth: 60, lineGap: 1 });
    column.addChild(text);
    const below = new Shape({ kind: "rect", width: 5, height: 5 });
    column.addChild(below);
    const { records } = build(column);
    // Three lines of 10 with two gaps of 1 is 32 tall; the shape sits 2 below it.
    assert.deepEqual(
      lines(records).map((l) => l.y),
      [0, 11, 22]
    );
    const rect = records.find((r) => r.op === "rect");
    assert.equal(rect?.op === "rect" ? rect.y : NaN, 34);
  });

  it("a reveal does not change the box: the shape below stays where it is", () => {
    const column = (reveal: number | undefined): number => {
      const flex = new Flex({ direction: "column" });
      flex.addChild(new Text({ text: "the quick brown fox jumps", size: 10, maxWidth: 60, reveal }));
      flex.addChild(new Shape({ kind: "rect", width: 5, height: 5 }));
      const rect = build(flex).records.find((r) => r.op === "rect");
      return rect?.op === "rect" ? rect.y : NaN;
    };
    assert.equal(column(0), column(undefined));
    assert.equal(column(7), column(undefined));
  });
});

describe("<Text maxWidth>: a bitmap font", () => {
  // A 16 × 6 grid of 5 × 8 glyph cells.
  const sizes = { "assets/font.png": { width: 80, height: 48 } };
  const regions = (records: readonly DecodedRecord[]) =>
    records.flatMap((r) => (r.op === "spriteRegion" ? [{ x: r.x, y: r.y, src: r.srcX }] : []));

  it("breaks at spaces by cell width, one run of glyphs a line", () => {
    // 8 pixels high at size 8, 5 wide: "the quick" is 9 characters, 45 px; maxWidth 25 is 5 characters.
    const text = new Text({ text: "the quick fox", size: 8, font: "font.png", maxWidth: 25 });
    const glyphs = regions(build(text, { sizes }).records);
    const ys = [...new Set(glyphs.map((g) => g.y))];
    assert.deepEqual(ys, [0, 8, 16], "three lines: 'the', 'quick', 'fox'");
    assert.deepEqual(glyphs.filter((g) => g.y === 0).length, 3);
    assert.deepEqual(glyphs.filter((g) => g.y === 8).length, 5);
  });

  it("reveals the first n characters of the whole wrapped text", () => {
    const text = new Text({ text: "the quick fox", size: 8, font: "font.png", maxWidth: 25, reveal: 5 });
    const glyphs = regions(build(text, { sizes }).records);
    // 'the' (0..2), separator 3, 'quick' starts at 4: 5 characters show "the" and "q".
    assert.equal(glyphs.filter((g) => g.y === 0).length, 3);
    assert.equal(glyphs.filter((g) => g.y === 8).length, 1);
    assert.equal(glyphs.filter((g) => g.y === 16).length, 0);
  });

  it("measures the whole text for layout, whatever shows", () => {
    const flex = (reveal: number | undefined): number => {
      const f = new Flex({ direction: "column" });
      f.addChild(new Text({ text: "the quick fox", size: 8, font: "font.png", maxWidth: 25, reveal }));
      f.addChild(new Shape({ kind: "rect", width: 5, height: 5 }));
      const rect = build(f, { sizes }).records.find((r) => r.op === "rect");
      return rect?.op === "rect" ? rect.y : NaN;
    };
    assert.equal(flex(1), flex(undefined));
    assert.equal(flex(undefined), 24, "three lines of 8");
  });
});
