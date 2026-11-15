import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { TilemapData, TilemapObject } from "@tsengine/runtime";

import { tilemaps } from "../generated/tilemaps.ts";
import { TILE } from "../src/rules/constants.ts";
import { MAP_IDS, MAPS, readMap } from "../src/rules/maps.ts";

test("every map in scenes/ reads: its ground, and the things on it from the Things layer", () => {
  for (const id of MAP_IDS) {
    const data = tilemaps[id];
    assert.ok(data, `${id}.tmj is compiled`);
    assert.equal(data.tileWidth, TILE);
    assert.equal(MAPS[id].rows.length, data.height);
    assert.equal(MAPS[id].rows[0]!.length, data.width);
    // Walls and water are solid in the tileset; bushes are the rules' (they can be cut), and come from objects.
    const ground = data.layers.find((l) => l.name === "Ground")!;
    const solid = new Set(data.solid);
    MAPS[id].rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++)
        assert.equal(solid.has(ground.data[r * data.width + c] ?? 0), row[c] === "#" || row[c] === "~", `${id} ${c},${r}`);
    });
  }
  assert.equal(MAPS.overworld.name, "The valley");
  assert.deepEqual(
    MAPS.overworld.doors.find((d) => d.id === "cave"),
    { id: "cave", col: 68, row: 44, to: { map: "cave", door: "cave-exit" }, out: [0, 1], needs: "lantern" }
  );
  assert.deepEqual(MAPS.maze.rows[3]!.slice(14, 16), "bb", "the two bushes in the maze");
});

test("a map saved with a mistake fails here, naming the map and the object", () => {
  const base = tilemaps.house!;
  const withObject = (o: Partial<TilemapObject>, extra: Partial<TilemapData> = {}): TilemapData => ({
    ...base,
    objects: [
      ...(base.objects ?? []),
      { id: 99, name: "x", type: "item", x: 32, y: 32, width: TILE, height: TILE, properties: { item: "key" }, ...o },
    ],
    ...extra,
  });
  assert.doesNotThrow(() => readMap("house", withObject({})));
  assert.throws(
    () => readMap("house", withObject({ type: "chest" })),
    /scenes\/house\.tmj: object 99 'x' \(chest\): the Class must be door, item/
  );
  assert.throws(
    () => readMap("house", withObject({ properties: { item: "sword" } })),
    /'item' is 'sword', not one of lantern, key, shears, bell/
  );
  assert.throws(() => readMap("house", withObject({ properties: {} })), /needs a string property 'item'/);
  assert.throws(() => readMap("house", withObject({ name: "shears" })), /another item on this map has the same name/);
  assert.throws(() => readMap("house", withObject({ x: -100 })), /is off the map/);
  assert.throws(
    () => readMap("house", withObject({ type: "door", properties: { to: "overworld/house", out: "north" } })),
    /'out' must be up, down, left or right/
  );
  assert.throws(() => readMap("house", withObject({ type: "npc", name: "stranger" })), /'name' is 'stranger', not one of guide/);
  assert.throws(() => readMap("house", { ...base, properties: {} }), /needs a map property 'name'/);
  assert.throws(() => readMap("house", { ...base, layers: [] }), /no tile layer named Ground/);
});

test("the tile sheet is as wide as the maps expect", () => {
  const png = readFileSync(new URL("../assets/tiles.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), TILE * 3);
  assert.equal(png.readUInt32BE(20), TILE);
  for (const id of MAP_IDS)
    assert.deepEqual(
      tilemaps[id]!.tilesets?.map((t) => [t.image, t.columns]),
      [["tiles.png", 3]],
      `${id} names the sheet in the assets folder`
    );
});
