import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { colorToHex, NAMED_COLOR_COUNT, parseColor } from "../src/color.ts";

function hex(css: string): string | null {
  const color = parseColor(css);
  return color === null ? null : colorToHex(color);
}

describe("parseColor", () => {
  it("reads hex in all four lengths", () => {
    assert.equal(hex("#f80"), "#ff8800ff");
    assert.equal(hex("#f808"), "#ff880088");
    assert.equal(hex("#ff8800"), "#ff8800ff");
    assert.equal(hex("#FF880080"), "#ff880080");
  });

  it("reads rgb() and rgba() with commas or spaces", () => {
    assert.equal(hex("rgb(255, 0, 0)"), "#ff0000ff");
    assert.equal(hex("rgb(255 0 0)"), "#ff0000ff");
    assert.equal(hex("rgba(255, 0, 0, 0.3)"), "#ff00004d");
    assert.equal(hex("rgb(255 0 0 / 50%)"), "#ff000080");
    assert.equal(hex("rgb(100%, 0%, 50%)"), "#ff0080ff");
  });

  it("clamps out-of-range channels and alpha", () => {
    assert.equal(hex("rgb(300, -5, 0)"), "#ff0000ff");
    assert.equal(hex("rgba(0, 0, 0, 2)"), "#000000ff");
    assert.equal(hex("rgba(0, 0, 0, -1)"), "#00000000");
  });

  it("reads names, any case and padding, and transparent", () => {
    assert.equal(hex("white"), "#ffffffff");
    assert.equal(hex(" Gold "), "#ffd700ff");
    assert.equal(hex("rebeccapurple"), "#663399ff");
    assert.equal(hex("transparent"), "#00000000");
  });

  it("knows all 148 CSS colour names", () => {
    assert.equal(NAMED_COLOR_COUNT, 148);
  });

  it("returns null for anything else", () => {
    for (const css of [
      "",
      "#12",
      "#12345",
      "#ggg",
      "rgb(1, 2)",
      "rgb(1, 2, 3, 4, 5)",
      "rgb(a, b, c)",
      "hsl(0, 100%, 50%)",
      "notacolor",
      "red green",
    ]) {
      assert.equal(parseColor(css), null, css);
    }
  });

  it("packs an opaque white so that it stays an unsigned integer", () => {
    assert.equal(parseColor("white"), 0xffffffff);
    assert.equal(parseColor("#ffffffff"), 0xffffffff);
  });
});
