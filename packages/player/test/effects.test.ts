import assert from "node:assert/strict";
/** Effect stores (particle bursts drawn by a <ParticleLayer>, sounds played by name) and what useSquash does each step. */
import { describe, it } from "node:test";

import {
  Entity,
  ParticleLayer,
  World,
  createParticles,
  createSounds,
  freeze,
  springBack,
  getSoundSink,
  setSoundSink,
  type SoundSink,
} from "@tsengine/runtime";

import { createPlayer, RecordingBackend, type DecodedRecord } from "../src/index.ts";

const ofOp = <T extends DecodedRecord["op"]>(frame: readonly DecodedRecord[], op: T): Extract<DecodedRecord, { op: T }>[] =>
  frame.filter((r): r is Extract<DecodedRecord, { op: T }> => r.op === op);

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
    assert.ok(
      rects.every((r) => r.x === 39 && r.y === 29 && r.color.startsWith("#ff0000")),
      JSON.stringify(rects[0])
    );
  });

  it("draws a burst given its own colours in them, the preset's other bursts in the preset's, and forgets them once over", () => {
    const fx = createParticles({ puff: { burst: 2, lifetime: 0.1, speed: 0, color: "#ff0000", size: 2 } });
    const backend = new RecordingBackend({});
    for (let i = 0; i < 14; i++) backend.queueInput({ dt: 1 / 60 });
    let layer: ParticleLayer | null = null;
    class Asker extends Entity {
      override onUpdate(): void {
        if (fx.bursts["puff"] !== undefined) return;
        fx.burst("puff", 10, 10);
        fx.burst("puff", 40, 30, { color: "#00ff00" });
        fx.burst("puff", 70, 30, { endColor: "#0000ff" });
      }
    }
    const player = createPlayer(backend, {
      root: () => {
        const root = new Entity();
        root.addChild(new Asker());
        layer = new ParticleLayer({ particles: fx });
        root.addChild(layer);
        return root;
      },
      retain: "check",
    });
    for (let i = 0; i < 3; i++) player.step();
    const rects = ofOp(backend.frames[1]?.records ?? [], "rect");
    const at = (x: number) => rects.filter((r) => r.x === x - 1).map((r) => r.color.slice(0, 7));
    assert.deepEqual(at(10), ["#ff0000", "#ff0000"], "no colours given: the preset's");
    assert.deepEqual(at(40), ["#00ff00", "#00ff00"], "color given: that colour throughout (the preset has no endColor)");
    const toward = at(70);
    assert.equal(toward.length, 2);
    assert.ok(
      toward.every((c) => c !== "#ff0000" && c.startsWith("#") && c.slice(5, 7) !== "00"),
      `aged toward blue: ${toward}`
    );
    const emitter = (layer as unknown as ParticleLayer).children[0] as unknown as { hasOwnColors: boolean };
    assert.equal(emitter.hasOwnColors, true);
    for (let i = 0; i < 11; i++) player.step();
    player.close();
    assert.equal(emitter.hasOwnColors, false, "every particle gone: the burst colours are forgotten");
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
    assert.throws(
      () => (fx as unknown as { burst(n: string, x: number, y: number): void }).burst("smoke", 0, 0),
      /no particle burst named 'smoke' \(there are: dust\)/
    );
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
      assert.deepEqual(played, [
        ["land-test.wav", 0.5],
        ["land-test.wav", 0.25],
        ["jump-test.wav", 1],
      ]);
      assert.equal(sfx.plays("land"), 2);
    } finally {
      setSoundSink(before);
    }
  });
});

describe("springBack (what useSquash does each step)", () => {
  it("moves each axis back toward 1 at its rate, and returns the same object once at rest", () => {
    let scale = { x: 0.6, y: 1.4 };
    scale = springBack(scale, 2, 0.1);
    assert.ok(Math.abs(scale.x - 0.8) < 1e-9 && Math.abs(scale.y - 1.2) < 1e-9);
    for (let i = 0; i < 10; i++) scale = springBack(scale, 2, 0.1);
    assert.deepEqual(scale, { x: 1, y: 1 });
    assert.equal(springBack(scale, 2, 0.1), scale, "at rest: the same object, so a state holding it does not change");
  });
});
