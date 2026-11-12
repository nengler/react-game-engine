import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TILE } from "../src/rules/constants.ts";
import { MAP_IDS, MAPS } from "../src/rules/maps.ts";
import { tilemaps } from "../generated/tilemaps.ts";

test("the Tiled maps in scenes/ agree with the text maps in the rules (run `npm run maps` if not)", () => {
  for (const id of MAP_IDS) {
    const rows = MAPS[id].rows;
    const data = tilemaps[id];
    assert.ok(data, `${id}.tmj is compiled`);
    assert.equal(data.width, rows[0]!.length);
    assert.equal(data.height, rows.length);
    assert.equal(data.tileWidth, TILE);
    const ground = data.layers.find((l) => l.name === "Ground")!;
    const solid = new Set(data.solid);
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const gid: number = ground.data[r * data.width + c] ?? 0;
        // The map's own solid flag is walls and water; bushes are the rules' (they can be cut).
        assert.equal(solid.has(gid), row[c] === "#" || row[c] === "~", `${id} ${c},${r}`);
      }
    });
  }
});

test("the tile sheet is as wide as the maps expect", () => {
  const png = readFileSync(new URL("../assets/tiles.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), TILE * 3);
  assert.equal(png.readUInt32BE(20), TILE);
});
