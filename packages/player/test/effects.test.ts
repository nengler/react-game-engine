/** Effect stores: particle bursts drawn by a <ParticleLayer>, sounds played by name, and a camera shake started from anywhere. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AfterimageLayer, AnimatedSprite, Camera, Entity, ParticleLayer, Sprite, World, createAfterimages, createParticles, createShake, createSounds, createSquash, freeze, getSoundSink, setSoundSink, type SoundSink } from "@rge/runtime";
import { createPlayer, RecordingBackend, type DecodedRecord } from "../src/index.ts";

const ofOp = <T extends DecodedRecord["op"]>(frame: readonly DecodedRecord[], op: T): Extract<DecodedRecord, { op: T }>[] => frame.filter((r): r is Extract<DecodedRecord, { op: T }> => r.op === op);

describe("createParticles and <ParticleLayer>", () => {
  it("makes a burst where it is asked, in the layer's space, and it plays out after whoever asked has gone", () => {
    const fx = createParticles({ dust: { burst: 5, lifetime: 0.5, speed: 0, spread: 0 }, spark: { burst: 2, lifetime: 1, speed: 0 } });
    const world = new World();
    const root = new Entity();
    const layer = new ParticleLayer({ particles: fx });
    layer.transform.x = 10;
    const asker = new Entity();
    root.addChild(layer);
    root.addChild(asker);
    world.mount(root);
    fx.burst("dust", 100, 50);
    fx.burst("spark", 0, 0, { count: 3 });
    root.removeChild(asker);
    world.tick(1 / 60);
    const [dust, spark] = layer.children as unknown as { count: number; read(i: number, o: { x: number; y: number; t: number }): void }[];
    assert.equal(dust!.count, 5);
    assert.equal(spark!.count, 3, "count overrides the preset's burst");
    const out = { x: 0, y: 0, t: 0 };
    dust!.read(0, out);
    assert.deepEqual([out.x, out.y], [100, 50], "in the layer's own space (its transform moves the drawing, not the point)");
    assert.deepEqual(fx.bursts, { dust: 1, spark: 1 });
    for (let i = 0; i < 40; i++) world.tick(1 / 60);
    assert.equal(dust!.count, 0, "over after its lifetime");
  });

  it("is drawn by the player as the layer's squares, and counts bursts with no layer mounted", () => {
    const fx = createParticles({ dust: { burst: 4, lifetime: 1, speed: 0, color: "#ff0000", size: 2 } });
    fx.burst("dust", 1, 1);
    assert.equal(fx.bursts["dust"], 1, "no layer: counted, nothing drawn, no error");
    const backend = new RecordingBackend({});
    for (let i = 0; i < 4; i++) backend.queueInput({ dt: 1 / 60 });
    let asked = false;
    class Asker extends Entity {
      override onUpdate(): void {
        if (!asked) fx.burst("dust", 40, 30);
        asked = true;
      }
    }
    const player = createPlayer(backend, {
      root: () => {
        const root = new Entity();
        root.addChild(new Asker());
        root.addChild(new ParticleLayer({ particles: fx }));
        return root;
      },
      retain: "check",
    });
    for (let i = 0; i < 4; i++) player.step();
    player.close();
    const rects = ofOp(backend.frames[2]?.records ?? [], "rect");
    assert.equal(rects.length, 4);
    assert.ok(rects.every((r) => r.x === 39 && r.y === 29 && r.color.startsWith("#ff0000")), JSON.stringify(rects[0]));
  });

  it("stops while the world is frozen, as every emitter does, and names the bursts it has when asked for another", () => {
    const fx = createParticles({ dust: { burst: 1, lifetime: 0.1, speed: 0 } });
    const world = new World();
    const layer = new ParticleLayer({ particles: fx });
    world.mount(layer);
    fx.burst("dust", 0, 0);
    freeze(20);
    for (let i = 0; i < 10; i++) world.tick(1 / 60);
    assert.equal((layer.children[0] as unknown as { count: number }).count, 1, "frozen: still alive");
    assert.throws(() => (fx as unknown as { burst(n: string, x: number, y: number): void }).burst("smoke", 0, 0), /no particle burst named 'smoke' \(there are: dust\)/);
  });
});

describe("createSounds", () => {
  it("plays a sound by name at its volume, and loads every file when a sink is installed", () => {
    const loaded: string[] = [];
    const played: [string, number][] = [];
    const sink: SoundSink = { load: (p) => loaded.push(p), play: (p, v) => played.push([p, v]) };
    const before = getSoundSink();
    const sfx = createSounds({ jump: "jump-test.wav", land: { src: "land-test.wav", volume: 0.5 } });
    try {
      setSoundSink(sink);
      assert.ok(loaded.includes("jump-test.wav") && loaded.includes("land-test.wav"), "loaded before the first play");
      sfx.play("land");
      sfx.play("land", 0.5);
      sfx.play("jump");
      assert.deepEqual(played, [["land-test.wav", 0.5], ["land-test.wav", 0.25], ["jump-test.wav", 1]]);
      assert.equal(sfx.plays("land"), 2);
    } finally {
      setSoundSink(before);
    }
  });
});

describe("createShake and <Camera shake>", () => {
  it("shakes the camera that has it when started, with the strength and time of that start", () => {
    const shake = createShake({ strength: 4, duration: 0.2 });
    const run = (start: (i: number) => void): number[] => {
      const c = new Camera({ shake });
      c.viewWidth = 320;
      c.viewHeight = 180;
      const out: number[] = [];
      for (let i = 0; i < 30; i++) {
        start(i);
        c.onUpdate(1 / 60);
        out.push(c.viewTransform().e);
      }
      return out;
    };
    const a = run((i) => i === 2 && shake.start());
    assert.ok(a.slice(0, 2).every((e) => e === 0), "still before it is started");
    assert.ok(a.slice(2, 6).some((e) => e !== 0));
    assert.ok(Math.max(...a.map(Math.abs)) <= 4);
    assert.ok(a.slice(-10).every((e) => e === 0), "over after 0.2 seconds");
    const long = run((i) => i === 2 && shake.start(4, 0.4));
    assert.ok(long.slice(16, 20).some((e) => e !== 0), "a longer start lasts longer");
  });
});

describe("createSquash and <Sprite squash>", () => {
  it("throws the sprite's scale and springs it back at its rate, only while the sprite that has it is in the world", () => {
    const squash = createSquash({ recover: 2 });
    const world = new World();
    const root = new Entity();
    const sprite = new AnimatedSprite({ sheet: "s.png", frameWidth: 4, frameHeight: 4, animations: "idle:0", squash });
    root.addChild(sprite);
    world.mount(root);
    squash.start(0.6, 1.4);
    world.tick(0.1);
    assert.ok(Math.abs(squash.x - 0.8) < 1e-9 && Math.abs(squash.y - 1.2) < 1e-9);
    freeze(3);
    world.tick(0.1); // the freeze is taken when this tick ends
    const before = squash.x;
    world.tick(0.1);
    world.tick(0.1);
    assert.equal(squash.x, before, "frozen with the world");
    for (let i = 0; i < 10; i++) world.tick(0.1);
    assert.equal(squash.resting, true);
    root.removeChild(sprite);
    squash.start(0.5, 0.5);
    world.tick(0.1);
    assert.equal(squash.x, 0.5, "with no sprite in a world, nothing springs it back");
  });

  it("is drawn as the sprite's scale about its origin, on top of the transform's, and drawn again each step it moves", () => {
    const squash = createSquash();
    const backend = new RecordingBackend({ textureSizes: { "assets/s.png": { width: 12, height: 12 } } });
    for (let i = 0; i < 4; i++) backend.queueInput({ dt: 1 / 60 });
    let sprite: Sprite | null = null;
    const player = createPlayer(backend, {
      root: () => {
        sprite = new Sprite({ image: "s.png", originX: 6, originY: 12, squash });
        sprite.transform.scaleX = 2;
        return sprite;
      },
      retain: "check",
    });
    player.step();
    squash.start(0.5, 1.5);
    player.step();
    player.step();
    player.close();
    const region = (frame: number) => ofOp(backend.frames[frame]?.records ?? [], "spriteRegion")[0];
    assert.deepEqual([region(0)?.scaleX, region(0)?.scaleY], [2, 1]);
    const squashed = region(1)!;
    assert.ok(squashed.scaleX < 2 && squashed.scaleY > 1, JSON.stringify(squashed));
    assert.ok(region(2)!.scaleX > squashed.scaleX, "springing back, frame by frame");
    assert.deepEqual([squashed.originX, squashed.originY], [6, 12]);
  });
});

describe("createAfterimages and <AfterimageLayer>", () => {
  it("copies the sprite where it is when emitting starts and every interval, and fades and drops each copy after its lifetime", () => {
    const trail = createAfterimages({ lifetime: 0.25, color: "#ff000080" });
    const world = new World();
    const root = new Entity();
    const sprite = new AnimatedSprite({ sheet: "s.png", frameWidth: 4, frameHeight: 4, animations: "run:0-3@10", flipX: true, afterimages: trail });
    const layer = new AfterimageLayer({ afterimages: trail, interval: 0.1 });
    root.addChild(sprite);
    root.addChild(layer);
    world.mount(root);
    world.tick(0.05);
    assert.equal(trail.images.length, 0, "nothing while not emitting");
    layer.emitting = true;
    for (let i = 0; i < 5; i++) {
      sprite.transform.x = i * 10;
      world.tick(0.05);
    }
    assert.deepEqual(trail.images.map((s) => s.x), [0, 20, 40], "on starting, then every 0.1 s, where the sprite was");
    assert.equal(trail.images[0]?.flipX, true);
    layer.emitting = false;
    for (let i = 0; i < 10; i++) world.tick(0.05);
    assert.equal(trail.images.length, 0, "faded and gone");
    sprite.parent!.removeChild(sprite);
    trail.capture();
    assert.equal(trail.images.length, 0, "a sprite out of the world is not copied");
  });

  it("is drawn by the player as tinted copies of the sprite's frame, fainter as they age, at the sprite's place then", () => {
    const trail = createAfterimages({ lifetime: 1, color: "#00ff00" });
    const backend = new RecordingBackend({ textureSizes: { "assets/s.png": { width: 8, height: 4 } } });
    for (let i = 0; i < 6; i++) backend.queueInput({ dt: 1 / 60 });
    let sprite: Sprite | null = null;
    const player = createPlayer(backend, {
      root: () => {
        const root = new Entity();
        sprite = new Sprite({ image: "s.png", frameWidth: 4, frameHeight: 4, frame: 1, afterimages: trail });
        sprite.transform.x = 30;
        root.addChild(new AfterimageLayer({ afterimages: trail }));
        root.addChild(sprite);
        return root;
      },
      retain: "check",
    });
    player.step();
    trail.capture();
    sprite!.transform.x = 60;
    sprite!.markMoved();
    player.step();
    player.step();
    player.step();
    player.close();
    const regions = (frame: number) => ofOp(backend.frames[frame]?.records ?? [], "spriteRegion");
    const [copy, live] = regions(1);
    assert.equal(copy?.x, 30, "the copy stays where it was taken");
    assert.equal(live?.x, 60);
    assert.equal(copy?.srcX, 4, "the same frame of the sheet");
    assert.ok(copy?.tint.startsWith("#00ff00"));
    const later = regions(3)[0]!;
    assert.ok(parseInt(later.tint.slice(7), 16) < parseInt(copy!.tint.slice(7), 16), "fainter with age");
  });
});
