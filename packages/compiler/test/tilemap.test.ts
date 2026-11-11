/** Tiled tile layers → `<Tilemap>` data, and the importer's `visible` handling for objects. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { importTiled, importTilemap, tilemapsSource } from "../src/index.ts";

const H = 0x80000000;
const V = 0x40000000;
const D = 0x20000000;

const map = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "map",
    width: 3,
    height: 2,
    tilewidth: 10,
    tileheight: 10,
    tilesets: [{ firstgid: 1, tiles: [{ id: 1, properties: [{ name: "solid", type: "bool", value: true }] }, { id: 2, properties: [{ name: "other", type: "bool", value: true }] }] }],
    layers: [
      { type: "tilelayer", name: "Tiles", width: 3, height: 2, data: [1, 2, 0, 3, 2 + H, 2 + (V | D)] },
      { type: "tilelayer", name: "Hidden", visible: false, width: 3, height: 2, data: [1, 1, 1, 1, 1, 1] },
      { type: "group", name: "Deco", visible: false, layers: [{ type: "tilelayer", name: "InGroup", width: 3, height: 2, data: [0, 0, 0, 0, 0, 1] }] },
    ],
    ...overrides,
  });

describe("importTilemap", () => {
  it("reads the tile layers: ids with the flip bits split off, visibility, and the solid tiles of the tileset", () => {
    const { tilemap, diagnostics } = importTilemap("room.tmj", map());
    assert.deepEqual(diagnostics, []);
    assert.ok(tilemap);
    assert.deepEqual([tilemap.width, tilemap.height, tilemap.tileWidth, tilemap.tileHeight, tilemap.firstGid], [3, 2, 10, 10, 1]);
    assert.deepEqual(tilemap.solid, [2], "tile id 1 of the tileset with firstgid 1 is global tile 2; `other` is not `solid`");
    assert.deepEqual(tilemap.layers.map((l) => [l.name, l.visible]), [["Tiles", true], ["Hidden", false], ["InGroup", false]], "a layer in a hidden group is hidden");
    const tiles = tilemap.layers[0]!;
    assert.deepEqual(tiles.data, [1, 2, 0, 3, 2, 2]);
    assert.deepEqual(tiles.flips, [0, 0, 0, 0, 1, 6], "horizontal is 1, vertical 2, diagonal 4");
    assert.equal(tilemap.layers[1]!.flips, undefined, "no flips, no array");
  });

  it("is null for a map with no tile data, as an objects-only map has", () => {
    const empty = importTilemap("o.tmj", JSON.stringify({ width: 4, height: 4, tilewidth: 8, tileheight: 8, layers: [{ type: "tilelayer", name: "Ground", data: [] }, { type: "objectgroup", name: "Things", objects: [] }] }));
    assert.equal(empty.tilemap, null);
    assert.deepEqual(empty.diagnostics, []);
  });

  it("says plainly what it cannot read, instead of drawing garbage", () => {
    const base64 = importTilemap("a.tmj", map({ layers: [{ type: "tilelayer", name: "T", encoding: "base64", data: "AAAA" }] }));
    assert.equal(base64.tilemap, null);
    assert.match(base64.diagnostics[0]!.message, /Tile Layer Format to CSV/);
    const wrongSize = importTilemap("a.tmj", map({ layers: [{ type: "tilelayer", name: "T", data: [1, 2, 3] }] }));
    assert.match(wrongSize.diagnostics[0]!.message, /has 3 cells, but the map is 3 × 2 = 6/);
    const infinite = importTilemap("a.tmj", map({ infinite: true }));
    assert.match(infinite.diagnostics[0]!.message, /infinite/);
    const two = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1 }, { firstgid: 50 }] }));
    assert.ok(two.tilemap);
    assert.match(two.diagnostics[0]!.message, /2 tilesets: only the first is used/);
    const external = importTilemap("a.tmj", map({ tilesets: [{ firstgid: 1, source: "tiles.tsx" }] }));
    assert.match(external.diagnostics[0]!.message, /external/);
    assert.equal(importTilemap("a.tmj", "{").tilemap, null, "bad JSON is the scene importer's to report");
  });

  it("writes tilemaps.ts as a table of data, and the CLI writes it next to the generated components", () => {
    const { tilemap } = importTilemap("room.tmj", map());
    const source = tilemapsSource(new Map([["room", tilemap!]]), "scenes");
    assert.match(source, /export const tilemaps: Record<string, TilemapData> = \{\n  "room": \{/);
    assert.match(source, /flips: \[0,0,0,0,1,6\]/);
    const dir = mkdtempSync(join(tmpdir(), "rge-tilemap-"));
    try {
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "scenes"));
      writeFileSync(join(dir, "src/A.tsx"), `import { Entity } from "@rge/runtime/jsx";\nexport function A() { return <Entity name="A" />; }\n`);
      writeFileSync(join(dir, "scenes/room.tmj"), map());
      const repo = resolve(import.meta.dirname, "../../..");
      execFileSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out"), "--scenes", join(dir, "scenes"), "--no-check"], { cwd: repo, stdio: "pipe" });
      assert.match(readFileSync(join(dir, "out/tilemaps.ts"), "utf8"), /"room": \{/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("importTiled: hidden layers and objects", () => {
  const objects = (extra: Record<string, unknown>[]): string =>
    JSON.stringify({ layers: [{ type: "objectgroup", name: "Things", objects: extra }] });

  it("skips an object that is hidden in Tiled, and everything in a hidden layer or group", () => {
    const shown = { id: 1, class: "Coin", x: 1, y: 2, visible: true };
    const hidden = { id: 2, class: "Coin", x: 3, y: 4, visible: false };
    const result = importTiled("m.tmj", objects([shown, hidden]));
    assert.deepEqual(result.scene.entities.map((e) => e.id), ["Things/1"]);
    const layer = importTiled("m.tmj", JSON.stringify({ layers: [{ type: "objectgroup", name: "Off", visible: false, objects: [shown] }] }));
    assert.deepEqual(layer.scene.entities, []);
    const group = importTiled("m.tmj", JSON.stringify({ layers: [{ type: "group", name: "G", visible: false, layers: [{ type: "objectgroup", name: "In", objects: [shown] }] }] }));
    assert.deepEqual(group.scene.entities, []);
  });

  it("treats a tile object with flip bits in its gid like any other: the flags do not move its anchor", () => {
    const plain = importTiled("m.tmj", objects([{ id: 1, class: "Coin", gid: 5, x: 10, y: 20, height: 16, width: 16 }]));
    const flipped = importTiled("m.tmj", objects([{ id: 1, class: "Coin", gid: 5 + H + D, x: 10, y: 20, height: 16, width: 16 }]));
    assert.deepEqual(flipped.scene.entities[0]!.transform, plain.scene.entities[0]!.transform);
  });
});
