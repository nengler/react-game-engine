import assert from "node:assert/strict";
import { test } from "node:test";

import { parseInputScript, runScript } from "@tsengine/player";

import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { fullRun } from "./fullrun.ts";

test("the whole game, planned with findPath, walked by the rules: three bells and the gate", () => {
  const { run, script } = fullRun();
  assert.equal(run.done, true, "the route ends at the open gate");
  assert.equal(run.items.bell, 3);
  assert.ok(run.items.lantern === 1 && run.items.key === 1 && run.items.shears === 1);
  assert.ok(script.split(",").length > 20, "a real route");
});

test("the same input played through the game itself, from the title to the end screen", { timeout: 120_000 }, () => {
  const { script } = fullRun();
  const frames = parseInputScript(`_, Enter, _*3, ${script}, _*10`, { bindings });
  let cleared = false;
  const result = runScript(gameConfig, frames, () => {
    const s = useGame.getState();
    // The replay is of the world; the enemies have their own tests, so they are taken away on the first step of play.
    if (!cleared && s.screen === "play") {
      cleared = true;
      useGame.setState({ run: { ...s.run, enemies: [] } });
    }
    return { screen: s.screen, bells: s.run.items.bell ?? 0, map: s.run.map };
  });
  const last = result.states.at(-1)!;
  assert.equal(last.screen, "end", "the gate ended the game");
  assert.equal(last.bells, 3);
  const maps = [...new Set(result.states.map((s) => s.map))];
  assert.deepEqual(maps.sort(), ["cave", "house", "maze", "overworld"], "all four maps were visited");
});
