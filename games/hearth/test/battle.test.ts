import assert from "node:assert/strict";
/**
 * The battle, tested as components (`@tsengine/testing`): an enemy walks and takes its hits, a tower aims and fires, a shot lands, and
 * `Play` keeps the gold, the lives and the waves. Each is mounted alone in a headless world, as React Testing Library mounts one
 * React component.
 */
import { describe, it, mock } from "node:test";

import { Collider } from "@tsengine/runtime";
import { render } from "@tsengine/testing";

import { Enemy } from "../generated/Enemy.ts";
import { Play } from "../generated/Play.ts";
import { Shot } from "../generated/Shot.ts";
import { Tower } from "../generated/Tower.ts";
import { sfx } from "../src/effects.ts";
import { useGame } from "../src/GameState.ts";
import { START_GOLD, START_LIVES, WAVE_BONUS } from "../src/rules/constants.ts";
import { controls } from "../src/rules/controls.ts";
import { BEST } from "../src/rules/coverage.ts";
import { ENEMIES } from "../src/rules/enemies.ts";
import { MAP } from "../src/rules/map.ts";
import { pathAt } from "../src/rules/path.ts";
import { TOWERS, type TowerKind } from "../src/rules/towers.ts";

const STEPS_A_SECOND = 60;
const START = pathAt(MAP.path, 0);

/** An enemy, alone, at the start of the path. */
function enemy(kind: "runner" | "grunt" | "brute" = "brute", maxHp = 1000) {
  const onKilled = mock.fn();
  const onLeaked = mock.fn();
  const t = render(Enemy, { id: 1, kind, lane: 0, maxHp, onKilled, onLeaked });
  return { t, onKilled, onLeaked };
}

/** A component's `useMutable` fields (`s`), as the test reads them. */
const fields = (t: { state(): Record<string, unknown> }) => t.state().s as Record<string, number | boolean>;

/** What lands on an enemy: a blast at (x, y) (its middle, by default the path's start, where a new enemy stands). */
const blast = (over: Partial<ColliderData["blast"]> = {}) => ({
  tag: "blast",
  data: { target: -1, x: START.x, y: START.y, radius: 14, damage: 18, slow: 0, ...over },
});

describe("an enemy", () => {
  it("walks the path at its kind's speed", () => {
    const { t } = enemy("brute");
    t.step(STEPS_A_SECOND);
    assert.ok(Math.abs((fields(t).dist as number) - ENEMIES.brute.speed) < 1e-6, `walked ${fields(t).dist}`);
  });

  it("takes a blast's damage when its middle is within the blast's radius, and flashes", () => {
    const { t } = enemy();
    t.collide("enemy", blast());
    assert.equal(fields(t).hp, 1000 - 18);
    assert.equal(fields(t).flash, true);
    t.step(8);
    assert.equal(fields(t).flash, false, "for 0.12 s");
    t.collide("enemy", blast({ x: START.x + 30 }));
    assert.equal(fields(t).hp, 1000 - 18, "a blast whose circle it is outside of does nothing");
  });

  it("is hit by a bolt aimed at it, and not by one aimed at another", () => {
    const { t } = enemy();
    t.collide("enemy", blast({ target: 2, damage: 6, radius: 0 }));
    assert.equal(fields(t).hp, 1000);
    t.collide("enemy", blast({ target: 1, damage: 6, radius: 0, x: 0, y: 0 }));
    assert.equal(fields(t).hp, 1000 - 6);
  });

  it("is slowed by frost: 40% slower for as long as the pulse says", () => {
    const free = fields(enemy().t.step(30)).dist as number;
    const { t } = enemy();
    t.collide("enemy", blast({ damage: 2, slow: TOWERS.frost.slowFor }));
    t.step(30);
    assert.ok(Math.abs((fields(t).dist as number) - free * (1 - TOWERS.frost.slow)) < 1e-6, `walked ${fields(t).dist}`);
    assert.ok((fields(t).slow as number) > 0);
    t.step(STEPS_A_SECOND + 1);
    assert.equal(fields(t).slow, 0, "and walks freely again after 1.5 s");
  });

  it("says when it dies, with where it fell, the step after its hit points run out", () => {
    const { t, onKilled } = enemy("runner", 14);
    t.collide("enemy", blast({ damage: 14 }));
    assert.equal(onKilled.mock.callCount(), 0);
    t.step();
    assert.deepEqual(onKilled.mock.calls[0]?.arguments, [1, "runner", START.x, START.y]);
  });

  it("says when it reaches the hearth", () => {
    const { t, onLeaked } = enemy("runner", 14);
    t.step(Math.ceil((MAP.path.length / ENEMIES.runner.speed) * STEPS_A_SECOND) + 1);
    assert.deepEqual(onLeaked.mock.calls[0]?.arguments, [1, "runner"]);
  });
});

/** A tower alone, at (0, 0), and a way to put enemies near it (their colliders, with what they say about themselves). */
function tower(kind: TowerKind, level = 0) {
  const onFire = mock.fn();
  const t = render(Tower, { seed: 1, kind, level, x: 0, y: 0, ring: false, onFire });
  const near = (id: number, x: number, y: number, dist: number, hp = 10) =>
    t.place({ tag: "enemy", data: { id, dist, x, y, hp }, x: x - 5, y: y - 5, width: 10, height: 10 });
  return { t, onFire, near };
}

describe("a tower", () => {
  it("a bolt tower fires at its target every 0.4 s, the first shot 0.2 s after it is built", () => {
    const { t, onFire, near } = tower("bolt");
    near(1, 20, 0, 50);
    t.step(11);
    assert.equal(onFire.mock.callCount(), 0);
    t.step(2);
    assert.equal(onFire.mock.callCount(), 1);
    assert.deepEqual(onFire.mock.calls[0]?.arguments[0], {
      kind: "bolt",
      x: 0,
      y: 0,
      tx: 20,
      ty: 0,
      flight: 0.12,
      target: 1,
      damage: 6,
      radius: 0,
      slow: 0,
    });
    t.step(STEPS_A_SECOND * 2);
    // 0.2 s, then every 0.4 s (24 steps, or 25 where the sum of steps falls a hair short), to 2.2 s.
    const shots = onFire.mock.callCount();
    assert.ok(shots >= 5 && shots <= 6, `shots ${shots}`);
  });

  it("aims at the enemy in range furthest along the path, and turns its barrel to it", () => {
    const { t, onFire, near } = tower("bolt");
    near(1, 20, 0, 50);
    near(2, 0, 30, 80);
    near(3, 44, 0, 120); // inside the box it asks about, outside its 40 px reach
    t.step(13);
    assert.equal((onFire.mock.calls[0]!.arguments[0] as { target: number }).target, 2);
    assert.ok(Math.abs((fields(t).angle as number) - Math.PI / 2) < 1e-9);
  });

  it("does not fire with nothing in range, and keeps its barrel where it was", () => {
    const { t, onFire, near } = tower("bolt");
    near(1, 200, 0, 50);
    t.step(STEPS_A_SECOND);
    assert.equal(onFire.mock.callCount(), 0);
    assert.equal(fields(t).angle, -Math.PI / 2);
  });

  it("a mortar fires a shell that lands near where the target was, a little off", () => {
    const { t, onFire, near } = tower("mortar");
    near(1, 30, 10, 50);
    t.step(13);
    const shell = onFire.mock.calls[0]?.arguments[0] as {
      tx: number;
      ty: number;
      flight: number;
      radius: number;
      damage: number;
      target: number;
    };
    assert.ok(
      Math.abs(shell.tx - 30) <= 3 && Math.abs(shell.ty - 10) <= 3 && (shell.tx !== 30 || shell.ty !== 10),
      `${shell.tx}, ${shell.ty}`
    );
    assert.deepEqual([shell.flight, shell.radius, shell.damage, shell.target], [0.5, 14, 18, -1]);
  });

  it("a frost tower pulses over its whole range and slows; an upgrade adds damage and reach", () => {
    const { t, onFire, near } = tower("frost", 2);
    near(1, 0, 40, 50);
    t.step(13);
    const pulse = onFire.mock.calls[0]?.arguments[0] as { tx: number; radius: number; damage: number; slow: number; target: number };
    assert.deepEqual([pulse.tx, pulse.target, pulse.slow], [0, -1, 1.5]);
    assert.ok(Math.abs(pulse.radius - 42) < 1e-9 && Math.abs(pulse.damage - 3.6) < 1e-9);
  });
});

describe("a shot", () => {
  const shot = (kind: TowerKind, flight: number) => {
    const onLanded = mock.fn();
    const t = render(Shot, { id: 7, kind, x: 0, y: 0, tx: 50, ty: 0, flight, target: -1, damage: 18, radius: 14, slow: 0, onLanded });
    return { t, onLanded };
  };

  it("a mortar shell hits as a blast for the one step it lands, then is taken away", () => {
    const { t, onLanded } = shot("mortar", 0.5);
    const steps = t.stepUntil(() => t.find(Collider) !== null, { maxSteps: 60 });
    assert.ok(steps >= 30 && steps <= 31, `nothing is hit while it flies: it landed after ${steps} steps`);
    const landing = t.find(Collider)!;
    assert.deepEqual(landing.data, { target: -1, x: 50, y: 0, radius: 14, damage: 18, slow: 0 });
    assert.equal(sfx.plays("boom") > 0, true);
    t.step();
    assert.deepEqual(onLanded.mock.calls[0]?.arguments, [7]);
  });

  it("a bolt hits as it is fired; its tracer stays a moment", () => {
    const { t, onLanded } = shot("bolt", 0.12);
    assert.notEqual(t.find(Collider), null);
    t.step();
    assert.equal(t.find(Collider), null);
    t.step(8);
    assert.deepEqual(onLanded.mock.calls[0]?.arguments, [7], "0.12 s: about 8 steps");
  });
});

const KEY = { bolt: "one", mortar: "two", frost: "three" } as const;

/** A battle, alone, with the game's controls, finding its own collisions, and the buttons a player would press. */
function battle(startGold = START_GOLD) {
  const t = render(Play, { startGold }, { controls, collisions: true });
  useGame.getState().begin();
  const play = t.root;
  const on = (pad: number) => {
    useGame.getState().select(pad);
    t.world.flush();
  };
  return {
    t,
    play,
    build: (pad: number, kind: TowerKind) => (on(pad), t.input(KEY[kind])),
    upgrade: (pad: number) => (on(pad), t.input("upgrade")),
    sell: (pad: number) => (on(pad), t.input("sell")),
    startWave: () => t.input("wave"),
    /** Step until the wave is over or the battle ends (at most `seconds`). */
    waitWave: (seconds = 120) =>
      t.stepUntil(() => !play.s.active || useGame.getState().screen === "lost", { maxSteps: seconds * STEPS_A_SECOND, throws: false }),
  };
}

describe("the battle", () => {
  it("builds a tower on the selected pad for its price, and refuses a second there or one it cannot pay for", () => {
    const b = battle();
    b.build(0, "bolt");
    assert.equal(b.play.s.gold, START_GOLD - 50);
    assert.deepEqual(b.play.s.towers[0], { kind: "bolt", level: 0, spent: 50 });
    const denied = sfx.plays("deny");
    b.build(0, "frost");
    assert.deepEqual([b.play.s.gold, b.play.s.towers[0]?.kind], [START_GOLD - 50, "bolt"], "the pad is taken: its panel offers no towers");
    b.build(1, "mortar");
    assert.equal(b.play.s.towers[1], null, "70 gold does not buy a mortar");
    assert.equal(sfx.plays("deny"), denied + 1);
  });

  it("upgrades twice, then stops; sells for 70% of everything spent", () => {
    const b = battle(1000);
    b.build(0, "mortar");
    b.upgrade(0);
    b.upgrade(0);
    assert.equal(b.play.s.towers[0]?.level, 2);
    assert.equal(b.play.s.gold, 1000 - 80 - 48 - 80);
    b.upgrade(0);
    assert.equal(b.play.s.gold, 1000 - 80 - 48 - 80, "maxed");
    b.sell(0);
    assert.equal(b.play.s.towers[0], null);
    assert.equal(b.play.s.gold, 1000 - 208 + Math.floor(208 * 0.7));
  });

  it("starts a wave with the button, its enemies coming on the wave's schedule, and refuses a second while it is on", () => {
    const b = battle();
    b.startWave();
    assert.deepEqual([b.play.s.wave, b.play.s.active], [1, true]);
    b.t.step(STEPS_A_SECOND * 2.5);
    assert.equal(b.play.s.enemies.length, 3, "wave 1's runners come a second apart, the first at once");
    b.startWave();
    assert.equal(b.play.s.wave, 1);
  });

  it("pays each enemy's gold when it dies and a bonus when the wave is cleared", () => {
    const b = battle(1000);
    for (const pad of BEST.slice(0, 4)) b.build(pad, "bolt");
    b.startWave();
    b.waitWave();
    assert.equal(b.play.s.active, false);
    assert.equal(b.play.s.lives, START_LIVES);
    assert.equal(b.play.s.gold, 1000 - 4 * 50 + 8 * ENEMIES.runner.gold + WAVE_BONUS);
  });

  it("loses lives for every enemy that gets through, and is lost when they run out", () => {
    const b = battle();
    b.startWave();
    b.waitWave();
    assert.equal(b.play.s.lives, START_LIVES - 8, "eight runners, a life each");
    for (let w = 0; w < 3 && useGame.getState().screen === "play"; w++) {
      b.startWave();
      b.waitWave();
    }
    assert.equal(useGame.getState().screen, "lost");
    assert.equal(useGame.getState().endLives, 0);
  });
});
