import assert from "node:assert/strict";
/** Collider shapes: the geometry of a box, a circle and a polygon in the world, and whether two overlap. */
import { describe, it } from "node:test";

import { geometriesOverlap, geometryOf, geometryOverlapsBox, type ShapedCollider } from "../src/shapes.ts";

const AT = (x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1) => ({ x, y, rotation, scaleX, scaleY });
const shape = (s: Partial<ShapedCollider>): ShapedCollider => ({ shape: "box", width: 10, height: 10, points: [], ...s });

describe("collider shapes", () => {
  it("makes a circle inside its box, centred, half the shorter side across, scaled", () => {
    assert.deepEqual(geometryOf(shape({ shape: "circle", width: 20, height: 10 }), AT(100, 50)), {
      kind: "circle",
      x: 110,
      y: 55,
      radius: 5,
    });
    assert.deepEqual(geometryOf(shape({ shape: "circle" }), AT(0, 0, 0, 2, 2)), { kind: "circle", x: 10, y: 10, radius: 10 });
  });

  it("has no shape without an area, or a polygon of fewer than three corners", () => {
    assert.equal(geometryOf(shape({ width: 0 }), AT()), null);
    assert.equal(geometryOf(shape({ shape: "polygon", points: [0, 0, 5, 5] }), AT()), null);
    assert.equal(geometryOf(shape({ shape: "polygon", points: [0, 0, 5, NaN, 0, 5] }), AT()), null);
  });

  it("tells circles apart whose boxes overlap only at the corners", () => {
    const a = geometryOf(shape({ shape: "circle" }), AT(0, 0))!;
    const b = geometryOf(shape({ shape: "circle" }), AT(8, 8))!;
    assert.equal(geometriesOverlap(a, b), false, "corner to corner: the boxes overlap, the circles do not");
    assert.equal(geometriesOverlap(a, geometryOf(shape({ shape: "circle" }), AT(6, 6))!), true);
    assert.equal(geometriesOverlap(a, geometryOf(shape({ shape: "circle" }), AT(10, 0))!), false, "touching is not overlapping");
  });

  it("tests a circle against a box, at an edge and at a corner", () => {
    const circle = geometryOf(shape({ shape: "circle" }), AT(0, 0))!; // middle (5, 5), radius 5
    assert.equal(geometryOverlapsBox(circle, 9, 0, 10, 10), true, "into its side");
    assert.equal(geometryOverlapsBox(circle, 9, 9, 10, 10), false, "the box's corner is outside the circle, though the boxes overlap");
    assert.equal(geometryOverlapsBox(circle, 8, 8, 10, 10), true, "a corner well inside");
  });

  it("turns a box with its object exactly, where its upright bounds would overlap", () => {
    const diamond = geometryOf(shape({}), AT(0, 0, Math.PI / 4))!; // a 10 × 10 square turned 45° about (0, 0)
    assert.equal(geometryOverlapsBox(diamond, 4, 1, 2, 2), false, "outside the diamond, inside its bounds");
    assert.equal(geometryOverlapsBox(diamond, -1, 6, 2, 2), true);
  });

  it("tests a convex polygon (a triangle) against a box and a circle", () => {
    const triangle = geometryOf(shape({ shape: "polygon", width: 10, height: 10, points: [0, 10, 10, 10, 10, 0] }), AT())!;
    assert.equal(geometryOverlapsBox(triangle, 0, 0, 3, 3), false, "the empty half of its box");
    assert.equal(geometryOverlapsBox(triangle, 7, 7, 3, 3), true);
    assert.equal(geometriesOverlap(triangle, { kind: "circle", x: 1, y: 1, radius: 2 }), false);
    assert.equal(geometriesOverlap(triangle, { kind: "circle", x: 9, y: 9, radius: 2 }), true);
  });
});

describe("body queries and shaped colliders", () => {
  it("finds a circle collider by its circle, not its box", async () => {
    const { Collider, Entity, World } = await import("../src/index.ts");
    const world = new World();
    const orb = new Entity({ name: "orb" });
    orb.addChild(new Collider({ width: 10, height: 10, tag: "orb", shape: "circle" }));
    const asker = new Entity({ name: "asker" });
    world.mount(orb);
    world.mount(asker);
    world.flush();
    assert.equal(world.tagIn({ x: 9, y: 9, width: 4, height: 4 }, "orb", asker), false, "the box's corner, outside the circle");
    assert.equal(world.tagIn({ x: 4, y: 4, width: 4, height: 4 }, "orb", asker), true);
    assert.equal(world.collidersIn({ x: 9, y: 9, width: 4, height: 4 }, "orb", asker).length, 0);
    assert.equal(world.collidersIn({ x: 6, y: 0, width: 4, height: 10 }, "orb", asker).length, 1);
  });
});
