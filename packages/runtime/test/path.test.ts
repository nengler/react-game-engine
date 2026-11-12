import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findPath, lineOfSight, TileGrid } from "../src/index.ts";

/** A grid from rows of text: `#` is solid. */
function grid(rows: string[]) {
  return { width: rows[0]!.length, height: rows.length, tileWidth: 10, tileHeight: 10, solidAt: (c: number, r: number) => rows[r]?.[c] === "#" };
}
const cells = (path: { x: number; y: number }[] | null) => path?.map((c) => `${c.x},${c.y}`);

describe("findPath", () => {
  it("finds a shortest path along open cells, excluding the start and including the goal", () => {
    const g = grid(["....", "....", "...."]);
    const path = findPath(g, { x: 0, y: 0 }, { x: 3, y: 2 })!;
    assert.equal(path.length, 5, "5 steps: the Manhattan distance");
    assert.deepEqual(path.at(-1), { x: 3, y: 2 });
    let at = { x: 0, y: 0 };
    for (const c of path) {
      assert.equal(Math.abs(c.x - at.x) + Math.abs(c.y - at.y), 1, "each step is to a neighbour");
      at = c;
    }
  });

  it("goes round walls", () => {
    const g = grid([".#.", ".#.", "..."]);
    assert.deepEqual(cells(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 })), ["0,1", "0,2", "1,2", "2,2", "2,1", "2,0"]);
  });

  it("is empty for the same cell and null for no way, a blocked end, or an end outside", () => {
    const g = grid([".#.", ".#.", ".#."]);
    assert.deepEqual(findPath(g, { x: 0, y: 0 }, { x: 0, y: 0 }), []);
    assert.equal(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 }), null, "walled off");
    assert.equal(findPath(g, { x: 0, y: 0 }, { x: 1, y: 0 }), null, "the goal is solid");
    assert.equal(findPath(g, { x: 1, y: 1 }, { x: 0, y: 0 }), null, "the start is solid");
    assert.equal(findPath(g, { x: 0, y: 0 }, { x: 5, y: 5 }), null, "outside");
  });

  it("takes diagonals when allowed, but never cuts a solid corner", () => {
    const open = grid(["...", "...", "..."]);
    assert.equal(findPath(open, { x: 0, y: 0 }, { x: 2, y: 2 }, { diagonal: true })!.length, 2);
    const corner = grid([".#", "#."]);
    assert.equal(findPath(corner, { x: 0, y: 0 }, { x: 1, y: 1 }, { diagonal: true }), null, "both neighbours are solid: no squeezing between");
    const one = grid([".#.", "...", "..."]);
    const path = findPath(one, { x: 0, y: 0 }, { x: 2, y: 0 }, { diagonal: true })!;
    for (let i = 0; i < path.length; i++) {
      const from = i === 0 ? { x: 0, y: 0 } : path[i - 1]!;
      const to = path[i]!;
      if (from.x !== to.x && from.y !== to.y) assert.ok(!one.solidAt(from.x, to.y) && !one.solidAt(to.x, from.y), "no corner cut");
    }
  });

  it("uses options.blocked in place of the grid's own solid cells", () => {
    const g = grid(["...", "...", "..."]);
    const path = findPath(g, { x: 0, y: 1 }, { x: 2, y: 1 }, { blocked: (x, y) => x === 1 && y !== 0 })!;
    assert.deepEqual(cells(path), ["0,0", "1,0", "2,0", "2,1"]);
  });

  it("gives the same path every time, however the ties fall", () => {
    const g = grid(Array.from({ length: 12 }, () => ".".repeat(12)));
    const first = JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 11, y: 11 }));
    for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 11, y: 11 })), first);
    assert.equal(JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 11, y: 11 }, { diagonal: true })), JSON.stringify(findPath(g, { x: 0, y: 0 }, { x: 11, y: 11 }, { diagonal: true })));
  });

  it("gives up after maxNodes", () => {
    const g = grid(Array.from({ length: 30 }, () => ".".repeat(30)));
    assert.equal(findPath(g, { x: 0, y: 0 }, { x: 29, y: 29 }, { maxNodes: 10 }), null);
    assert.ok(findPath(g, { x: 0, y: 0 }, { x: 29, y: 29 }) !== null);
  });

  it("works on a TileGrid", () => {
    const tiles = new TileGrid({ width: 3, height: 1, tileWidth: 8, tileHeight: 8, firstGid: 1, solid: [2], layers: [{ name: "a", visible: true, data: [1, 2, 1] }] });
    assert.equal(findPath(tiles, { x: 0, y: 0 }, { x: 2, y: 0 }), null);
  });
});

describe("lineOfSight", () => {
  const g = grid(["......", ".####.", "......"]);
  it("sees along open rows and across open corners, and is stopped by a wall in between", () => {
    assert.equal(lineOfSight(g, { x: 5, y: 5 }, { x: 55, y: 5 }), true);
    assert.equal(lineOfSight(g, { x: 5, y: 5 }, { x: 55, y: 25 }), false, "through the wall");
    assert.equal(lineOfSight(g, { x: 5, y: 15 }, { x: 55, y: 15 }), false);
    assert.equal(lineOfSight(g, { x: 5, y: 5 }, { x: 5, y: 25 }), true, "down the open column");
  });

  it("is symmetric and false from or to a solid cell", () => {
    for (const [a, b] of [[{ x: 5, y: 5 }, { x: 55, y: 25 }], [{ x: 5, y: 5 }, { x: 25, y: 25 }], [{ x: 3, y: 27 }, { x: 57, y: 3 }]] as const) {
      assert.equal(lineOfSight(g, a, b), lineOfSight(g, b, a));
    }
    assert.equal(lineOfSight(g, { x: 25, y: 15 }, { x: 5, y: 5 }), false);
  });

  it("does not slip through a diagonal gap between two solid corners", () => {
    const d = grid([".#", "#."]);
    assert.equal(lineOfSight(d, { x: 5, y: 5 }, { x: 15, y: 15 }), false);
  });
});
