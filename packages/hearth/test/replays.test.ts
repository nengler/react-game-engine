import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, runScript } from "@rge/player";
import { bindings, gameConfig, screen } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { MAP } from "../src/rules/map.ts";
import { battleOf, findPlay } from "./battle-state.ts";
import { REPLAYS } from "./replays.ts";

function play(script: string) {
  const frames = parseInputScript(script, { bindings, screen });
  return runScript(gameConfig, frames, () => {
    const s = useGame.getState();
    // The battle is `Play`'s own state; on the end screen, what it reported when it ended.
    const p = findPlay();
    const battle = p !== null ? battleOf(p) : { lives: s.endLives, wave: s.endWave, gold: 0, towers: 0, enemies: 0 };
    return { screen: s.screen, lives: battle.lives, wave: battle.wave, gold: battle.gold, towers: battle.towers, cursor: s.cursor, open: s.open, paused: s.paused, speed: s.speed, enemies: battle.enemies };
  }, { keepFrames: 2 });
}

describe("wave replays (the game itself, played by clicks and keys)", () => {
  it("a good build, clicked in pad by pad, wins with lives left", () => {
    const { states, warnings } = play(REPLAYS.good);
    // The script goes on clicking after the win, and a click on the end screen's button goes back to the title: look at the first end state.
    const end = states.findIndex((s) => s.screen === "won" || s.screen === "lost");
    const last = states[end]!;
    assert.deepEqual(warnings, []);
    assert.equal(last.screen, "won");
    assert.equal(last.wave, 10);
    assert.ok(last.lives > 0, `lives ${last.lives}`);
    assert.ok(states[end - 1]!.towers >= 10, `towers ${states[end - 1]!.towers} in the battle's last step`);
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

  it("the 1 key builds on the selected pad, the gold is taken", () => {
    const { states } = play(`confirm, _*5, ${pad(4)}, _*3, one, _*3`);
    assert.equal(states.at(-1)!.towers, 1);
    assert.equal(states.at(-1)!.gold, 70);
  });

  it("a click on a build button builds: the menu (a component whose root is <Panel>) is laid out in the side panel's column", () => {
    // The build menu's buttons are the enabled buttons above the side panel's own three at the bottom; find the first by its drawing.
    const open = play(`confirm, _*5, ${pad(4)}, _*3`).backend.lastFrame.records;
    const buttons = open.filter((r) => r.op === "rect" && r.color === "#3b4468ff").map((r) => r as { x: number; y: number; width: number; height: number });
    buttons.sort((a, b) => a.y - b.y);
    assert.equal(buttons.length, 6, "three to build, three of the side panel");
    const bolt = buttons[0]!;
    assert.equal(bolt.width, 80 - 4 * 2 - 4 * 2, "it grows to the panel's column, through BuildMenu");
    const { states } = play(`confirm, _*5, ${pad(4)}, _*3, click@${Math.round(bolt.x + bolt.width / 2)},${Math.round(bolt.y + bolt.height / 2)}, _*3`);
    assert.equal(states.at(-1)!.towers, 1);
    assert.equal(states.at(-1)!.gold, 70);
  });

  it("a tower shows its range while the mouse is over it, and not once the mouse leaves", () => {
    const rings = (script: string): number => play(script).backend.lastFrame.records.filter((r) => r.op === "ellipse" && r.color === "#ffffff22").length;
    const built = `confirm, _*5, ${pad(4)}, _*3, one, _*3, ${pad(9)}, _*3`;
    assert.equal(rings(built), 0, "the cursor is on another pad");
    const over = `mouse@${MAP.pads[4]!.x},${MAP.pads[4]!.y}`;
    assert.equal(rings(`${built}, ${over}, _*3`), 1);
    assert.equal(rings(`${built}, ${over}, _*3, mouse@300,170, _*3`), 0);
  });

  it("the arrow keys move the cursor to the nearest pad in that direction; back closes the panel", () => {
    const { states } = play("confirm, _*5, confirm, _, right, _*2, down, _*2, back, _*2");
    const [open, afterRight, afterDown, closed] = [states[6]!, states[9]!, states[12]!, states.at(-1)!];
    assert.equal(open.open, true);
    assert.notEqual(afterRight.cursor, 0);
    assert.notEqual(afterDown.cursor, afterRight.cursor);
    assert.equal(closed.open, false);
  });

  it("the pause menu draws its panel and the two buttons it was given, through the modal's forwarded children", () => {
    const rects = (script: string, color: string): number => play(script).backend.lastFrame.records.filter((r) => r.op === "rect" && r.color === color).length;
    // The bitmap font draws as sprite regions, so look at the backgrounds: the modal's dim box, the panel's, and a button's each.
    assert.equal(rects("confirm, _*5, pause, _*3", "#000000aa"), 1);
    assert.equal(rects("confirm, _*5, _*3", "#000000aa"), 0);
    const buttons = (script: string) => rects(script, "#3b4468ff");
    assert.equal(buttons("confirm, _*5, pause, _*3") - buttons("confirm, _*5, _*3"), 2, "RESUME and QUIT TO TITLE");
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
