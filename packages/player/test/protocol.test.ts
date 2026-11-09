import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, PROTOCOL } from "../src/protocol.ts";

const header = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../native/include/rge.h"), "utf8");

/** Every `#define RGE_NAME <integer>` in the header. Function-like macros (`RGE_KEYS(X)`) have no value and are skipped. */
function headerConstants(): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of header.matchAll(/^#define\s+(RGE_[A-Z0-9_]+)\s+(\d+)\b/gm)) out.set(match[1] as string, Number(match[2]));
  return out;
}

/** The names in the `RGE_KEYS` X-macro, in order, with their kind. */
function headerKeys(): { kind: string; code: string; name: string }[] {
  const start = header.indexOf("#define RGE_KEYS(X)");
  assert.ok(start >= 0, "RGE_KEYS is missing from rge.h");
  const end = header.indexOf("\n\n", start);
  const block = header.slice(start, end);
  return [...block.matchAll(/X\((K|M),\s*(\w+),\s*"([^"]+)"\)/g)].map((m) => ({ kind: m[1] as string, code: m[2] as string, name: m[3] as string }));
}

describe("protocol.ts mirrors native/include/rge.h", () => {
  it("has every constant the header defines, with the same value", () => {
    const constants = headerConstants();
    assert.ok(constants.size >= 25, "the header should define the protocol constants");
    for (const [name, value] of constants) {
      assert.ok(Object.hasOwn(PROTOCOL, name), `${name} is in rge.h but not in protocol.ts`);
      assert.equal((PROTOCOL as Record<string, number>)[name], value, `${name} differs`);
    }
  });

  it("defines no constant the header lacks", () => {
    const constants = headerConstants();
    for (const name of Object.keys(PROTOCOL)) assert.ok(constants.has(name), `${name} is in protocol.ts but not in rge.h`);
  });

  it("lists the same keys in the same order", () => {
    const keys = headerKeys();
    assert.deepEqual(KEYS, keys.map((key) => key.name));
    assert.equal(new Set(KEYS).size, KEYS.length, "key names are unique");
  });

  it("puts only the three mouse buttons in the mouse kind", () => {
    const mouse = headerKeys().filter((key) => key.kind === "M").map((key) => key.name);
    assert.deepEqual(mouse, ["MouseLeft", "MouseRight", "MouseMiddle"]);
  });

  it("keeps each op's length consistent with its record layout", () => {
    assert.equal(PROTOCOL.RGE_OP_VIEW_LEN, 7);
    assert.equal(PROTOCOL.RGE_OP_SPRITE_LEN, 7);
    assert.equal(PROTOCOL.RGE_OP_RECT_LEN, 9);
    assert.equal(PROTOCOL.RGE_OP_ELLIPSE_LEN, 9);
    assert.equal(PROTOCOL.RGE_OP_TEXT_LEN, 9);
  });
});
