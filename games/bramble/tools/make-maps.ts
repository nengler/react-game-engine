/**
 * Writes `scenes/<map>.tmj` from the text maps in `src/rules/maps.ts`, as Tiled maps with one tile layer, `Ground` (floor, wall,
 * water), and the tileset embedded with its wall and water tiles marked `solid`. The things on the map (people, doors, items) are
 * the rules' data, drawn on top. Run it with `npm run maps`. Until the world is drawn in Tiled (plan milestone M6), the text is the
 * source and these files are made from it; `test/maps.test.ts` checks that they agree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TILE } from "../src/rules/constants.ts";
import { MAP_IDS, MAPS } from "../src/rules/maps.ts";

/** Global tile ids in `assets/tiles.png`: the sheet's frame number plus one. */
export const GID: Readonly<Record<string, number>> = { ".": 1, b: 1, "#": 2, "~": 3 };

const dir = join(dirname(fileURLToPath(import.meta.url)), "../scenes");
mkdirSync(dir, { recursive: true });

const tileset = {
  firstgid: 1,
  name: "tiles",
  image: "tiles.png",
  imagewidth: TILE * 3,
  imageheight: TILE,
  tilewidth: TILE,
  tileheight: TILE,
  columns: 3,
  tilecount: 3,
  margin: 0,
  spacing: 0,
  tiles: [
    { id: 1, properties: [{ name: "solid", type: "bool", value: true }] },
    { id: 2, properties: [{ name: "solid", type: "bool", value: true }] },
  ],
};

for (const id of MAP_IDS) {
  const rows = MAPS[id].rows;
  const height = rows.length;
  const width = rows[0]!.length;
  const data = rows.flatMap((row) => [...row].map((ch) => GID[ch] ?? 1));
  const map = {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width,
    height,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 2,
    nextobjectid: 1,
    properties: [{ name: "name", type: "string", value: MAPS[id].name }],
    tilesets: [tileset],
    layers: [{ id: 1, name: "Ground", type: "tilelayer", visible: true, opacity: 1, x: 0, y: 0, width, height, data }],
  };
  writeFileSync(join(dir, `${id}.tmj`), `${JSON.stringify(map)}\n`);
}
console.log(`wrote ${MAP_IDS.length} maps to ${dir}`);
