import assert from "node:assert/strict";
/** The run's numbers: the crowd's curve, who comes, what a level-up offers, and what the build makes of the weapons. */
import { describe, it } from "node:test";

import { ENEMY_CAP, RUN_LENGTH } from "../src/rules/constants.ts";
import { hpAt } from "../src/rules/enemies.ts";
import { kindAt, ringAt, targetAt } from "../src/rules/spawn.ts";
import { FULL_BUILD, offersFor, raise, START_BUILD, UPGRADES, wandStats, xpToNext, type Build } from "../src/rules/upgrades.ts";

describe("the crowd", () => {
  it("grows all run, past 1,500 by six minutes, and stops at the cap", () => {
    let last = 0;
    for (let t = 0; t <= RUN_LENGTH; t += 10) {
      const n = targetAt(t);
      assert.ok(n >= last, `${t}s: ${n} after ${last}`);
      last = n;
    }
    assert.ok(targetAt(60) < 200, `a minute in: ${targetAt(60)}`);
    assert.ok(targetAt(360) >= 1500, `six minutes in: ${targetAt(360)}`);
    assert.equal(targetAt(RUN_LENGTH), ENEMY_CAP);
    assert.equal(targetAt(RUN_LENGTH, 300), 300, "a run's own cap");
  });

  it("is only bats at first, then zombies, then brutes; the same seed rolls the same kinds", () => {
    const kinds = (time: number) => {
      const seen = new Set<string>();
      let seed = 7;
      for (let i = 0; i < 400; i++) {
        const k = kindAt(time, seed);
        seen.add(k.kind);
        seed = k.seed;
      }
      return [...seen].sort();
    };
    assert.deepEqual(kinds(10), ["bat"]);
    assert.deepEqual(kinds(60), ["bat", "zombie"]);
    assert.deepEqual(kinds(300), ["bat", "brute", "zombie"]);
    assert.deepEqual(kindAt(100, 42), kindAt(100, 42));
  });

  it("comes in on the ring around the player", () => {
    const at = ringAt(50, -20, 290, 3);
    assert.ok(Math.abs(Math.hypot(at.x - 50, at.y + 20) - 290) < 1e-9);
  });

  it("gets tougher as the run goes on", () => {
    assert.ok(hpAt("bat", 300) > hpAt("bat", 0));
  });
});

describe("levels and upgrades", () => {
  it("needs more experience for each level", () => {
    for (let l = 1; l < 40; l++) assert.ok(xpToNext(l + 1) > xpToNext(l));
  });

  it("offers three different upgrades, never one at its last level", () => {
    let build: Build = { ...START_BUILD, wand: UPGRADES.wand.max, aura: UPGRADES.aura.max };
    let seed = 1;
    for (let i = 0; i < 50; i++) {
      const o = offersFor(build, seed);
      seed = o.seed;
      assert.equal(new Set(o.offers).size, o.offers.length);
      assert.equal(o.offers.length, 3);
      for (const id of o.offers) assert.ok(build[id] < UPGRADES[id].max, `${id} is at its last level`);
    }
    build = raise(build, "boots");
    assert.equal(build.boots, 1);
  });

  it("offers nothing once everything is at its last level", () => {
    const all = Object.fromEntries(Object.entries(UPGRADES).map(([id, u]) => [id, u.max])) as Build;
    assert.deepEqual(offersFor(all, 1).offers, []);
  });

  it("makes the wand fire more often, harder and with more bolts as it levels", () => {
    const one = wandStats(START_BUILD);
    const full = wandStats(FULL_BUILD);
    assert.ok(full.cooldown < one.cooldown);
    assert.ok(full.damage > one.damage);
    assert.ok(full.count > one.count);
  });
});
