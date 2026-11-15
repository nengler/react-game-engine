import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInputScript, runScript, type Player } from "@rge/player";
import type { GameObject } from "@rge/runtime";
import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { START } from "../src/level.ts";

/** Where the hero is (the entity named Hero), and the jumps counted. */
function seen(player: Player): { x: number; y: number; jumps: number } {
  const find = (o: GameObject): GameObject | null => ((o as { name?: string }).name === "Hero" ? o : o.children.reduce<GameObject | null>((found, c) => found ?? find(c), null));
  const hero = find(player.world.root);
  assert.ok(hero, "the Hero is in the world");
  return { x: hero.transform.x, y: hero.transform.y, jumps: useGame.getState().jumps };
}

test("the whole game: the hero stands on the floor, runs clear of the platforms, jumps, and lands again", () => {
  // Right for a moment, out from under the middle platform, then a jump straight up.
  const frames = parseInputScript("_*10, right*25, _*5, Z, _*60", { bindings });
  const { states } = runScript(gameConfig, frames, seen);
  assert.equal(states[9]!.y, START.y, "standing on the floor");
  assert.ok(states[39]!.x > 192 && states[39]!.x + 12 < 216, `between the middle and right platforms: ${states[39]!.x}`);
  const top = Math.min(...states.slice(40).map((s) => s.y));
  assert.ok(START.y - top > 40, `the jump goes up: ${START.y - top} pixels`);
  assert.equal(states[states.length - 1]!.y, START.y, "and comes back down onto the floor");
  assert.equal(states[states.length - 1]!.jumps, 1);
});

test("running into the middle platform from below: a jump under it stops at its underside", () => {
  // Start under the middle platform (x 128..192, y 96..104): a jump straight up hits it.
  const frames = parseInputScript("_*5, Z, _*40", { bindings });
  const { states } = runScript(gameConfig, frames, seen);
  const top = Math.min(...states.map((s) => s.y));
  assert.equal(top, 104, "the hero's head stops at the platform's underside");
});
