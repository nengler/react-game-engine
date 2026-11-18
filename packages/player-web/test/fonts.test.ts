import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BUILTIN_FONT_METRICS } from "@tsengine/player";

import { parseFontHeader, webFontsModule } from "../../../tools/make-web-fonts.ts";
import { BUILTIN_FONT_BITS } from "../src/fonts-data.ts";

const header = readFileSync(new URL("../../../native/src/fonts_data.h", import.meta.url), "utf8");

test("the web's font sheets are libtse's: fonts-data.ts is what tools/make-web-fonts.ts makes from fonts_data.h", () => {
  const written = readFileSync(new URL("../src/fonts-data.ts", import.meta.url), "utf8");
  assert.equal(written, webFontsModule(header), "run node tools/make-web-fonts.ts");
});

test("every built-in font the player lays text out with has a sheet of its size", () => {
  const fonts = parseFontHeader(header);
  for (const [name, metrics] of Object.entries(BUILTIN_FONT_METRICS)) {
    const web = BUILTIN_FONT_BITS[name];
    assert.ok(web !== undefined, `${name} is in the web's fonts`);
    assert.equal(16 * web.cellWidth, metrics.width, name);
    assert.equal(6 * web.cellHeight, metrics.height, name);
    const bits = Buffer.from(web.bits, "base64");
    assert.equal(bits.length, Math.ceil(metrics.width / 8) * metrics.height, `${name}: one bit a pixel, each row on a byte`);
    assert.deepEqual(Uint8Array.from(bits), fonts.find((f) => f.name === name)!.bits);
  }
});
