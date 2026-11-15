import assert from "node:assert/strict";
/**
 * The game's data and the pure helpers its components use: the map, the path, the generator, the wave tables and the towers'
 * numbers. What the game does with them (walking, firing, paying) is tested as components, in `battle.test.ts`.
 */
import { describe, it } from "node:test";

import { hpOf } from "../src/battle.ts";
import { MAP } from "../src/rules/map.ts";
import { makePath, pathAt } from "../src/rules/path.ts";
import { rollSigned } from "../src/rules/rng.ts";
import { pickTarget } from "../src/rules/targeting.ts";
import { statsOf } from "../src/rules/towers.ts";
import { spawnsOf, WAVES, type Group } from "../src/rules/waves.ts";

describe("the map", () => {
  it("has a path from the left edge to the hearth, and about 18 pads beside it", () => {
    assert.equal(MAP.path.points.length, 10, "spawn, eight corners, hearth");
    assert.deepEqual(MAP.path.points[0], { x: 5, y: 35 });
    assert.deepEqual(MAP.path.points.at(-1), { x: 235, y: 145 });
    assert.ok(MAP.path.length > 500 && MAP.path.length < 700, `length ${MAP.path.length}`);
    assert.equal(MAP.pads.length, 18);
  });

  it("numbers pads in reading order, none on the path, each within reach of it", () => {
    assert.deepEqual(
      MAP.pads.map((p) => p.id),
      MAP.pads.map((_, i) => i)
    );
    const sorted = [...MAP.pads].sort((a, b) => a.y - b.y || a.x - b.x);
    assert.deepEqual(MAP.pads, sorted);
    for (const p of MAP.pads) {
      let nearest = Infinity;
      for (let d = 0; d <= MAP.path.length; d += 2) {
        const at = pathAt(MAP.path, d);
        nearest = Math.min(nearest, Math.hypot(at.x - p.x, at.y - p.y));
      }
      assert.ok(nearest >= 10 && nearest <= 25, `pad ${p.id} is ${nearest} from the path`);
    }
  });
});

describe("path", () => {
  const path = makePath([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 20 },
  ]);
  it("finds a position and a direction at a distance, clamped to its ends", () => {
    assert.deepEqual(pathAt(path, 4), { x: 4, y: 0, dx: 1, dy: 0 });
    assert.deepEqual(pathAt(path, 20), { x: 10, y: 10, dx: 0, dy: 1 });
    assert.equal(pathAt(path, -5).x, 0);
    assert.equal(pathAt(path, 999).y, 20);
    assert.equal(path.length, 30);
  });
});

describe("the generator", () => {
  it("repeats from a seed and stays in range", () => {
    assert.equal(rollSigned(7).value, rollSigned(7).value);
    let seed = 1;
    for (let i = 0; i < 200; i++) {
      const r = rollSigned(seed);
      seed = r.seed;
      assert.ok(r.value >= -1 && r.value < 1);
    }
  });
});

describe("waves", () => {
  it("has ten, each with its enemies in order of arrival", () => {
    assert.equal(WAVES.length, 10);
    for (let w = 0; w < 10; w++) {
      const spawns = spawnsOf(w);
      assert.ok(spawns.length > 0);
      for (let i = 1; i < spawns.length; i++) assert.ok((spawns[i] as { at: number }).at >= (spawns[i - 1] as { at: number }).at);
    }
  });

  it("turns groups into a timed list", () => {
    const table: Group[][] = [
      [
        { kind: "runner", count: 3, gap: 1, delay: 2 },
        { kind: "grunt", count: 2, gap: 2, delay: 3 },
      ],
    ];
    assert.deepEqual(spawnsOf(0, table), [
      { at: 2, kind: "runner" },
      { at: 3, kind: "runner" },
      { at: 3, kind: "grunt" },
      { at: 4, kind: "runner" },
      { at: 5, kind: "grunt" },
    ]);
  });

  it("grows each enemy's HP by 20% of its base a wave", () => {
    assert.equal(hpOf("grunt", 0), 30);
    assert.equal(hpOf("grunt", 1), 36);
    assert.equal(hpOf("brute", 9), 336);
  });
});

describe("the towers' numbers", () => {
  it("raise damage and range 40% and 10% a level", () => {
    const base = statsOf("bolt", 0);
    const top = statsOf("bolt", 2);
    assert.equal(top.damage, base.damage * 1.8);
    assert.ok(Math.abs(top.range - base.range * 1.2) < 1e-9);
    assert.equal(statsOf("frost", 2).radius, statsOf("frost", 2).range, "a frost pulse covers its range");
  });
});

describe("targeting", () => {
  const at = (id: number, dist: number, hp = 10) => ({ id, dist, x: dist, y: 0, hp });
  it("breaks a tie by the lower id, ignores the dead, and finds nothing out of range", () => {
    assert.equal(pickTarget(0, 0, 50, [at(7, 30), at(3, 30)])?.id, 3);
    assert.equal(pickTarget(0, 0, 50, [at(1, 30, 0), at(2, 10)])?.id, 2);
    assert.equal(pickTarget(0, 0, 5, [at(1, 30)]), null);
  });
});
