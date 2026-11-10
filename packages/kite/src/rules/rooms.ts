import { BODY_H, BODY_W, ROOM_COLS, ROOM_H, ROOM_ROWS, ROOM_W, TILE } from "./constants.ts";

/**
 * The level's rooms, as text: `ROOM_ROWS` rows of `ROOM_COLS` characters each.
 *
 *     #  a solid tile            ^ v < >  spikes, on the floor, the ceiling, a left-facing and a right-facing wall
 *     .  nothing                 @  where the character starts the room (and returns to after a death)
 *     E  the exit: touching it moves on to the next room       o  the optional gem
 *
 * These strings are the first draft of every room; `tools/make-rooms.ts` turns them into Tiled maps (`scenes/`), which
 * are what the game loads and what a person edits from then on. The rules read the map through `RoomGrid`.
 */

/** Where a room's exit leads: the next room is laid out to the right of it, above it, or there is none (the end of the level). */
export type ExitSide = "right" | "up" | "end";

export interface RoomSpec {
  readonly name: string;
  readonly exit: ExitSide;
  readonly rows: readonly string[];
}

function grid(): string[][] {
  return Array.from({ length: ROOM_ROWS }, () => Array.from({ length: ROOM_COLS }, () => "."));
}

/** Draws a room: a frame of walls, then what each call adds. Rectangles are in tiles and include both corners. */
class Draft {
  readonly #cells = grid();
  rect(c0: number, r0: number, c1: number, r1: number, ch: string): this {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.#cells[r]![c] = ch;
    return this;
  }
  set(c: number, r: number, ch: string): this {
    this.#cells[r]![c] = ch;
    return this;
  }
  /** The walls, ceiling and floor of a room, with the floor `floor` rows thick. */
  frame(floor = 3): this {
    return this.rect(0, 0, ROOM_COLS - 1, 0, "#").rect(0, 0, 0, ROOM_ROWS - 1, "#").rect(ROOM_COLS - 1, 0, ROOM_COLS - 1, ROOM_ROWS - 1, "#").rect(0, ROOM_ROWS - floor, ROOM_COLS - 1, ROOM_ROWS - 1, "#");
  }
  rows(): string[] {
    return this.#cells.map((row) => row.join(""));
  }
}

const draft = (): Draft => new Draft().frame();

/** Standing on the tile (col, row): the spawn marker goes in the cell above the floor. */
const ROOMS: readonly RoomSpec[] = [
  {
    // 1. Run and jump: a step, then a gap of four tiles with spikes in it.
    name: "First steps",
    exit: "right",
    rows: draft()
      .rect(11, 14, 13, 14, "#")
      .rect(20, 15, 23, 17, ".")
      .rect(20, 17, 23, 17, "^")
      .rect(31, 11, 31, 14, "E")
      .set(2, 14, "@")
      .rows(),
  },
  {
    // 2. Stairs up over spikes: jumps of two tiles, held for height. Entered at the left, rows 11 to 14.
    name: "Stepping stones",
    exit: "right",
    rows: draft()
      .rect(1, 15, 30, 17, ".")
      .rect(1, 17, 30, 17, "^")
      .rect(0, 15, 3, 17, "#")
      .rect(6, 13, 9, 13, "#")
      .rect(13, 11, 16, 11, "#")
      .rect(20, 9, 23, 9, "#")
      .rect(27, 11, 30, 11, "#")
      .rect(0, 11, 0, 14, ".")
      .rect(31, 8, 31, 10, "E")
      .set(2, 14, "@")
      .rows(),
  },
  {
    // 3. The dash: a gap of eight tiles, too wide to jump (a jump clears about six and a half).
    name: "Dash across",
    exit: "right",
    rows: draft()
      .rect(9, 15, 16, 17, ".")
      .rect(9, 17, 16, 17, "^")
      .rect(0, 8, 0, 10, ".")
      .rect(31, 11, 31, 14, "E")
      .set(2, 14, "@")
      .rows(),
  },
  {
    // 4. Dash up: a ledge too high to jump to, and an opening in the ceiling above it.
    name: "Dash up",
    exit: "up",
    rows: draft()
      .rect(10, 9, 22, 9, "#")
      .rect(13, 0, 18, 0, ".")
      .rect(14, 0, 17, 2, "E")
      .rect(0, 11, 0, 14, ".")
      .set(2, 14, "@")
      .rows(),
  },
  {
    // 5. Walls: a shaft, entered from below (the room below ends where the floor is), to climb by jumping from one wall to the other.
    name: "The shaft",
    exit: "up",
    rows: draft()
      .rect(1, 0, 12, 17, "#")
      .rect(19, 0, 30, 17, "#")
      .rect(14, 0, 17, 2, "E")
      .rect(13, 15, 18, 15, ".")
      .set(15, 15, "@")
      .rows(),
  },
  {
    // 6. Walls and spikes: a wider shaft with spikes on both walls, then out along the top.
    name: "Spikes on the wall",
    exit: "right",
    rows: draft()
      .rect(1, 0, 11, 17, "#")
      .rect(20, 4, 30, 17, "#")
      .rect(19, 4, 19, 8, "<")
      .rect(12, 10, 12, 13, ">")
      .rect(31, 1, 31, 3, "E")
      .rect(12, 15, 19, 15, ".")
      .set(15, 15, "@")
      .rows(),
  },
  {
    // 7. Everything together: a pillar in a spiked gap, and the gem off to the side.
    name: "Gem ledge",
    exit: "right",
    rows: draft()
      .rect(8, 15, 23, 17, ".")
      .rect(8, 17, 23, 17, "^")
      .rect(14, 8, 15, 16, "#")
      .rect(0, 1, 0, 3, ".")
      .rect(31, 11, 31, 14, "E")
      .set(2, 14, "@")
      .rows(),
  },
  {
    // 8. The last climb: stepping stones over spikes, a dash across, up the wall, and the summit.
    name: "Summit",
    exit: "end",
    rows: draft()
      .rect(6, 15, 31, 17, ".")
      .rect(6, 17, 31, 17, "^")
      .rect(9, 13, 12, 13, "#")
      .rect(17, 10, 20, 10, "#")
      .rect(24, 4, 25, 16, "#")
      .rect(26, 3, 30, 3, "#")
      .rect(27, 0, 30, 2, "E")
      .rect(0, 11, 0, 14, ".")
      .set(2, 14, "@")
      .rows(),
  },
];

/** One room, with the world position it sits at. */
export interface Room {
  readonly index: number;
  readonly name: string;
  readonly exit: ExitSide;
  readonly rows: readonly string[];
  /** Where the room's top left is in the world: rooms are laid out so each exit meets the next room. */
  readonly ox: number;
  readonly oy: number;
  /** The spawn, as a body position: the hitbox's top left, standing on the tile below the marker. */
  readonly spawnX: number;
  readonly spawnY: number;
}

function spawnOf(rows: readonly string[]): { x: number; y: number } {
  for (let r = 0; r < rows.length; r++) {
    const c = (rows[r] as string).indexOf("@");
    if (c >= 0) return { x: c * TILE + ((TILE - BODY_W) >> 1), y: (r + 1) * TILE - BODY_H };
  }
  throw new Error("A room needs an @.");
}

export function layOut(specs: readonly RoomSpec[]): Room[] {
  const rooms: Room[] = [];
  let ox = 0;
  let oy = 0;
  for (const [index, spec] of specs.entries()) {
    if (spec.rows.length !== ROOM_ROWS) throw new Error(`Room ${index + 1} ('${spec.name}') has ${spec.rows.length} rows, not ${ROOM_ROWS}.`);
    for (const row of spec.rows) if (row.length !== ROOM_COLS) throw new Error(`Room ${index + 1} ('${spec.name}') has a row of ${row.length} columns, not ${ROOM_COLS}: ${row}`);
    const spawn = spawnOf(spec.rows);
    rooms.push({ index, name: spec.name, exit: spec.exit, rows: spec.rows, ox, oy, spawnX: spawn.x, spawnY: spawn.y });
    if (spec.exit === "right") ox += ROOM_W;
    else if (spec.exit === "up") oy -= ROOM_H;
  }
  return rooms;
}

export const ROOM_SPECS = ROOMS;
export const ROOM_LIST: readonly Room[] = layOut(ROOMS);

/** What the rules ask of a room: which pixels are solid, and where the hazards, exits and gem are. */
export interface RoomGrid {
  /** The tile character at a cell, `"."` outside the room. */
  tile(col: number, row: number): string;
  solidAt(x: number, y: number): boolean;
}

export function gridOf(room: Room): RoomGrid {
  const tile = (col: number, row: number): string => (col < 0 || col >= ROOM_COLS || row < 0 || row >= ROOM_ROWS ? "." : (room.rows[row] as string)[col]!);
  return { tile, solidAt: (x, y) => tile(Math.floor(x / TILE), Math.floor(y / TILE)) === "#" };
}

/** The part of a spike tile that hurts, as a rectangle in the room's pixels, or null for any other tile. Spikes are half a tile deep. */
export function hazardRect(ch: string, col: number, row: number): { x: number; y: number; w: number; h: number } | null {
  const x = col * TILE;
  const y = row * TILE;
  const half = TILE / 2;
  switch (ch) {
    case "^": return { x, y: y + half, w: TILE, h: half };
    case "v": return { x, y, w: TILE, h: half };
    case "<": return { x: x + half, y, w: half, h: TILE };
    case ">": return { x, y, w: half, h: TILE };
    default: return null;
  }
}

/** Does the hitbox at (x, y) overlap a rectangle? */
export function overlapsRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  return x < rect.x + rect.w && x + BODY_W > rect.x && y < rect.y + rect.h && y + BODY_H > rect.y;
}

/** Every tile in the room with the given character, as `[col, row]`. */
export function tilesOf(room: Room, ch: string): [number, number][] {
  const found: [number, number][] = [];
  for (let r = 0; r < ROOM_ROWS; r++) for (let c = 0; c < ROOM_COLS; c++) if ((room.rows[r] as string)[c] === ch) found.push([c, r]);
  return found;
}

/** The room's void: how far outside it the body may go before it counts as lost. */
export const ROOM_BOUNDS = { w: ROOM_W, h: ROOM_H };
