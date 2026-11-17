import assert from "node:assert/strict";
/**
 * The game itself, played by its input scripts: a run levels up, kills and ends; the same script plays the same run; and the stress
 * scene holds its crowd with every weapon in it. One run is checked frame by frame against a rebuild from nothing (`retain: "check"`).
 */
import { describe, it } from "node:test";

import { parseInputScript, runScript } from "@tsengine/player";

import { bindings, gameConfig, screen } from "../game.ts";
import { Stress } from "../generated/Stress.ts";
import { useGame } from "../src/GameState.ts";
import { walk } from "./replays.ts";
import { findPlay, runOf } from "./run-state.ts";

function play(script: string, config = gameConfig) {
  const frames = parseInputScript(script, { bindings, screen });
  return runScript(
    config,
    frames,
    () => {
      const p = findPlay();
      const g = useGame.getState();
      return { screen: g.screen, choosing: g.choosing, ...(p === null ? {} : runOf(p)) };
    },
    { keepFrames: 1 }
  );
}

describe("a run", () => {
  it("walking the loop, levels up, takes upgrades and kills; then the crowd wins", () => {
    const { states, warnings } = play(walk(150));
    assert.deepEqual(warnings, []);
    const end = states.findIndex((s) => s.screen === "over");
    assert.ok(end > 0, "the run ended");
    const last = states[end - 1]!;
    assert.ok((last.level ?? 0) >= 4, `level ${last.level}`);
    assert.ok((last.kills ?? 0) > 100, `kills ${last.kills}`);
    assert.ok(Object.values(last.build ?? {}).reduce((a, b) => a + b, 0) > 3, "upgrades were taken");
    assert.equal(useGame.getState().survived, false);
  });

  it("plays the same way twice, and every frame of it is what a rebuild from nothing draws", () => {
    const script = walk(25);
    const a = play(script, { ...gameConfig, retain: "check" }).states.at(-1);
    const b = play(script).states.at(-1);
    assert.deepEqual(a, b);
    assert.ok((a?.kills ?? 0) > 0);
  });
});

describe("the stress scene", () => {
  it("fills to its count and keeps it, while every weapon kills", () => {
    const { states, warnings } = play(walk(6).replace(/^confirm, /, ""), {
      ...gameConfig,
      root: () => new Stress({ count: 400, armed: true }),
    });
    assert.deepEqual(warnings, []);
    const last = states.at(-1)!;
    assert.equal(last.enemies, 400);
    assert.ok((last.kills ?? 0) > 50, `kills ${last.kills}`);
    assert.ok((last.gems ?? 0) > 0);
  });
});
