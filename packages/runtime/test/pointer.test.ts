import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Pointer, World } from "../src/index.ts";

function mounted(options: { x?: number; y?: number; presses?: number[] } = {}) {
  const presses = options.presses ?? [];
  const world = new World();
  const pointer = new Pointer({ width: 20, height: 10, onPress: () => presses.push(presses.length) });
  pointer.transform.x = options.x ?? 0;
  pointer.transform.y = options.y ?? 0;
  world.mount(pointer);
  return { world, pointer, presses };
}

describe("Pointer", () => {
  it("calls onPress for a press inside the area, with the top-left corner as its origin", () => {
    const { world, pointer, presses } = mounted({ x: 100, y: 50 });
    assert.equal(world.reportPress(pointer, 110, 55), true);
    assert.equal(world.reportPress(pointer, 100, 50), true, "the corner counts");
    assert.equal(world.reportPress(pointer, 120, 60), true, "so does the far corner");
    assert.equal(presses.length, 3);
  });

  it("does not call it for a press outside, and reports a miss", () => {
    const { world, pointer, presses } = mounted({ x: 100, y: 50 });
    for (const [x, y] of [[99, 55], [121, 55], [110, 49], [110, 61], [0, 0]] as const) {
      assert.equal(world.reportPress(pointer, x, y), false, `${x},${y}`);
    }
    assert.deepEqual(presses, []);
  });

  it("is hit where it is drawn when its parent moves and scales it", () => {
    const world = new World();
    const parent = new Entity();
    parent.transform.x = 100;
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 3;
    const presses: number[] = [];
    const pointer = new Pointer({ width: 20, height: 10, onPress: () => presses.push(1) });
    pointer.transform.x = 5;
    parent.addChild(pointer);
    world.mount(parent);
    // x from 110 to 150, y from 0 to 30.
    assert.equal(world.reportPress(pointer, 149, 29), true);
    assert.equal(world.reportPress(pointer, 151, 29), false);
    assert.equal(world.reportPress(pointer, 149, 31), false);
    assert.equal(world.reportPress(pointer, 109, 5), false);
  });

  it("is hit where it is drawn when it is rotated", () => {
    const { world, pointer } = mounted({ x: 0, y: 0 });
    pointer.transform.rotation = Math.PI / 2; // turns clockwise on a y-down screen: local +x points down
    assert.equal(world.reportPress(pointer, -5, 15), true, "local (15, 5)");
    assert.equal(world.reportPress(pointer, 5, 15), false, "local (15, -5)");
    assert.equal(world.reportPress(pointer, 15, 5), false, "the unrotated area");
  });

  it("is never hit with a zero scale, and ignores a pointer that is not in this world", () => {
    const { world, pointer } = mounted();
    pointer.transform.scaleX = 0;
    assert.equal(world.reportPress(pointer, 0, 0), false);
    const other = mounted();
    assert.equal(world.reportPress(other.pointer, 1, 1), false, "mounted in another world");
    assert.deepEqual(other.presses, []);
  });

  it("only dispatches: a handler that sets state renders in the next flush", () => {
    const { world, pointer } = mounted();
    assert.doesNotThrow(() => world.reportPress(pointer, 1, 1));
    assert.equal(world.flush(), 0);
  });
});
