import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInputScript, runScript } from "@rge/player";
import { createMemoryStorage, setStorage, setVolume } from "@rge/runtime";
import { bindings, gameConfig } from "../game.ts";
import { save, useGame } from "../src/GameState.ts";
import { settings } from "../src/settings.ts";
import { controls } from "../src/rules/controls.ts";
import { settingsRows, titleRows } from "../src/rules/menu.ts";

/** Play a script from the title on a backend that starts with `storage`; `backend.stored` is what the run wrote. */
function run(script: string, storage: Record<string, string> = {}) {
  const frames = parseInputScript(script, { bindings });
  return runScript(gameConfig, frames, () => {
    const s = useGame.getState();
    return { screen: s.screen, map: s.run.map, items: { ...s.run.items }, rows: s.menu.rows.map((r) => `${r.label}:${r.value}`), capturing: s.menu.capturing };
  }, { storage });
}

test("the title offers Continue only when there is a save", () => {
  assert.deepEqual(titleRows(false).map((r) => r.id), ["new", "settings"]);
  assert.deepEqual(titleRows(true).map((r) => r.id), ["continue", "new", "settings"]);
});

test("stepping onto a shrine writes the save, and a second run's title offers Continue and returns to where it was kept", () => {
  // New game, pick up the lantern, go back to the first shrine.
  const first = run("_, Enter, _*3, right*50, left*50, up*20, _*3");
  const stored = first.backend.stored.get("save");
  assert.ok(stored !== undefined, "the shrine wrote a save");
  const data = (JSON.parse(stored) as { version: number; data: { items: Record<string, number>; shrine: { map: string } } });
  assert.equal(data.version, 1);
  assert.equal(data.data.items.lantern, 1, "the save holds what was picked up before the shrine");

  const second = run("_, Enter, _*3", { save: stored });
  const rows = second.states[0]!.rows;
  assert.ok(rows[0]!.startsWith("Continue"), "Continue is the first choice of the title");
  const last = second.states.at(-1)!;
  assert.equal(last.screen, "play");
  assert.equal(last.items.lantern, 1, "the lantern was kept");
});

test("Continue with a save that cannot be read falls back to a new game, and says so once", () => {
  const warnings: string[] = [];
  setStorage(createMemoryStorage({ save: "garbage" }));
  assert.equal(save.exists(), true);
  const original = console.warn;
  console.warn = (m: string) => void warnings.push(m);
  try {
    useGame.getState().continueGame();
    assert.equal(useGame.getState().screen, "play");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
    setStorage(null);
    useGame.getState().toTitle();
  }
});

test("settings: a volume changes and is stored, kept apart from the save", () => {
  const r = run("_, down, Enter, _*2, right, _, right, _");
  const stored = JSON.parse(r.backend.stored.get("settings") as string) as { data: { music: number } };
  assert.equal(stored.data.music, 0.8, "two steps of a tenth up from 0.6");
  assert.equal(r.backend.stored.has("save"), false);
  const rows = r.states.at(-1)!.rows;
  assert.ok(rows[0]!.startsWith("Music:80%"));
});

test("rebinding: choose a key's row, press a key, and the action means that key from then on, and is stored", () => {
  // Settings; down to the row of "Up" (after music, effects, full screen); confirm; press W.
  const r = run("_, down, Enter, _*2, down, _, down, _, down, _, Enter, _, W, _*2");
  const states = r.states;
  assert.ok(states.some((s) => s.capturing === "up"), "the row waited for a key");
  assert.equal(states.at(-1)!.capturing, null);
  assert.deepEqual(controls.keysOf("up"), ["W"], "the Controls were rebound");
  const stored = JSON.parse(r.backend.stored.get("settings") as string) as { data: { bindings: Record<string, string[]> } };
  assert.deepEqual(stored.data.bindings["up"], ["W"]);
  assert.ok(states.at(-1)!.rows.some((row) => row.startsWith("Up:W")));
  settings.reset();
  setStorage(null);
  setVolume("music", 1);
  setVolume("effects", 1);
});

test("settings rows show volumes as percentages and the keys by name", () => {
  const rows = settingsRows({ music: 0.6, effects: 0.8, fullscreen: true }, { up: ["ArrowUp", "W"], action: ["Z"], confirm: ["Enter"], back: ["Escape"] }, "left");
  assert.deepEqual(rows.slice(0, 3).map((r) => r.value), ["60%", "80%", "On"]);
  assert.equal(rows.find((r) => r.id === "bind:up")!.value, "Up / W");
  assert.equal(rows.find((r) => r.id === "bind:left")!.value, "press a key...");
  assert.equal(rows.find((r) => r.id === "bind:back")!.value, "Esc");
});

