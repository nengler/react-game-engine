import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnimatedSprite, Entity, World } from "../src/index.ts";

const FRAMES = ["a.png", "b.png", "c.png"];

describe("AnimatedSprite", () => {
  it("starts on the first frame, playing, at 10 fps", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES });
    assert.deepEqual([sprite.frame, sprite.image, sprite.playing, sprite.fps], [0, "a.png", true, 10]);
  });

  it("advances one frame per 1/fps seconds, carrying the remainder", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 4 });
    sprite.onUpdate(0.1);
    sprite.onUpdate(0.1);
    assert.equal(sprite.frame, 0, "0.2s is under 0.25s");
    sprite.onUpdate(0.1);
    assert.deepEqual([sprite.frame, sprite.image], [1, "b.png"]);
    assert.ok(Math.abs(sprite.elapsed - 0.05) < 1e-9, `the 0.05s left over is kept: ${sprite.elapsed}`);
    sprite.onUpdate(0.2);
    assert.equal(sprite.frame, 2);
  });

  it("takes several frames in one long step", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 4 });
    sprite.onUpdate(1);
    assert.equal(sprite.frame, 4 % 3);
    assert.equal(sprite.elapsed, 0);
  });

  it("does not lose a frame to rounding: ten ticks of 0.1s at 10 fps are ten frames", () => {
    const sprite = new AnimatedSprite({ frames: Array.from({ length: 11 }, (_, i) => `${i}.png`), fps: 10 });
    for (let i = 0; i < 10; i++) sprite.onUpdate(0.1);
    assert.equal(sprite.frame, 10);
  });

  it("freezes while not playing, keeping its frame and not saving up time, and resumes from there", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 1 });
    sprite.onUpdate(1);
    sprite.playing = false;
    sprite.onUpdate(5);
    assert.deepEqual([sprite.frame, sprite.elapsed], [1, 0]);
    sprite.playing = true;
    sprite.onUpdate(0.5);
    assert.equal(sprite.frame, 1, "no burst of frames for the time it was paused");
    sprite.onUpdate(0.5);
    assert.equal(sprite.frame, 2);
  });

  it("restarts when frames change to different contents", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 1 });
    sprite.onUpdate(1);
    sprite.onUpdate(0.5);
    sprite.frames = ["x.png", "y.png"];
    assert.deepEqual([sprite.frame, sprite.elapsed, sprite.image], [0, 0, "x.png"]);
  });

  it("does not restart when frames are set to equal contents, which is what a dynamic prop does every render", () => {
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 1 });
    sprite.onUpdate(1);
    sprite.onUpdate(0.5);
    sprite.frames = [...FRAMES];
    assert.deepEqual([sprite.frame, sprite.elapsed], [1, 0.5]);
  });

  it("keeps its own copy of the frames", () => {
    const frames = ["a.png", "b.png"];
    const sprite = new AnimatedSprite({ frames });
    frames.push("c.png");
    assert.deepEqual(sprite.frames, ["a.png", "b.png"]);
    const next = ["x.png"];
    sprite.frames = next;
    next[0] = "changed.png";
    assert.equal(sprite.image, "x.png");
  });

  it("shows nothing and does not advance with no frames, then starts when given some", () => {
    const sprite = new AnimatedSprite({ frames: [] });
    sprite.onUpdate(10);
    assert.deepEqual([sprite.image, sprite.frame], ["", 0]);
    sprite.frames = FRAMES;
    sprite.onUpdate(0.1);
    assert.equal(sprite.image, "b.png");
  });

  it("freezes for an fps that is not positive and finite, and ignores a dt that is not positive", () => {
    for (const fps of [0, -5, NaN, Infinity]) {
      const sprite = new AnimatedSprite({ frames: FRAMES, fps });
      sprite.onUpdate(1);
      assert.equal(sprite.frame, 0, `fps ${fps}`);
    }
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 10 });
    sprite.onUpdate(0);
    sprite.onUpdate(-1);
    sprite.onUpdate(NaN);
    assert.deepEqual([sprite.frame, sprite.elapsed], [0, 0]);
  });
});

describe("AnimatedSprite in a World", () => {
  it("is advanced by every tick while it is in the world, with no render", () => {
    const world = new World();
    const parent = new Entity();
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 2 });
    parent.addChild(sprite);
    world.mount(parent);
    assert.equal(world.tick(0.5), 0, "advancing a frame renders nothing");
    assert.equal(sprite.frame, 1);
    world.tick(0.5);
    assert.equal(sprite.frame, 2);
  });

  it("stops being advanced when it leaves the world", () => {
    const world = new World();
    const sprite = new AnimatedSprite({ frames: FRAMES, fps: 2 });
    world.mount(sprite);
    world.tick(0.5);
    world.root.removeChild(sprite);
    world.tick(0.5);
    assert.equal(sprite.frame, 1);
  });
});
