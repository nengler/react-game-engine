import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hpOf, newBattle, stepBattle, type Battle, type BattleEvent, type Command } from "../src/rules/battle.ts";
import { START_GOLD, START_LIVES, STEP, WAVE_BONUS } from "../src/rules/constants.ts";
import { refundOf } from "../src/rules/economy.ts";
import { ENEMIES } from "../src/rules/enemies.ts";
import { MAP } from "../src/rules/map.ts";
import { makePath, pathAt } from "../src/rules/path.ts";
import { rollSigned } from "../src/rules/rng.ts";
import { pickTarget } from "../src/rules/targeting.ts";
import { statsOf, TOWERS, upgradeCost } from "../src/rules/towers.ts";
import { spawnsOf, WAVES, type Group } from "../src/rules/waves.ts";

/** Step a battle `seconds` of fixed steps, with the commands on the first one; returns the battle and every event. */
function run(b: Battle, seconds: number, commands: readonly Command[] = []): { battle: Battle; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  let battle = b;
  const steps = Math.max(1, Math.round(seconds / STEP)); // 0 seconds is one step: how a command is given
  for (let i = 0; i < steps; i++) {
    const r = stepBattle(battle, STEP, i === 0 ? commands : [], MAP);
    battle = r.battle;
    events.push(...r.events);
  }
  return { battle, events };
}

const count = (events: readonly BattleEvent[], type: BattleEvent["type"]): number => events.filter((e) => e.type === type).length;

/** A battle with some gold and a wave on, with these enemies placed directly (distance along the path, kind). */
function withEnemies(b: Battle, placed: readonly [number, "runner" | "grunt" | "brute"][]): Battle {
  return {
    ...b,
    active: true,
    wave: 1,
    spawns: [],
    spawned: 0,
    nextId: 100 + placed.length,
    enemies: placed.map(([dist, kind], i) => {
      const at = pathAt(MAP.path, dist);
      const hp = hpOf(kind, 0);
      return { id: 100 + i, kind, dist, x: at.x, y: at.y, left: false, hp, maxHp: hp, lane: 0, slow: 0, flash: 0 };
    }),
  };
}

/** The pad nearest a point of the path: where a test puts a tower to cover it. */
function padNear(distance: number): number {
  const at = pathAt(MAP.path, distance);
  return MAP.pads.reduce((best, p) => (Math.hypot(p.x - at.x, p.y - at.y) < Math.hypot((MAP.pads[best] as { x: number; y: number }).x - at.x, (MAP.pads[best] as { x: number; y: number }).y - at.y) ? p.id : best), 0);
}

describe("the map", () => {
  it("has a path from the left edge to the hearth, and about 18 pads beside it", () => {
    assert.equal(MAP.path.points.length, 10, "spawn, eight corners, hearth");
    assert.deepEqual(MAP.path.points[0], { x: 5, y: 35 });
    assert.deepEqual(MAP.path.points.at(-1), { x: 235, y: 145 });
    assert.ok(MAP.path.length > 500 && MAP.path.length < 700, `length ${MAP.path.length}`);
    assert.equal(MAP.pads.length, 18);
  });

  it("numbers pads in reading order, none on the path, each within reach of it", () => {
    assert.deepEqual(MAP.pads.map((p) => p.id), MAP.pads.map((_, i) => i));
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
  const path = makePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]);
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
    const table: Group[][] = [[{ kind: "runner", count: 3, gap: 1, delay: 2 }, { kind: "grunt", count: 2, gap: 2, delay: 3 }]];
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

describe("walking, leaking and losing", () => {
  it("spawns on the wave's schedule and walks at the enemy's speed", () => {
    const started = run(newBattle(MAP), 0, [{ type: "startWave" }]).battle;
    assert.equal(started.active, true);
    const { battle } = run(started, 1.5);
    assert.equal(battle.enemies.length, 2, "a runner at 0 s and at 1 s");
    const first = battle.enemies[0]!;
    assert.ok(Math.abs(first.dist - ENEMIES.runner.speed * 1.5) < 1, `walked ${first.dist}`);
  });

  it("refuses a second wave while one is on", () => {
    const b = run(newBattle(MAP), 0, [{ type: "startWave" }]).battle;
    const again = run(b, 0, [{ type: "startWave" }]);
    assert.deepEqual(again.events.filter((e) => e.type === "denied"), [{ type: "denied", reason: "busy" }]);
    assert.equal(again.battle.wave, 1);
  });

  it("takes an enemy's lives when it reaches the hearth, and removes it", () => {
    const b = withEnemies(newBattle(MAP), [[MAP.path.length - 1, "brute"], [MAP.path.length - 1, "runner"]]);
    const { battle, events } = run(b, 0.2);
    assert.equal(battle.lives, START_LIVES - 3 - 1);
    assert.equal(count(events, "leaked"), 2);
    assert.equal(battle.enemies.length, 0);
  });

  it("is lost when the lives run out", () => {
    let b = withEnemies(newBattle(MAP), [[MAP.path.length - 1, "brute"]]);
    b = { ...b, lives: 3 };
    const { battle, events } = run(b, 0.2);
    assert.equal(battle.status, "lost");
    assert.equal(battle.lives, 0);
    assert.equal(count(events, "lost"), 1);
    assert.equal(stepBattle(battle, STEP, [{ type: "startWave" }], MAP).battle, battle, "a lost battle no longer changes");
  });
});

describe("the economy", () => {
  it("buys a tower, takes its price, and refuses a second on the same pad or without gold", () => {
    const b = newBattle(MAP);
    const built = run(b, 0, [{ type: "build", pad: 0, kind: "bolt" }]);
    assert.equal(built.battle.gold, START_GOLD - 50);
    assert.equal(built.battle.pads[0]?.tower?.kind, "bolt");
    assert.deepEqual(built.events.filter((e) => e.type === "built").map((e) => e.type), ["built"]);
    const twice = run(built.battle, 0, [{ type: "build", pad: 0, kind: "frost" }]);
    assert.deepEqual(twice.events.filter((e) => e.type === "denied"), [{ type: "denied", reason: "occupied" }]);
    const poor = run({ ...b, gold: 49 }, 0, [{ type: "build", pad: 1, kind: "bolt" }]);
    assert.deepEqual(poor.events.filter((e) => e.type === "denied"), [{ type: "denied", reason: "gold" }]);
    assert.equal(poor.battle.pads[1]?.tower, null);
  });

  it("upgrades twice at 60% then 100% of the base price, then stops", () => {
    assert.equal(upgradeCost("mortar", 0), 48);
    assert.equal(upgradeCost("mortar", 1), 80);
    assert.equal(upgradeCost("mortar", 2), null);
    let b: Battle = { ...newBattle(MAP), gold: 1000 };
    b = run(b, 0, [{ type: "build", pad: 0, kind: "mortar" }]).battle;
    b = run(b, 0, [{ type: "upgrade", pad: 0 }]).battle;
    b = run(b, 0, [{ type: "upgrade", pad: 0 }]).battle;
    assert.equal(b.pads[0]?.tower?.level, 2);
    assert.equal(b.gold, 1000 - 80 - 48 - 80);
    const maxed = run(b, 0, [{ type: "upgrade", pad: 0 }]);
    assert.deepEqual(maxed.events.filter((e) => e.type === "denied"), [{ type: "denied", reason: "maxed" }]);
  });

  it("raises damage and range 40% and 10% a level", () => {
    const base = statsOf("bolt", 0);
    const top = statsOf("bolt", 2);
    assert.equal(top.damage, base.damage * 1.8);
    assert.ok(Math.abs(top.range - base.range * 1.2) < 1e-9);
    assert.equal(statsOf("frost", 2).radius, statsOf("frost", 2).range, "a frost pulse covers its range");
  });

  it("sells for 70% of everything spent", () => {
    let b: Battle = { ...newBattle(MAP), gold: 1000 };
    b = run(b, 0, [{ type: "build", pad: 3, kind: "bolt" }]).battle;
    b = run(b, 0, [{ type: "upgrade", pad: 3 }]).battle;
    const spent = 50 + 30;
    assert.equal(b.pads[3]?.tower?.spent, spent);
    assert.equal(refundOf(b.pads[3]!.tower!), 56);
    const sold = run(b, 0, [{ type: "sell", pad: 3 }]);
    assert.equal(sold.battle.gold, b.gold + 56);
    assert.equal(sold.battle.pads[3]?.tower, null);
    assert.equal(run(sold.battle, 0, [{ type: "sell", pad: 3 }]).events.at(-1)?.type, "denied");
  });

  it("pays the enemy's gold when it dies and a bonus when the wave is cleared", () => {
    const pad = padNear(100);
    let b = withEnemies({ ...newBattle(MAP), gold: 100 }, [[100, "runner"]]);
    b = run(b, 0, [{ type: "build", pad, kind: "bolt" }]).battle;
    const { battle, events } = run(b, 3);
    assert.equal(count(events, "killed"), 1);
    assert.equal(battle.enemies.length, 0);
    assert.equal(battle.gold, 100 - 50 + ENEMIES.runner.gold + WAVE_BONUS);
    assert.equal(battle.active, false);
    assert.deepEqual(events.filter((e) => e.type === "waveCleared"), [{ type: "waveCleared", wave: 1, bonus: WAVE_BONUS }]);
  });
});

describe("targeting", () => {
  const at = (id: number, dist: number, hp = 10) => ({ id, kind: "grunt" as const, dist, x: dist, y: 0, left: false, hp, maxHp: 10, lane: 0, slow: 0, flash: 0 });
  it("aims at the enemy in range that is furthest along the path", () => {
    const enemies = [at(1, 20), at(2, 35), at(3, 28), at(4, 90)];
    assert.equal(pickTarget(25, 0, 15, enemies)?.id, 2, "id 4 is the furthest but out of range");
  });
  it("breaks a tie by the lower id, ignores the dead, and finds nothing out of range", () => {
    assert.equal(pickTarget(0, 0, 50, [at(7, 30), at(3, 30)])?.id, 3);
    assert.equal(pickTarget(0, 0, 50, [at(1, 30, 0), at(2, 10)])?.id, 2);
    assert.equal(pickTarget(0, 0, 5, [at(1, 30)]), null);
  });
});

describe("the towers", () => {
  it("a bolt tower fires every 0.4 s for 6 damage at one enemy", () => {
    const pad = padNear(150);
    let b = withEnemies({ ...newBattle(MAP), gold: 100 }, [[150, "brute"]]);
    b = { ...b, enemies: b.enemies.map((e) => ({ ...e, hp: 1000, maxHp: 1000, kind: "brute" as const, dist: e.dist })) };
    b = run(b, 0, [{ type: "build", pad, kind: "bolt" }]).battle;
    // Stand still: the brute walks 14 px a second, so it stays near. 2.1 s: the first shot at 0.2 s, then every 0.4 s.
    const { battle, events } = run(b, 2.1);
    const shots = count(events, "shot");
    assert.ok(shots >= 5 && shots <= 6, `shots ${shots}`);
    assert.equal(battle.enemies[0]!.hp, 1000 - 6 * shots);
  });

  it("a mortar shell lands after 0.5 s and splashes everything within 14 px", () => {
    const pad = padNear(120);
    const near = pathAt(MAP.path, 120);
    let b = withEnemies({ ...newBattle(MAP), gold: 200 }, [[120, "brute"], [121, "brute"], [180, "brute"]]);
    b = { ...b, enemies: b.enemies.map((e) => ({ ...e, hp: 1000, maxHp: 1000 })) };
    b = run(b, 0, [{ type: "build", pad, kind: "mortar" }]).battle;
    const fired = run(b, 0.25);
    assert.equal(count(fired.events, "shot"), 1);
    assert.ok(fired.battle.enemies.every((e) => e.hp === 1000), "nothing is hurt while the shell flies");
    assert.equal(fired.battle.shots.filter((s) => s.kind === "mortar" && s.live).length, 1);
    const landed = run(fired.battle, 0.6);
    assert.equal(count(landed.events, "hit"), 1);
    const [a, c, far] = landed.battle.enemies;
    assert.ok(a!.hp < 1000 && c!.hp < 1000, "the two close together are both hit");
    assert.ok(a!.hp === 1000 - 18 || a!.hp === 1000, `hit for 18, not ${1000 - a!.hp}`);
    assert.equal(far!.hp, 1000, "the one far away is not");
    assert.ok(near.x > 0);
  });

  it("a frost pulse slows everything in range by 40% for 1.5 s and does 2 damage", () => {
    const pad = padNear(200);
    let b = withEnemies({ ...newBattle(MAP), gold: 200 }, [[200, "brute"], [204, "brute"]]);
    b = { ...b, enemies: b.enemies.map((e) => ({ ...e, hp: 1000, maxHp: 1000 })) };
    b = run(b, 0, [{ type: "build", pad, kind: "frost" }]).battle;
    const pulsed = run(b, 0.3).battle;
    for (const e of pulsed.enemies) {
      assert.equal(e.hp, 998);
      assert.ok(e.slow > 1.0 && e.slow <= TOWERS.frost.slowFor, `slow ${e.slow}`);
    }
    // 0.5 s slowed walks 60% as far as a free walk of the same time.
    const before = pulsed.enemies[0]!.dist;
    const after = run(pulsed, 0.5).battle.enemies[0]!.dist;
    assert.ok(Math.abs(after - before - 14 * 0.6 * 0.5) < 0.1, `moved ${after - before}`);
  });

  it("turns its barrel toward the target", () => {
    const pad = padNear(100);
    let b = withEnemies({ ...newBattle(MAP), gold: 100 }, [[100, "brute"]]);
    b = run(b, 0, [{ type: "build", pad, kind: "bolt" }]).battle;
    const t = run(b, 0.1).battle;
    const p = t.pads[pad]!;
    const e = t.enemies[0]!;
    assert.ok(Math.abs(p.tower!.angle - Math.atan2(e.y - p.y, e.x - p.x)) < 0.05);
  });
});

describe("a whole battle", () => {
  /** Towers built before wave 1, a wave started whenever none is on. */
  function play(build: readonly [number, "bolt" | "mortar" | "frost"][], seed = 1): Battle {
    let b = newBattle(MAP, seed);
    for (const [pad, kind] of build) b = stepBattle({ ...b, gold: 10000 }, STEP, [{ type: "build", pad, kind }], MAP).battle;
    b = { ...b, gold: START_GOLD };
    for (let i = 0; i < 60 * 60 * 20 && b.status === "playing"; i++) b = stepBattle(b, STEP, !b.active ? [{ type: "startWave" }] : [], MAP).battle;
    return b;
  }

  it("is lost with no towers, and the lives are gone by the first waves", () => {
    const b = play([]);
    assert.equal(b.status, "lost");
    assert.ok(b.wave <= 3, `lost in wave ${b.wave}`);
  });

  it("is won with towers everywhere, and a win ends the battle", () => {
    const all = MAP.pads.map((p, i): [number, "bolt" | "mortar" | "frost"] => [p.id, (["bolt", "mortar", "frost"] as const)[i % 3] as "bolt" | "mortar" | "frost"]);
    const b = play(all);
    assert.equal(b.status, "won");
    assert.equal(b.wave, 10);
    assert.ok(b.lives > 0);
  });

  it("is repeatable: the same seed and commands give the same battle", () => {
    const build: [number, "bolt"][] = [[0, "bolt"], [4, "bolt"], [9, "bolt"]];
    assert.deepEqual(play(build, 5), play(build, 5));
  });
});
