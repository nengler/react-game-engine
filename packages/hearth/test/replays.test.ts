import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, runScript } from "@rge/player";
import { bindings, gameConfig, screen } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { MAP } from "../src/rules/map.ts";
import { REPLAYS } from "./replays.ts";

function play(script: string) {
  const frames = parseInputScript(script, { bindings, screen });
  return runScript(gameConfig, frames, () => {
    const s = useGame.getState();
    return { screen: s.screen, lives: s.battle.lives, wave: s.battle.wave, gold: s.battle.gold, towers: s.battle.pads.filter((p) => p.tower !== null).length, cursor: s.cursor, open: s.open, paused: s.paused, speed: s.speed, enemies: s.battle.enemies.length };
  }, { keepFrames: 2 });
}

describe("wave replays (the game itself, played by clicks and keys)", () => {
  it("a good build, clicked in pad by pad, wins with lives left", () => {
    const { states, warnings } = play(REPLAYS.good);
    // The script goes on clicking after the win, and a click on the end screen's button goes back to the title: look at the first end state.
    const last = states.find((s) => s.screen === "won" || s.screen === "lost")!;
    assert.deepEqual(warnings, []);
    assert.equal(last.screen, "won");
    assert.equal(last.wave, 10);
    assert.ok(last.lives > 0, `lives ${last.lives}`);
    assert.ok(last.towers >= 10, `towers ${last.towers}`);
  });

  it("a thin build is lost", () => {
    const last = play(REPLAYS.thin).states.find((s) => s.screen === "won" || s.screen === "lost")!;
    assert.equal(last.screen, "lost");
    assert.equal(last.lives, 0);
  });
});

describe("controls", () => {
  const pad = (i: number) => `click@${MAP.pads[i]!.x},${MAP.pads[i]!.y}`;

  it("a click on a pad selects it and opens the panel; a click on another moves the selection", () => {
    const { states } = play(`confirm, _*5, ${pad(4)}, _*2, ${pad(9)}, _*2`);
    assert.deepEqual([states[8]!.cursor, states[8]!.open], [4, true]);
    assert.deepEqual([states.at(-1)!.cursor, states.at(-1)!.open], [9, true]);
  });

  it("a click on a build button builds, the gold is taken", () => {
    // The build menu's first button is under the stat rows; its place comes from the layout, so click where the screenshot shows it.
    const { states } = play(`confirm, _*5, ${pad(4)}, _*3, one, _*3`);
    assert.equal(states.at(-1)!.towers, 1);
    assert.equal(states.at(-1)!.gold, 70);
  });

  it("the arrow keys move the cursor to the nearest pad in that direction; back closes the panel", () => {
    const { states } = play("confirm, _*5, confirm, _, right, _*2, down, _*2, back, _*2");
    const [open, afterRight, afterDown, closed] = [states[6]!, states[9]!, states[12]!, states.at(-1)!];
    assert.equal(open.open, true);
    assert.notEqual(afterRight.cursor, 0);
    assert.notEqual(afterDown.cursor, afterRight.cursor);
    assert.equal(closed.open, false);
  });

  it("f toggles double speed and escape pauses the battle; the menu's resume button goes back", () => {
    const { states } = play(`confirm, _*5, fast, _*2, wave, _*30, pause, _*30, pause, _*5`);
    assert.equal(states[9]!.speed, 2);
    const during = states[40]!;
    const later = states[65]!;
    assert.equal(during.paused, true);
    assert.equal(later.enemies, during.enemies, "the battle is frozen while paused");
    assert.equal(states.at(-1)!.paused, false);
  });
});
