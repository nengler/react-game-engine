import assert from "node:assert/strict";
/** The run's pieces, each mounted alone (`@tsengine/testing`): an enemy walks and takes its hits, a gem is pulled in, a bolt is spent. */
import { describe, it, mock } from "node:test";

import { render } from "@tsengine/testing";

import { Enemy } from "../generated/Enemy.ts";
import { Gem } from "../generated/Gem.ts";
import { Shot } from "../generated/Shot.ts";
import { ENEMIES } from "../src/rules/enemies.ts";

const fields = (t: { state(): Record<string, unknown> }) => t.state().s as Record<string, number | boolean>;

describe("an enemy", () => {
  const enemy = (hp = 1000) => {
    const onKilled = mock.fn();
    const t = render(Enemy, { id: 1, kind: "zombie", x: 100, y: 0, hp, px: 0, py: 0, onKilled });
    return { t, onKilled };
  };

  it("walks straight at the player at its kind's speed", () => {
    const { t } = enemy();
    t.step(60);
    assert.ok(Math.abs((fields(t).x as number) - (100 - ENEMIES.zombie.speed)) < 1e-6, `at ${fields(t).x}`);
    assert.equal(fields(t).y, 0);
  });

  it("is hurt and shoved back by a bolt that touches it", () => {
    const { t } = enemy();
    t.collide("enemy", { tag: "shot", data: { damage: 30, x: 110, y: 0, knock: 60 } });
    t.step();
    assert.equal(fields(t).hp, 970);
    assert.ok((fields(t).kx as number) < 0, "shoved away from the bolt, toward the player");
  });

  it("is hurt by the aura's pulse, sent to it, and says when it dies, with where", () => {
    const { t, onKilled } = enemy(5);
    // `t.send` delivers at once, as the end of an update phase would: the enemy finds itself dead in its next update.
    t.send("enemy", { x: 100, y: 0, radius: 20 }, { damage: 6, x: 100, y: 0, knock: 0 });
    t.step();
    assert.equal(onKilled.mock.callCount(), 1);
    assert.deepEqual(onKilled.mock.calls[0]!.arguments.slice(0, 2), [1, "zombie"]);
  });

  it("left far behind, comes back on the other side of the player", () => {
    const onKilled = mock.fn();
    const t = render(Enemy, { id: 1, kind: "bat", x: 1000, y: 0, hp: 5, px: 0, py: 0, onKilled });
    t.step();
    assert.ok((fields(t).x as number) < 0 && (fields(t).x as number) > -1000, `at ${fields(t).x}`);
  });
});

describe("a gem", () => {
  it("lies still until the player comes within reach, then flies to them and is taken", () => {
    const onTaken = mock.fn();
    const t = render(Gem, { id: 3, x: 50, y: 0, value: 2, px: 0, py: 0, magnet: 36, onTaken });
    t.step(30);
    assert.equal(fields(t).x, 50);
    t.setProps({ id: 3, x: 50, y: 0, value: 2, px: 20, py: 0, magnet: 36, onTaken });
    t.stepUntil(() => onTaken.mock.callCount() > 0, { maxSteps: 120 });
    assert.deepEqual(onTaken.mock.calls[0]!.arguments, [3, 2]);
  });
});

describe("a bolt", () => {
  it("is spent after hitting as many enemies as it pierces", () => {
    const onDone = mock.fn();
    const t = render(Shot, { id: 9, x: 0, y: 0, vx: 100, vy: 0, damage: 5, pierce: 2, onDone });
    t.collide("shot", { tag: "enemy", data: { id: 1, damage: 1 } });
    t.step();
    assert.equal(onDone.mock.callCount(), 0);
    t.collide("shot", { tag: "enemy", data: { id: 2, damage: 1 } });
    t.step();
    assert.equal(onDone.mock.callCount(), 1);
  });

  it("flies its time and goes", () => {
    const onDone = mock.fn();
    const t = render(Shot, { id: 9, x: 0, y: 0, vx: 100, vy: 0, damage: 5, pierce: 1, onDone });
    t.stepUntil(() => onDone.mock.callCount() > 0, { maxSteps: 200 });
    assert.ok((fields(t).x as number) > 100);
  });
});
