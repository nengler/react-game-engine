import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, scriptLength } from "../src/index.ts";

const bindings = { left: "ArrowLeft", right: ["ArrowRight", "D"], jump: "Z", dash: "X" };

describe("parseInputScript", () => {
  it("holds a name for a count of frames, pressing it on the first and releasing it on the frame after", () => {
    const frames = parseInputScript("right*3, _*2", { bindings });
    assert.equal(frames.length, 5);
    assert.deepEqual(frames[0]?.pressed, ["ArrowRight", "D"]);
    assert.deepEqual(frames[1]?.pressed, []);
    assert.deepEqual(frames[1]?.down, ["ArrowRight", "D"]);
    assert.deepEqual(frames[3]?.released, ["ArrowRight", "D"]);
    assert.deepEqual(frames[3]?.down, []);
  });

  it("makes a bare name a one-frame tap, and joins terms of an item so they start together", () => {
    const frames = parseInputScript("right*30, jump, right*20+dash", { bindings });
    assert.equal(frames.length, 30 + 1 + 20);
    assert.deepEqual(frames[29]?.down, ["ArrowRight", "D"]);
    assert.deepEqual(frames[30]?.down, ["Z"], "the tap is the frame after the hold, alone");
    assert.deepEqual(frames[30]?.released, ["ArrowRight", "D"]);
    assert.deepEqual(frames[31]?.down.sort(), ["ArrowRight", "D", "X"], "dash taps on the first frame of the third item, as right starts");
    assert.deepEqual(frames[31]?.pressed.sort(), ["ArrowRight", "D", "X"]);
    assert.deepEqual(frames[31]?.released, ["Z"]);
    assert.deepEqual(frames[32]?.down.sort(), ["ArrowRight", "D"], "and right carries on");
    assert.deepEqual(frames[32]?.released, ["X"]);
  });

  it("treats a key held across two items as one hold, and two taps in a row as one hold too", () => {
    const hold = parseInputScript("right*2, right*2", { bindings });
    assert.deepEqual(hold.map((f) => f.pressed.length), [2, 0, 0, 0]);
    const taps = parseInputScript("jump, jump, _, jump", { bindings });
    assert.deepEqual(taps.map((f) => f.pressed.length), [1, 0, 0, 1]);
  });

  it("accepts key names without a binding, and reports an unknown name with the actions it could have meant", () => {
    assert.deepEqual(parseInputScript("ArrowUp*2")[0]?.down, ["ArrowUp"]);
    assert.throws(() => parseInputScript("flap", { bindings }), /Unknown name 'flap'.*actions: left, right, jump, dash/);
    assert.throws(() => parseInputScript("right*x", { bindings }), /Cannot read 'right\*x'/);
  });

  it("gives every frame the same dt, 1/60 unless asked, and ignores blank items and new lines", () => {
    const frames = parseInputScript("_\n\n jump ,, _*2 ", { bindings, dt: 0.02 });
    assert.equal(frames.length, 4);
    assert.ok(frames.every((f) => f.dt === 0.02));
    assert.equal(parseInputScript("_")[0]?.dt, 1 / 60);
    assert.equal(scriptLength("right*30, jump", { bindings }), 31);
  });
});
