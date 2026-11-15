import assert from "node:assert/strict";
import { test } from "node:test";

import { parseInputScript, runScript } from "@tsengine/player";

import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { route, TO_THE_CAVE } from "./replays.ts";

test("a replay through the game itself: the title, the lantern, a conversation, and the cave's door", () => {
  const { script } = route(TO_THE_CAVE.slice(0, -1)); // the route's own walking; the last leg is raw input
  const frames = parseInputScript(`Enter, _*3, ${script}, ${(TO_THE_CAVE.at(-1) as { raw: string }).raw}`, { bindings });
  const result = runScript(gameConfig, frames, () => {
    const s = useGame.getState();
    return {
      screen: s.screen,
      map: s.run.map,
      lantern: s.run.items.lantern ?? 0,
      talking: s.run.talk !== null,
      page: s.run.talk?.page ?? -1,
      taken: s.run.taken.length,
    };
  });
  assert.equal(result.states[0]?.screen, "play", "the first button, on the title screen, starts the game");
  assert.ok(
    result.states.some((s) => s.lantern === 1),
    "the lantern was picked up"
  );
  assert.ok(
    result.states.some((s) => s.talking && s.page === 0),
    "a conversation began"
  );
  assert.ok(
    result.states.some((s) => s.talking && s.page === 1),
    "and went on to its second page"
  );
  const last = result.states.at(-1)!;
  assert.equal(last.talking, false, "and ended");
  assert.equal(last.map, "cave", "the cave's door opened to the lantern");
  assert.deepEqual(result.warnings, []);
});
