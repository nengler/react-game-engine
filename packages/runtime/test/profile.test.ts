import assert from "node:assert/strict";
/** The development profiler: each component's input, update and render time per frame, and the player's phases. */
import { afterEach, describe, it } from "node:test";

import { activeProfiler, Entity, startProfiling, stopProfiling, World, type InputState } from "../src/index.ts";

/** Work that takes a measurable time. */
function busy(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until);
}

class Enemy extends Entity {
  override onUpdate(_dt: number, _input: InputState): void {
    busy(0.2);
    this.markDirty();
  }
  override render(): void {
    busy(0.1);
  }
}

class Cursor extends Entity {
  override onInput(_input: InputState): void {
    busy(0.1);
  }
}

describe("the profiler", () => {
  afterEach(() => stopProfiling());

  it("is off unless started, and then times each component's input, update and render, averaged per frame", () => {
    assert.equal(activeProfiler(), null);
    const world = new World();
    const root = new Entity();
    for (let i = 0; i < 3; i++) root.addChild(new Enemy());
    root.addChild(new Cursor());
    world.mount(root);
    world.flush();
    const profiler = startProfiling();
    assert.equal(activeProfiler(), profiler);
    for (let frame = 0; frame < 4; frame++) {
      world.tick(1 / 60);
      profiler.phase("steps", 2);
      profiler.frame();
    }
    const report = profiler.take();
    assert.equal(report.frames, 4);
    assert.deepEqual(report.phases, { steps: 2 });
    const [first, second] = report.components;
    assert.equal(first!.name, "Enemy", "the most expensive first");
    assert.equal(first!.instances, 3);
    assert.ok(first!.update >= 0.6 && first!.render >= 0.3, `three enemies a frame: ${JSON.stringify(first)}`);
    assert.equal(first!.renders, 3);
    assert.ok(Math.abs(first!.total - (first!.input + first!.update + first!.render)) < 1e-9);
    assert.equal(second!.name, "Cursor");
    assert.ok(second!.input >= 0.1 && second!.update === 0);
    assert.deepEqual(profiler.take().components, [], "take starts a new window");
  });

  it("times nothing once stopped", () => {
    const world = new World();
    world.mount(new Enemy());
    world.flush();
    const profiler = startProfiling();
    stopProfiling();
    world.tick(1 / 60);
    assert.equal(activeProfiler(), null);
    assert.deepEqual(profiler.peek().components, []);
  });
});
