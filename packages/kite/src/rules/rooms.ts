import { getTilemap, registerTilemaps, type TileGrid } from "@rge/runtime";

import { tilemaps } from "../../generated/tilemaps.ts";
import { heightOf } from "./body/step.ts";
import type { Body } from "./body/types.ts";
import { BODY_H, BODY_W, ROOM_COLS, ROOM_H, ROOM_ROWS, ROOM_W, TILE, VOID_MARGIN } from "./constants.ts";

/**
 * The level's rooms, read from the Tiled maps in `scenes/` (through the compiler's generated `tilemaps.ts`, the same data the
 * `<Tilemap>`s draw). A room is 32 × 18 tiles of 10 pixels: one screen. The tile layer `Tiles` holds stone (solid) and spikes;
 * the hidden layer `Markers` holds the start of the room and its exit. The rules read a room as characters, so a room is still
 * easy to read in a test: `#` solid, `^ v < >` spikes, `@` the start, `E` an exit.
 */

registerTilemaps(tilemaps);

/** Where a room's exit leads: the next room is laid out to the right of it, above it, or there is none (the end of the level). */
export type ExitSide = "right" | "up" | "end";

/** The global tile ids of `assets/tiles.png`, as `tools/make-rooms.ts` writes them. */
const GID_STONE = 1;
const GID_SURFACE = 2;
const GID_SPIKE_UP = 3;
const GID_SPIKE_DOWN = 4;
const GID_SPIKE_LEFT = 5;
const GID_SPIKE_RIGHT = 6;
const GID_EXIT = 7;
const GID_START = 8;
const GID_END = 9;

/** What each room is called, for the screen. */
export const ROOM_NAMES: readonly string[] = [
  "First steps",
  "Stepping stones",
  "Dash across",
  "Dash up",
  "The shaft",
  "Spikes on the wall",
  "Gem ledge",
  "Summit",
];

/** One room, with the world position it sits at. */
export interface Room {
  readonly index: number;
  /** The tilemap's name: `room1`, `room2`, … */
  readonly map: string;
  readonly name: string;
  readonly exit: ExitSide;
  /** The room as text, one string per row (see above). */
  readonly rows: readonly string[];
  /** Where the room's top left is in the world: rooms are laid out so each exit meets the next room. */
  readonly ox: number;
  readonly oy: number;
  /** The spawn, as a body position: the hitbox's top left, standing on the tile below the marker. */
  readonly spawnX: number;
  readonly spawnY: number;
  /** Whether the pixel at (x, y), in the room, is solid: the tilemap's own solid grid, what the `<Tilemap>` draws. */
  readonly solidAt: (x: number, y: number) => boolean;
}

function charAt(grid: TileGrid, col: number, row: number): string {
  const marker = grid.tileAt("Markers", col, row);
  if (marker === GID_EXIT || marker === GID_END) return "E";
  if (marker === GID_START) return "@";
  switch (grid.tileAt("Tiles", col, row)) {
    case GID_STONE:
    case GID_SURFACE:
      return "#";
    case GID_SPIKE_UP:
      return "^";
    case GID_SPIKE_DOWN:
      return "v";
    case GID_SPIKE_LEFT:
      return "<";
    case GID_SPIKE_RIGHT:
      return ">";
    default:
      return ".";
  }
}

function roomFrom(index: number, ox: number, oy: number): Room {
  const map = `room${index + 1}`;
  const grid = getTilemap(map);
  if (grid.width !== ROOM_COLS || grid.height !== ROOM_ROWS || grid.tileWidth !== TILE)
    throw new Error(`${map}.tmj must be ${ROOM_COLS} × ${ROOM_ROWS} tiles of ${TILE} pixels.`);
  const rows: string[] = [];
  for (let r = 0; r < ROOM_ROWS; r++) {
    let row = "";
    for (let c = 0; c < ROOM_COLS; c++) row += charAt(grid, c, r);
    rows.push(row);
  }
  const start = grid.find("Markers", GID_START)[0];
  if (start === undefined) throw new Error(`${map}.tmj has no start marker (tile ${GID_START} on the Markers layer).`);
  const ends = grid.find("Markers", GID_END).length > 0;
  const exits = grid.find("Markers", GID_EXIT);
  if (!ends && exits.length === 0) throw new Error(`${map}.tmj has no exit marker (tile ${GID_EXIT} or ${GID_END} on the Markers layer).`);
  const exit: ExitSide = ends ? "end" : exits.every(([c]) => c === ROOM_COLS - 1) ? "right" : "up";
  return {
    index,
    map,
    name: ROOM_NAMES[index] ?? map,
    exit,
    rows,
    ox,
    oy,
    spawnX: start[0] * TILE + ((TILE - BODY_W) >> 1),
    spawnY: (start[1] + 1) * TILE - BODY_H,
    solidAt: (x, y) => grid.solidAtPixel(x, y),
  };
}

/** How many rooms there are: `room1`, `room2`, … until a map is missing. */
function countRooms(): number {
  let n = 0;
  while (Object.hasOwn(tilemaps, `room${n + 1}`)) n++;
  return n;
}

function layOut(): Room[] {
  const rooms: Room[] = [];
  let ox = 0;
  let oy = 0;
  for (let i = 0, n = countRooms(); i < n; i++) {
    const room = roomFrom(i, ox, oy);
    rooms.push(room);
    if (room.exit === "right") ox += ROOM_W;
    else if (room.exit === "up") oy -= ROOM_H;
  }
  return rooms;
}

export const ROOM_LIST: readonly Room[] = layOut();

/** The part of a spike tile that hurts, as a rectangle in the room's pixels, or null for any other tile. Spikes are half a tile deep. */
export function hazardRect(ch: string, col: number, row: number): { x: number; y: number; w: number; h: number } | null {
  const x = col * TILE;
  const y = row * TILE;
  const half = TILE / 2;
  switch (ch) {
    case "^":
      return { x, y: y + half, w: TILE, h: half };
    case "v":
      return { x, y, w: TILE, h: half };
    case "<":
      return { x: x + half, y, w: half, h: TILE };
    case ">":
      return { x, y, w: half, h: TILE };
    default:
      return null;
  }
}

/** Does a hitbox `h` tall (standing, by default) at (x, y) overlap a rectangle? */
export function overlapsRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }, h: number = BODY_H): boolean {
  return x < rect.x + rect.w && x + BODY_W > rect.x && y < rect.y + rect.h && y + h > rect.y;
}

/** The tile character at a cell, `"."` outside the room. */
function tileAt(room: Room, col: number, row: number): string {
  return col < 0 || col >= ROOM_COLS || row < 0 || row >= ROOM_ROWS ? "." : (room.rows[row] as string)[col]!;
}

/** Does the body's hitbox touch a tile for which `want` holds? */
function touching(room: Room, b: Body, want: (ch: string, col: number, row: number) => boolean): boolean {
  const h = heightOf(b);
  const c1 = Math.floor((b.x + BODY_W - 1) / TILE);
  const r1 = Math.floor((b.y + h - 1) / TILE);
  for (let r = Math.floor(b.y / TILE); r <= r1; r++)
    for (let c = Math.floor(b.x / TILE); c <= c1; c++) if (want(tileAt(room, c, r), c, r)) return true;
  return false;
}

/** Is the body on spikes? */
export function onSpikes(room: Room, b: Body): boolean {
  return touching(room, b, (ch, c, r) => {
    const rect = hazardRect(ch, c, r);
    return rect !== null && overlapsRect(b.x, b.y, rect, heightOf(b));
  });
}

/** Is the body in the room's exit? */
export function inExit(room: Room, b: Body): boolean {
  return touching(room, b, (ch) => ch === "E");
}

/** Out of the room by more than the margin, below it or past its sides (above it is fine: that is how a room is left). */
export function outOfBounds(b: Body): boolean {
  return b.y > ROOM_H + VOID_MARGIN || b.x < -VOID_MARGIN || b.x > ROOM_W + VOID_MARGIN;
}

/** Every tile in the room with the given character, as `[col, row]`. */
export function tilesOf(room: Room, ch: string): [number, number][] {
  const found: [number, number][] = [];
  for (let r = 0; r < ROOM_ROWS; r++) for (let c = 0; c < ROOM_COLS; c++) if ((room.rows[r] as string)[c] === ch) found.push([c, r]);
  return found;
}

/** The gem, off the main path of room 7: its box in the room's own pixels, and where that is in the world. */
export const GEM = { room: 6, x: 262, y: 30, w: 8, h: 8 };
export const GEM_AT = { x: (ROOM_LIST[GEM.room]?.ox ?? 0) + GEM.x, y: (ROOM_LIST[GEM.room]?.oy ?? 0) + GEM.y };
