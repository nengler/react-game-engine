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
    for (const name of ["PadA", "PadB", "PadX", "PadY", "PadLB", "PadRB", "PadBack", "PadStart", "PadLeft", "PadRight", "PadUp", "PadDown"] as const) assert.ok(KEYS.includes(name), name);
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

describe("the frame-rate counter", () => {
  const counters = (backend: RecordingBackend): string[] => backend.lastFrame.records.flatMap((r) => (r.op === "text" && / fps /.test(r.text) ? [r.text] : []));

  it("is off by default, on with showFps, and toggled by F3 (or the key chosen)", () => {
    const off = new RecordingBackend();
    const p1 = createPlayer(off, { root: () => new Entity() });
    p1.step();
    p1.step();
    p1.close();
    assert.deepEqual(counters(off), []);

    const on = new RecordingBackend();
    for (let i = 0; i < 3; i++) on.queueInput({ dt: 1 / 50 });
    const p2 = createPlayer(on, { root: () => new Game({ showFps: true }) });
    for (let i = 0; i < 4; i++) p2.step();
    p2.close();
    assert.match(counters(on)[0] as string, /^50 fps  \d+\.\d ms$/);

    const keyed = new RecordingBackend();
    keyed.queueInput({ dt: 1 / 60 });
    keyed.queueInput({ dt: 1 / 60, pressed: ["F3"] });
    keyed.queueInput({ dt: 1 / 60 });
    const p3 = createPlayer(keyed, { root: () => new Entity() });
    p3.step();
    p3.step();
    assert.deepEqual(counters(keyed), [], "not yet pressed");
    p3.step();
    assert.equal(counters(keyed).length, 1, "shown after F3");
    p3.close();
  });
});
