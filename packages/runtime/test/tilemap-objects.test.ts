import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TileGrid, type TilemapData } from "../src/index.ts";

describe("TileGrid.objects", () => {
  const data: TilemapData = {
    width: 1, height: 1, tileWidth: 8, tileHeight: 8, firstGid: 1, solid: [], layers: [],
    objects: [
      { id: 1, name: "a", type: "door", x: 0, y: 0, width: 8, height: 8, properties: { to: "x" } },
      { id: 2, name: "b", type: "npc", x: 8, y: 0, width: 8, height: 8, properties: {} },
    ],
  };
  it("lists all objects, or those of one type, in file order", () => {
    const grid = new TileGrid(data);
    assert.deepEqual(grid.objects().map((o) => o.name), ["a", "b"]);
    assert.deepEqual(grid.objects("npc").map((o) => o.name), ["b"]);
    assert.deepEqual(grid.objects("none"), []);
  });
  it("is empty for a map without objects", () => {
    assert.deepEqual(new TileGrid({ ...data, objects: undefined }).objects(), []);
  });
});
