import assert from "node:assert/strict";
/** The seeded rolls: the same seed rolls the same numbers, in range, and every value is reached. */
import { describe, it } from "node:test";

import { roll, rollBetween, rollChance, rollInt, rollPick } from "../src/index.ts";

/** `n` values rolled one after another from `seed`. */
function sequence<T>(seed: number, n: number, next: (seed: number) => { value: T; seed: number }): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const r = next(seed);
    out.push(r.value);
    seed = r.seed;
  }
  return out;
}

describe("seeded rolls", () => {
  it("repeat from the same seed, differ from another, and stay in [0, 1)", () => {
    const a = sequence(1, 1000, roll);
    assert.deepEqual(sequence(1, 1000, roll), a);
    assert.notDeepEqual(sequence(2, 1000, roll), a);
    assert.ok(a.every((v) => v >= 0 && v < 1));
    const mean = a.reduce((sum, v) => sum + v, 0) / a.length;
    assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
  });

  it("are mulberry32, so a seed kept by an older build rolls what it rolled", () => {
    assert.deepEqual(roll(1), { value: 0.6270739405881613, seed: 1831565814 });
  });

  it("roll whole numbers with both ends included, in either order", () => {
    const dice = sequence(3, 600, (s) => rollInt(s, 1, 6));
    assert.deepEqual([...new Set(dice)].sort(), [1, 2, 3, 4, 5, 6]);
    assert.ok(sequence(3, 100, (s) => rollInt(s, 6, 1)).every((v) => v >= 1 && v <= 6));
    assert.ok(sequence(3, 50, (s) => rollInt(s, 4, 4)).every((v) => v === 4));
  });

  it("roll between two numbers, pick from a list, and roll a chance", () => {
    assert.ok(sequence(5, 200, (s) => rollBetween(s, -3, 3)).every((v) => v >= -3 && v < 3));
    assert.deepEqual([...new Set(sequence(5, 200, (s) => rollPick(s, ["a", "b", "c"])))].sort(), ["a", "b", "c"]);
    assert.equal(rollPick(5, []).value, undefined);
    assert.ok(sequence(5, 50, (s) => rollChance(s, 0)).every((v) => !v));
    assert.ok(sequence(5, 50, (s) => rollChance(s, 1)).every((v) => v));
  });
});
