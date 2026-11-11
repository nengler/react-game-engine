import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AnimatedSprite, parseAnimations } from "../src/index.ts";

describe("AnimatedSprite animations", () => {
  it("reads a table the same as the text form", () => {
    const text = parseAnimations("idle:0-1@3, run:2-7@14, step:1+2+1, die:12-15@16~");
    const table = parseAnimations({ idle: { frames: "0-1", fps: 3 }, run: { frames: [2, 3, 4, 5, 6, 7], fps: 14 }, step: { frames: "1+2+1" }, die: { frames: "12-15", fps: 16, once: true } });
    assert.deepEqual(table, text);
    assert.deepEqual(parseAnimations({ jump: { frames: 8 } }), [{ name: "jump", frames: [8], fps: 10, once: false }]);
  });

  it("rejects a table entry with no frames or a bad rate, naming it", () => {
    assert.throws(() => parseAnimations({ idle: { frames: [] } }), /'idle' needs frames/);
    assert.throws(() => parseAnimations({ idle: { frames: 1, fps: 0 } }), /'idle' needs a positive fps/);
  });

  it("keeps playing when the same table is set again, and restarts on a different one", () => {
    const sprite = new AnimatedSprite({ sheet: "s.png", frameWidth: 4, frameHeight: 4, animations: { run: { frames: "0-3", fps: 10 } }, animation: "run" });
    sprite.onUpdate(0.25);
    assert.equal(sprite.frame, 2);
    sprite.animations = { run: { frames: "0-3", fps: 10 } };
    assert.equal(sprite.frame, 2, "an equal table, written again by a render, changes nothing");
    sprite.animations = { run: { frames: "4-7", fps: 10 } };
    assert.equal(sprite.frame, 0);
  });
});
