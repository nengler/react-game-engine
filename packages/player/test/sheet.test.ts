import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AnimatedSprite, Entity, Sprite } from "@tsengine/runtime";

import { createPlayer, RecordingBackend, type DecodedRecord, type PlayerConfig } from "../src/index.ts";

type Region = Extract<DecodedRecord, { op: "spriteRegion" }>;

const SHEETS = { "assets/hero.png": { width: 48, height: 24 }, "assets/tiles.png": { width: 40, height: 20 } };

function frames(
  root: PlayerConfig["root"],
  steps = 1,
  dts: number[] = []
): { regions: Region[][]; records: DecodedRecord[][]; warnings: string[] } {
  const backend = new RecordingBackend({ textureSizes: SHEETS });
  const warnings: string[] = [];
  for (const dt of dts) backend.queueInput({ dt });
  const player = createPlayer(backend, { root, retain: "check", warn: (m) => warnings.push(m) });
  for (let i = 0; i < steps; i++) player.step();
  player.close();
  return {
    regions: backend.frames.map((f) => f.records.filter((r): r is Region => r.op === "spriteRegion")),
    records: backend.frames.map((f) => [...f.records]),
    warnings,
  };
}

describe("sprite sheets and options", () => {
  it("draws one frame of a sheet: left to right, then down", () => {
    const { regions } = frames(() => {
      const root = new Entity();
      for (const frame of [0, 1, 4, 5]) root.addChild(new Sprite({ image: "hero.png", frameWidth: 12, frameHeight: 12, frame }));
      return root;
    });
    assert.deepEqual(
      regions[0]?.map((r) => [r.srcX, r.srcY, r.srcW, r.srcH]),
      [
        [0, 0, 12, 12],
        [12, 0, 12, 12],
        [0, 12, 12, 12],
        [12, 12, 12, 12],
      ],
      "a 48-wide sheet holds four 12-wide frames per row"
    );
  });

  it("keeps a plain sprite as it was: the old record, nothing new", () => {
    const { records, regions } = frames(() => new Sprite({ image: "hero.png" }));
    assert.equal(regions[0]?.length, 0);
    assert.ok(records[0]?.some((r) => r.op === "sprite"));
  });

  it("takes flips, an origin, a tint and an opacity", () => {
    const { regions } = frames(
      () => new Sprite({ image: "hero.png", flipX: true, flipY: true, originX: 6, originY: 12, tint: "#ff0000", opacity: 0.5 })
    );
    const r = regions[0]?.[0] as Region;
    assert.deepEqual(
      [r.flipX, r.flipY, r.originX, r.originY, r.srcW, r.srcH],
      [true, true, 6, 12, 48, 24],
      "the whole image when there is no frame size"
    );
    assert.equal(r.tint, "#ff000080", "red, at half opacity");
  });

  it("flashes: the same region again as its shape in the flash colour, at the flash amount times the opacity", () => {
    const { regions } = frames(() => {
      const root = new Entity();
      root.addChild(new Sprite({ image: "hero.png", frameWidth: 12, frameHeight: 12, frame: 1, flipX: true, flash: 0.5 }));
      root.addChild(new Sprite({ image: "hero.png", flash: 1, flashColor: "red", opacity: 0.5 }));
      root.addChild(
        new AnimatedSprite({ sheet: "hero.png", frameWidth: 12, frameHeight: 12, animations: "a:2", animation: "a", flash: 1 })
      );
      root.addChild(new Sprite({ image: "hero.png", tint: "#808080", flash: 0 }));
      return root;
    });
    const seen = (regions[0] ?? []).map((r) => [r.srcX, r.srcY, r.srcW, r.flipX, r.tint, r.silhouette ?? false]);
    assert.deepEqual(seen, [
      [12, 0, 12, true, "#ffffffff", false],
      [12, 0, 12, true, "#ffffff80", true],
      [0, 0, 48, false, "#ffffff80", false],
      [0, 0, 48, false, "#ff000080", true],
      [24, 0, 12, false, "#ffffffff", false],
      [24, 0, 12, false, "#ffffffff", true],
      [0, 0, 48, false, "#808080ff", false],
    ]);
  });

  it("plays named animations from a sheet: each at its own rate, looping or once", () => {
    let hero: AnimatedSprite | null = null;
    const { regions } = frames(
      () =>
        (hero = new AnimatedSprite({
          sheet: "hero.png",
          frameWidth: 12,
          frameHeight: 12,
          animations: "idle:0-1@2, run:4+5+6+5@10, die:2-3@10~",
          animation: "run",
        })),
      12,
      Array.from({ length: 11 }, () => 0.1)
    );
    const seen = regions.map((r) => (r[0]?.srcX ?? 0) / 12 + ((r[0]?.srcY ?? 0) / 12) * 4);
    assert.deepEqual(seen.slice(0, 6), [4, 5, 6, 5, 4, 5], "a frame per 0.1 s at 10 fps, then round again");
    assert.ok(hero !== null);
    const animated = hero as unknown as AnimatedSprite;
    animated.animation = "die";
    assert.equal(animated.frame, 0, "a different animation restarts");
    animated.animation = "die";
    animated.onUpdate(0.5);
    assert.equal(animated.sheetFrame, 3, "a ~ animation stays on its last frame");
    assert.ok(animated.finished);
    animated.animation = "idle";
    animated.onUpdate(0.5);
    assert.equal(animated.sheetFrame, 1);
    assert.ok(!animated.finished, "a looping animation is never finished");
  });

  it("can play every animation once with loop={false}, and says what is wrong with a malformed list", () => {
    const sprite = new AnimatedSprite({ sheet: "hero.png", frameWidth: 12, frameHeight: 12, animations: "a:0-2@10", loop: false });
    sprite.onUpdate(1);
    assert.equal(sprite.sheetFrame, 2);
    assert.throws(() => new AnimatedSprite({ sheet: "x.png", animations: "run 2-7" }), /Cannot read the animation 'run 2-7'/);
    assert.throws(() => new AnimatedSprite({ sheet: "x.png", animations: "a:0@5, a:1@5" }), /listed twice/);
    assert.throws(() => new AnimatedSprite({ sheet: "x.png", animations: "a:1-x@5" }), /Cannot read the animation/);
  });

  it("still plays a list of image files the way it always did", () => {
    const sprite = new AnimatedSprite({ frames: ["a.png", "b.png"], fps: 10 });
    sprite.onUpdate(0.1);
    assert.equal(sprite.image, "b.png");
    assert.equal(sprite.isSheet, false);
    assert.equal(sprite.sheetFrame, -1);
  });
});
