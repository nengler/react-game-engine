import assert from "node:assert/strict";
/** A body's queries over many colliders go through a grid per tag, and answer exactly what a plain scan would, in the same order. */
import { describe, it } from "node:test";

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
    const c = new Collider({
      width: big ? 400 : 4 + next() * 20,
      height: big ? 300 : 4 + next() * 20,
      tag: i % 3 === 0 ? "wall" : "enemy",
      solid: i % 3 === 0,
    });
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
    for (const query of [
      { x: 100, y: 100, width: 40, height: 40 },
      { x: -50, y: -50, width: 800, height: 500 },
      { x: 600, y: 300, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 0 },
    ]) {
      const expected = colliders.filter((c) => c.tag === "enemy" && overlaps(query, boxOf(c)));
      assert.deepEqual(space.collidersIn(query, "enemy", ignore), expected, JSON.stringify(query));
      assert.equal(
        space.tagIn(query, "wall", ignore),
        colliders.some((c) => c.tag === "wall" && overlaps(query, boxOf(c)))
      );
      const solid = colliders.find((c) => c.solid && overlaps(query, boxOf(c)));
      assert.equal(space.solidIn(query, ignore), solid?.tag ?? null);
    }
    assert.deepEqual(
      space.collidersIn({ x: 0, y: 0, width: 640, height: 360 }, "enemy", root),
      [],
      "a body ignores the colliders under it"
    );
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

  /**
   * Fields that put the index's colliders on each of its structures: a crowd of small boxes (one dense grid), boxes of very different
   * sizes (a coarser grid for the large, and a last few on none), a few far apart (cells kept by key), a box that is not finite, and
   * boxes that only touch.
   */
  const fields: Record<string, (next: () => number, i: number) => Box> = {
    "a crowd of small boxes": (next, i) => ({
      x: 5000 + next() * 300,
      y: -3000 + next() * 300,
      width: 8 + (i % 3) * 3,
      height: 8 + (i % 4) * 2,
    }),
    "boxes of very different sizes": (next, i) => {
      const side = i % 40 === 0 ? 2000 : i % 5 === 0 ? 150 + next() * 200 : i % 3 === 0 ? 40 + next() * 30 : 4 + next() * 8;
      return { x: next() * 1500 - 200, y: next() * 900 - 200, width: side, height: i % 7 === 0 ? side * 3 : side };
    },
    "a few far apart": (next) => ({ x: (next() - 0.5) * 4e6, y: (next() - 0.5) * 4e6, width: 10, height: 10 }),
    "a box that is not finite among others": (next, i) => ({
      x: i === 5 ? Number.NEGATIVE_INFINITY : next() * 200,
      y: next() * 200,
      width: i === 9 ? Number.POSITIVE_INFINITY : 10,
      height: 10,
    }),
    "boxes on a lattice, touching": (_next, i) => ({ x: (i % 20) * 10, y: Math.floor(i / 20) * 10, width: 10, height: 10 }),
    "boxes with no size": (next) => ({ x: Math.floor(next() * 30), y: Math.floor(next() * 30), width: 0, height: 0 }),
  };

  for (const [name, make] of Object.entries(fields)) {
    it(`answers nearby and a body's queries as a scan does: ${name}`, () => {
      const world = new World();
      const root = new Entity();
      const colliders: Collider[] = [];
      const boxes: Box[] = [];
      let seed = 21;
      const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < 400; i++) {
        const box = make(next, i);
        const c = new Collider({ width: box.width, height: box.height, tag: "enemy", data: i });
        c.transform.x = box.x;
        c.transform.y = box.y;
        root.addChild(c);
        colliders.push(c);
        boxes.push(box);
      }
      world.mount(root);
      world.flush();
      const space = world as unknown as BodySpace;
      const ignore = new Entity() as GameObject;
      const near = (x: number, y: number, r: number): { id: number; distance: number }[] =>
        boxes
          .map((b, id) => {
            const dx = b.x > x ? b.x - x : x > b.x + b.width ? x - (b.x + b.width) : 0;
            const dy = b.y > y ? b.y - y : y > b.y + b.height ? y - (b.y + b.height) : 0;
            return { id, distance: Math.sqrt(dx * dx + dy * dy) };
          })
          .filter((e) => e.distance <= r)
          .sort((a, b) => a.distance - b.distance || a.id - b.id);
      // Points on and round the boxes (their corners and edges are where rounding would show), and a few anywhere.
      const points: [number, number][] = [];
      for (let i = 0; i < boxes.length; i += 7) {
        const b = boxes[i]!;
        if (!Number.isFinite(b.x + b.width)) continue;
        points.push([b.x, b.y], [b.x + b.width, b.y + b.height], [b.x + b.width / 2, b.y - 3], [b.x - 3, b.y - 4]);
      }
      for (let i = 0; i < 20; i++) points.push([(next() - 0.5) * 3000, (next() - 0.5) * 3000]);
      for (const [x, y] of points) {
        for (const r of [0, 3, 5, 40, 700, 1e7, Number.POSITIVE_INFINITY]) {
          const found = world.nearby("enemy", x, y, r);
          assert.deepEqual(
            found.map((f) => ({ id: f.data as number, distance: f.distance })),
            near(x, y, r),
            `nearby ${x},${y} r${r}`
          );
        }
        for (const side of [0, 1, 12, 300, 1e7]) {
          const query = { x: x - side / 2, y: y - side / 2, width: side, height: side };
          const expected = colliders.filter((_c, i) => overlaps(query, boxes[i]!));
          assert.deepEqual(space.collidersIn(query, "enemy", ignore), expected, `collidersIn ${JSON.stringify(query)}`);
        }
      }
      const found = world.nearby("enemy", boxes[0]!.x, boxes[0]!.y, 0)[0]!;
      assert.equal(found.x, boxes[0]!.x + boxes[0]!.width / 2, "a result is at its box's middle");
      assert.equal(found.owner, "Collider");
      assert.deepEqual(world.nearby("enemy", Number.NaN, 0, 5), []);
    });
  }
});
