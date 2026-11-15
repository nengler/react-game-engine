import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, GameObject } from "@rge/runtime";

import { parseInputScript, runScript, ScriptedInputBackend, RecordingBackend, type PlayerConfig } from "../src/index.ts";

/** A hand-written object that counts the frames in which it saw a key down and a key pressed: the observable of this test. */
class Counter extends Entity {
  downFrames = 0;
  pressedFrames = 0;
  override onInput(input: { down(key: string): boolean; pressed(key: string): boolean }): void {
    if (input.down("Space")) this.downFrames++;
    if (input.pressed("Space")) this.pressedFrames++;
  }
}

describe("runScript", () => {
  it("steps once per frame and gives each frame's input to its own step", () => {
    let counter: Counter | null = null;
    const config: PlayerConfig = { root: () => (counter = new Counter()) };
    const frames = parseInputScript("_*2, Space*3, _*2");
    const result = runScript(
      config,
      frames,
      () => `${(counter as unknown as Counter).downFrames}/${(counter as unknown as Counter).pressedFrames}`
    );
    assert.deepEqual(result.states, ["0/0", "0/0", "1/1", "2/1", "3/1", "3/1", "3/1"]);
    assert.equal(result.backend.frames.length, frames.length + 1, "the warm-up step plus one per frame");
    assert.deepEqual(result.warnings, []);
  });

  it("collects the game's warnings instead of printing them", () => {
    const config: PlayerConfig = { root: () => new GameObject() };
    const result = runScript(config, [{ dt: 1 / 60, down: ["Space"] }], () => 0);
    assert.deepEqual(result.warnings, []);
  });
});

describe("ScriptedInputBackend", () => {
  it("draws with the backend it wraps and takes its input from the script, window size included", () => {
    const inner = new RecordingBackend();
    const scripted = new ScriptedInputBackend(inner, [{ dt: 0.5, down: ["Space"] }]);
    scripted.open({ width: 10, height: 20, title: "t" });
    const input = new Float64Array(7);
    const keys = new Uint8Array(100);
    input[1] = 10;
    input[2] = 20;
    scripted.frame(0, new Float64Array(0), 0, [], input, keys);
    assert.equal(inner.frames.length, 1);
    assert.equal(input[0], 0.5);
    assert.equal(input[1], 10, "the window size the real backend reported is kept");
    assert.equal(keys[0], 1, "Space is down");
    scripted.frame(0, new Float64Array(0), 0, [], input, keys);
    assert.equal(input[0], 1 / 60, "an empty queue is an idle frame");
    assert.equal(keys[0], 0);
  });
});
