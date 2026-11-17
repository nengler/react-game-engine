import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Camera, Entity, Flex, Pointer, World } from "../src/index.ts";

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
    for (const [x, y] of [
      [99, 55],
      [121, 55],
      [110, 49],
      [110, 61],
      [0, 0],
    ] as const) {
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

  it("is never hit when it has no size, so a button that collapses stops firing", () => {
    const { world, pointer } = mounted();
    for (const [w, h] of [
      [0, 10],
      [20, 0],
      [-5, 10],
      [Number.NaN, 10],
    ] as const) {
      pointer.width = w;
      pointer.height = h;
      assert.equal(world.reportPress(pointer, 0, 0), false, `${w}x${h}`);
    }
  });

  it("is pressed at a world point, which a camera's viewToWorld gives for a point on screen", () => {
    const world = new World();
    const camera = new Camera({ zoom: 2 });
    const presses: number[] = [];
    const pointer = new Pointer({ width: 20, height: 10, onPress: () => presses.push(1) });
    pointer.transform.x = 100;
    pointer.transform.y = 100;
    camera.addChild(pointer);
    world.mount(camera);
    // Following the pointer, the camera puts its centre (the origin of view space) at the pointer's origin.
    const on = camera.viewToWorld(8, 4);
    assert.equal(world.reportPress(pointer, on.x, on.y), true, "a point on screen over the pointer");
    const off = camera.viewToWorld(60, 4);
    assert.equal(world.reportPress(pointer, off.x, off.y), false, "a point on screen beside it");
    assert.equal(presses.length, 1);
  });
});

describe("containsIn", () => {
  it("answers as contains does, given the parent's child space: under moved, scaled and turned parents, a camera, and a layout offset", () => {
    const world = new World();
    const outer = new Entity();
    outer.transform.x = 40;
    outer.transform.y = -15;
    outer.transform.rotation = 0.6;
    const camera = new Camera({ zoom: 2 });
    const inner = new Entity();
    inner.transform.scaleX = 1.5;
    inner.transform.scaleY = 0.5;
    inner.placement.x = 7;
    inner.layoutX = 3;
    inner.layoutY = 9;
    const pointer = new Pointer({ width: 20, height: 10, originX: 4, originY: 2 });
    pointer.transform.x = 11;
    pointer.transform.rotation = -0.3;
    pointer.layoutX = 5;
    const box = new Flex({ width: 30, height: 12 });
    box.box.size[0] = 30;
    box.box.size[1] = 12;
    box.transform.y = 6;
    inner.addChild(pointer);
    inner.addChild(box);
    camera.addChild(inner);
    outer.addChild(camera);
    world.mount(outer);
    const space = inner.childSpace();
    let inside = 0;
    for (let x = -40; x <= 120; x += 4)
      for (let y = -60; y <= 80; y += 4) {
        assert.equal(pointer.containsIn(space, x, y), pointer.contains(x, y), `pointer at ${x},${y}`);
        assert.equal(box.containsIn(space, x, y), box.contains(x, y), `box at ${x},${y}`);
        if (pointer.contains(x, y) || box.contains(x, y)) inside++;
      }
    assert.ok(inside > 5, `some of the points are on them (${inside})`);
    assert.deepEqual(pointer.worldTransformIn(space), pointer.worldTransform());
    assert.deepEqual(outer.worldTransformIn({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), outer.worldTransform());
  });
});
