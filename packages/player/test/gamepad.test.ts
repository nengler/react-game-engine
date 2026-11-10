import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Game, type InputState } from "@rge/runtime";
import { createPlayer, KEYS, parseInputScript, RecordingBackend } from "../src/index.ts";

class Pad extends Entity {
  saw: string[] = [];
  override onInput(input: InputState): void {
    this.saw.push([input.down("PadA") ? "A" : "", input.pressed("PadA") ? "p" : "", input.down("PadLeft") ? "L" : "", input.down("PadStart") ? "S" : ""].join(""));
  }
}

describe("gamepad keys", () => {
  it("are keys like any other: PadA..PadStart and the four directions, readable in useInput and scriptable", () => {
    for (const name of ["PadA", "PadB", "PadX", "PadY", "PadLB", "PadRB", "PadBack", "PadStart", "PadLeft", "PadRight", "PadUp", "PadDown"]) assert.ok(KEYS.includes(name), name);
    const pad = new Pad();
    const backend = new RecordingBackend();
    for (const f of parseInputScript("PadA*2+PadLeft*3, PadStart, _")) backend.queueInput(f);
    const player = createPlayer(backend, { root: () => pad });
    for (let i = 0; i < 7; i++) player.step();
    player.close();
    assert.deepEqual(pad.saw, ["", "Ap" + "L", "AL", "L", "S", "", ""]);
  });

  it("send the dead zone from the Game, or the config, to the backend when the window opens", () => {
    const withGame = new RecordingBackend();
    createPlayer(withGame, { root: () => new Game({ gamepadDeadzone: 0.5 }) }).close();
    assert.equal(withGame.gamepadDeadzone, 0.5);
    const withConfig = new RecordingBackend();
    createPlayer(withConfig, { gamepadDeadzone: 0.2, root: () => new Entity() }).close();
    assert.equal(withConfig.gamepadDeadzone, 0.2);
    const none = new RecordingBackend();
    createPlayer(none, { root: () => new Entity() }).close();
    assert.equal(none.gamepadDeadzone, null, "left to librge's default (0.35)");
  });
});
