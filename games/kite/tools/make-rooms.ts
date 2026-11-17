/**
 * Writes `scenes/room1.tmj` … from the first drafts in `tools/rooms.ts`, as Tiled maps: a tile layer `Tiles` (stone, spikes) and
 * a hidden layer `Markers` (the start, the exits), with the tileset embedded and its stone tiles marked `solid`. From then on the
 * maps are what the game loads and what a person edits in Tiled; run this again only to start a room over from its draft
 * (`npm run kite:rooms`). `test/rooms.test.ts` checks that the maps and the drafts still agree.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ROOM_COLS, ROOM_ROWS, TILE } from "../src/rules/constants.ts";
import { ROOM_SPECS } from "./rooms.ts";

/** Global tile ids in the sheet (the sheet's frame number plus one). */
export const GID = { stone: 1, surface: 2, spikeUp: 3, spikeDown: 4, spikeLeft: 5, spikeRight: 6, exit: 7, start: 8, end: 9 } as const;

const dir = join(dirname(fileURLToPath(import.meta.url)), "../scenes");
mkdirSync(dir, { recursive: true });

const tileset = {
  firstgid: 1,
  name: "tiles",
  image: "../assets/tiles.png",
  imagewidth: 80,
  imageheight: 20,
  tilewidth: TILE,
  tileheight: TILE,
  columns: 8,
  tilecount: 16,
  margin: 0,
  spacing: 0,
  tiles: [
    { id: GID.stone - 1, properties: [{ name: "solid", type: "bool", value: true }] },
    { id: GID.surface - 1, properties: [{ name: "solid", type: "bool", value: true }] },
  ],
};

ROOM_SPECS.forEach((spec, index) => {
  const tilesData: number[] = [];
  const markers: number[] = [];
  const at = (c: number, r: number): string => (c < 0 || c >= ROOM_COLS || r < 0 || r >= ROOM_ROWS ? "." : (spec.rows[r] as string)[c]!);
  for (let r = 0; r < ROOM_ROWS; r++) {
    for (let c = 0; c < ROOM_COLS; c++) {
      const ch = at(c, r);
      tilesData.push(
        ch === "#"
          ? at(c, r - 1) === "#"
            ? GID.stone
            : GID.surface
          : ch === "^"
            ? GID.spikeUp
            : ch === "v"
              ? GID.spikeDown
              : ch === "<"
                ? GID.spikeLeft
                : ch === ">"
                  ? GID.spikeRight
                  : 0
      );
      markers.push(ch === "E" ? (spec.exit === "end" ? GID.end : GID.exit) : ch === "@" ? GID.start : 0);
    }
  }
  const map = {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: ROOM_COLS,
    height: ROOM_ROWS,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 3,
    nextobjectid: 1,
    properties: [
      { name: "name", type: "string", value: spec.name },
      { name: "exit", type: "string", value: spec.exit },
    ],
    tilesets: [tileset],
    layers: [
      {
        id: 1,
        name: "Tiles",
        type: "tilelayer",
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: ROOM_COLS,
        height: ROOM_ROWS,
        data: tilesData,
      },
      {
        id: 2,
        name: "Markers",
        type: "tilelayer",
        visible: false,
        opacity: 1,
        x: 0,
        y: 0,
        width: ROOM_COLS,
        height: ROOM_ROWS,
        data: markers,
      },
    ],
  };
  writeFileSync(join(dir, `room${index + 1}.tmj`), `${JSON.stringify(map)}\n`);
});
console.log(`wrote ${ROOM_SPECS.length} rooms to ${dir}`);
