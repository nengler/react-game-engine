/**
 * Writes `scenes/field.tmj` from the text drawing below, as a Tiled map: a tile layer `Tiles` (grass, path, the build pads) and a
 * hidden layer `Markers` (the spawn, the corners of the path in order, the hearth, and a marker on every pad). From then on the map
 * is what the game loads and what a person edits in Tiled; run this again only to start over from the drawing (`npm run hearth:map`).
 * `test/map.test.ts` checks the rules read what is drawn here.
 *
 *   .  grass     =  path     p  a build pad     S  where enemies come in     H  the hearth (the end)
 *   1-8  a corner of the path (a path tile too), in the order the enemies reach them
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_COLS, FIELD_ROWS, TILE } from "../src/rules/constants.ts";
import { MARK } from "../src/rules/path.ts";

export const DRAWING: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "S======1................",
  "...p...=......p.........",
  "......p=....6====7......",
  ".......=p...=..p.=......",
  "....p..=....=....=......",
  "..3====2....=....=......",
  "..=.p......p=p..p=p.....",
  "..=.........=....=......",
  "..=p........=....=......",
  "..=..p...p..=....=......",
  "..4=========5....=..p...",
  ".....p...p.......8=====H",
  "....................p...",
  "........................",
  "........................",
];

/** Global tile ids in `assets/tiles.png` (the sheet's frame number plus one). */
export const GID = { grass: 1, tuft: 2, path: 3, pad: 4 } as const;

const dir = join(dirname(fileURLToPath(import.meta.url)), "../scenes");

const tileset = { firstgid: 1, name: "tiles", image: "../assets/tiles.png", imagewidth: 80, imageheight: 40, tilewidth: TILE, tileheight: TILE, columns: 8, tilecount: 32, margin: 0, spacing: 0 };

export function buildMap(): unknown {
  if (DRAWING.length !== FIELD_ROWS || DRAWING.some((r) => r.length !== FIELD_COLS)) throw new Error(`The drawing must be ${FIELD_COLS} × ${FIELD_ROWS}.`);
  const tiles: number[] = [];
  const markers: number[] = [];
  for (let r = 0; r < FIELD_ROWS; r++) {
    for (let c = 0; c < FIELD_COLS; c++) {
      const ch = (DRAWING[r] as string)[c] as string;
      const onPath = ch === "=" || ch === "S" || ch === "H" || /[1-8]/.test(ch);
      const tuft = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 9 === 0;
      tiles.push(onPath ? GID.path : ch === "p" ? GID.pad : tuft ? GID.tuft : GID.grass);
      markers.push(ch === "S" ? MARK.spawn : ch === "H" ? MARK.hearth : ch === "p" ? MARK.pad : /[1-8]/.test(ch) ? MARK.waypoint + Number(ch) - 1 : 0);
    }
  }
  return {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down", infinite: false,
    width: FIELD_COLS, height: FIELD_ROWS, tilewidth: TILE, tileheight: TILE, nextlayerid: 3, nextobjectid: 1,
    properties: [{ name: "name", type: "string", value: "The hearth road" }],
    tilesets: [tileset],
    layers: [
      { id: 1, name: "Tiles", type: "tilelayer", visible: true, opacity: 1, x: 0, y: 0, width: FIELD_COLS, height: FIELD_ROWS, data: tiles },
      { id: 2, name: "Markers", type: "tilelayer", visible: false, opacity: 1, x: 0, y: 0, width: FIELD_COLS, height: FIELD_ROWS, data: markers },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "field.tmj"), `${JSON.stringify(buildMap())}\n`);
  console.log(`wrote ${join(dir, "field.tmj")}`);
}
