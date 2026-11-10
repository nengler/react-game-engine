import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, type InputState } from "@rge/runtime";
import { createPlayer, MAX_STEPS_PER_FRAME, RecordingBackend, type InputFrame, type PlayerConfig } from "../src/index.ts";

/** Records what each tick of it saw. */
class Probe extends Entity {
  readonly dts: number[] = [];
  readonly saw: string[] = [];
  override onInput(input: InputState): void {
    this.saw.push(`${input.down("Space") ? "d" : "-"}${input.pressed("Space") ? "p" : "-"}${input.released("Space") ? "r" : "-"}`);
  }
  override onUpdate(dt: number): void {
    this.dts.push(dt);
  }
}

function run(frames: readonly InputFrame[], config: Partial<PlayerConfig> = { fixedStep: 60 }): Probe {
  const backend = new RecordingBackend();
  const probe = new Probe();
  for (const f of frames) backend.queueInput(f);
  const player = createPlayer(backend, { root: () => probe, ...config });
  for (let i = 0; i <= frames.length; i++) player.step(); // the first step has no input yet
  player.close();
  return probe;
}

const idle = (n: number, dt: number): InputFrame[] => Array.from({ length: n }, () => ({ dt }));

describe("fixed timestep", () => {
  it("runs one step per frame of 1/60 s, each with dt 1/60, however many frames there are", () => {
    const probe = run(idle(600, 1 / 60));
    assert.equal(probe.dts.length, 600, "no step lost to rounding (the warm-up frame has dt 0)");
    assert.ok(probe.dts.every((d) => d === 1 / 60));
  });

  it("runs two steps for a slow frame and none for a fast one", () => {
    assert.equal(run(idle(10, 1 / 30)).dts.length, 20);
    const fast = run(idle(10, 1 / 120));
    assert.equal(fast.dts.length, 5, "a step every second frame");
  });

  it("carries the leftover time to the next frame", () => {
    // 1/45 s is a step and a third: three frames are exactly four steps.
    const probe = run(idle(3, 1 / 45));
    assert.equal(probe.dts.length, 4);
  });

  it("caps a stall to a few steps and forgets the rest", () => {
    const probe = run(idle(1, 5));
    assert.ok(probe.dts.length <= MAX_STEPS_PER_FRAME);
    assert.equal(run([{ dt: 5 }, { dt: 1 / 60 }]).dts.length, 6 + 1 + 0, "0.1 s is clamped to 6 steps; then one step; no burst after");
  });

  it("is off unless asked for: one update per frame with the frame's own time", () => {
    const probe = run([{ dt: 0.02 }, { dt: 0.05 }], {});
    assert.deepEqual(probe.dts, [0, 0.02, 0.05]);
  });

  it("shows a press to exactly one step, even when the frame has two or none", () => {
    // Frame with two steps (dt 1/30): the press is in the first only.
    const two = run([{ dt: 1 / 30, pressed: ["Space"] }, { dt: 1 / 30, down: ["Space"] }, { dt: 1 / 30, released: ["Space"] }]);
    assert.deepEqual(two.saw, ["dp-", "d--", "d--", "d--", "--r", "---"]);
    // A press on a frame that runs no step (a 120 Hz frame) is seen by the next step.
    const none = run([{ dt: 1 / 120, pressed: ["Space"] }, { dt: 1 / 120, down: ["Space"] }, { dt: 1 / 120, down: ["Space"] }]);
    assert.equal(none.saw.filter((s) => s[1] === "p").length, 1, "seen once");
    assert.equal(none.saw.findIndex((s) => s[1] === "p"), none.saw.findIndex((s) => s[0] === "d"), "and the key is down for that step");
  });

  it("does not lose a tap that was released before the step ran", () => {
    const tap = run([{ dt: 1 / 120, pressed: ["Space"] }, { dt: 1 / 120, released: ["Space"] }, { dt: 1 / 120 }]);
    assert.deepEqual(tap.saw.filter((s) => s !== "---"), ["dpr"], "down, pressed and released in the one step");
  });

  it("rejects a rate that is not positive", () => {
    assert.throws(() => run([], { fixedStep: 0 }), /fixedStep/);
  });
});
