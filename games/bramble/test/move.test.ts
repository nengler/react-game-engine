import assert from "node:assert/strict";
import { test } from "node:test";
import { moveBy, SPEED } from "../src/rules/move.ts";

test("holding a direction moves SPEED pixels a second", () => {
  assert.equal(moveBy(0, 1, 1), SPEED);
  assert.equal(moveBy(10, -1, 0.5), 10 - SPEED / 2);
  assert.equal(moveBy(10, 0, 1), 10);
});
