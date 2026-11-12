import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInputScript, runScript, type Player } from "@rge/player";
import type { GameObject } from "@rge/runtime";
import { bindings, gameConfig } from "../game.ts";
import { SPEED } from "../src/rules/move.ts";

/** Where the hero is, read from the player's tree: the entity named Hero. */
function heroAt(player: Player): { x: number; y: number } {
  const find = (o: GameObject): GameObject | null => ((o as { name?: string }).name === "Hero" ? o : o.children.reduce<GameObject | null>((found, c) => found ?? find(c), null));
  const hero = find(player.world.root);
  assert.ok(hero, "the Hero is in the world");
  return { x: hero.transform.x, y: hero.transform.y };
}

test("holding a key moves the hero, and letting go stops it", () => {
  // The components themselves, played on a recording backend: 30 steps right, a pause, 20 steps down.
  const frames = parseInputScript("right*30, _*10, down*20", { bindings });
  const { states } = runScript(gameConfig, frames, heroAt);
  const [start, afterRight, afterPause, afterDown] = [states[0]!, states[29]!, states[39]!, states[59]!];
  assert.ok(Math.abs(afterRight.x - start.x - SPEED / 2) < SPEED / 30, "half a second right moves half of SPEED");
  assert.equal(afterRight.y, start.y);
  assert.equal(afterPause.x, afterRight.x, "no key held: it stops");
  assert.ok(afterDown.y > afterPause.y, "down moves it down");
  assert.equal(afterDown.x, afterPause.x);
});
