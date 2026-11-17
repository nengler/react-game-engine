import assert from "node:assert/strict";
import { test } from "node:test";

import { KEY_NAMES } from "@tsengine/runtime";

import { keyName } from "../src/input.ts";

test("a key's code names the key table's entry: letters, digits, either Shift, Control or Alt, the numpad's Enter", () => {
  const table = new Set<string>(KEY_NAMES);
  for (const [code, name] of [
    ["KeyA", "A"],
    ["KeyZ", "Z"],
    ["Digit0", "0"],
    ["Numpad7", "7"],
    ["Space", "Space"],
    ["Enter", "Enter"],
    ["NumpadEnter", "Enter"],
    ["Escape", "Escape"],
    ["ShiftLeft", "Shift"],
    ["ShiftRight", "Shift"],
    ["ControlRight", "Control"],
    ["AltLeft", "Alt"],
    ["ArrowUp", "ArrowUp"],
    ["Backspace", "Backspace"],
    ["F11", "F11"],
  ] as const) {
    assert.equal(keyName(code), name, code);
    assert.ok(table.has(name), `${name} is in the key table`);
  }
});
