/** A body's queries over many colliders go through a grid per tag, and answer exactly what a plain scan would, in the same order. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, World, type Box, type BodySpace, type GameObject } from "../src/index.ts";

/** Colliders scattered over a 640 × 360 field, by a fixed sequence, with a few large ones. */
function field(): { world: World; root: Entity; colliders: Collider[] } {
  const world = new World();
  const root = new Entity();
  const colliders: Collider[] = [];
  let seed = 7;
  const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const big = i % 50 === 0;
    const c = new Collider({ width: big ? 400 : 4 + next() * 20, height: big ? 300 : 4 + next() * 20, tag: i % 3 === 0 ? "wall" : "enemy", solid: i % 3 === 0 });
    c.transform.x = next() * 640 - 20;
    c.transform.y = next() * 360 - 20;
    root.addChild(c);
    colliders.push(c);
  }
  world.mount(root);
  world.flush();
  return { world, root, colliders };
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const boxOf = (c: Collider): Box => ({ x: c.transform.x, y: c.transform.y, width: c.width, height: c.height });

describe("the World's collider queries", () => {
  it("answer what a scan of every collider answers, in the order the colliders joined, for boxes of every size", () => {
    const { world, root, colliders } = field();
    const space = world as unknown as BodySpace;
    const ignore = new Entity() as GameObject;
    for (const query of [{ x: 100, y: 100, width: 40, height: 40 }, { x: -50, y: -50, width: 800, height: 500 }, { x: 600, y: 300, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 }]) {
      const expected = colliders.filter((c) => c.tag === "enemy" && overlaps(query, boxOf(c)));
      assert.deepEqual(space.collidersIn(query, "enemy", ignore), expected, JSON.stringify(query));
      assert.equal(space.tagIn(query, "wall", ignore), colliders.some((c) => c.tag === "wall" && overlaps(query, boxOf(c))));
      const solid = colliders.find((c) => c.solid && overlaps(query, boxOf(c)));
      assert.equal(space.solidIn(query, ignore), solid?.tag ?? null);
    }
    assert.deepEqual(space.collidersIn({ x: 0, y: 0, width: 640, height: 360 }, "enemy", root), [], "a body ignores the colliders under it");
  });

  it("sees colliders where they are after a step: a moved one, a new one and a removed one", () => {
    const { world, root, colliders } = field();
    const space = world as unknown as BodySpace;
    const ignore = new Entity() as GameObject;
    const probe = { x: 1000, y: 1000, width: 10, height: 10 };
    assert.deepEqual(space.collidersIn(probe, "enemy", ignore), []);
    const moved = colliders[1]!;
    moved.transform.x = 1002;
    moved.transform.y = 1002;
    moved.markChanged();
    const added = new Collider({ width: 5, height: 5, tag: "enemy" });
    added.transform.x = 1004;
    added.transform.y = 1004;
    root.addChild(added);
    world.tick(1 / 60);
    assert.deepEqual(space.collidersIn(probe, "enemy", ignore), [moved, added]);
    root.removeChild(moved);
    world.tick(1 / 60);
    assert.deepEqual(space.collidersIn(probe, "enemy", ignore), [added]);
  });
});
