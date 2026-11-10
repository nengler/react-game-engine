import { ROOM_COLS, ROOM_ROWS } from "../src/rules/constants.ts";

/**
 * The level's rooms, as text: `ROOM_ROWS` rows of `ROOM_COLS` characters each.
 *
 *     #  a solid tile            ^ v < >  spikes, on the floor, the ceiling, a left-facing and a right-facing wall
 *     .  nothing                 @  where the character starts the room (and returns to after a death)
 *     E  the exit: touching it moves on to the next room       o  the optional gem
 *
 * These strings are the first draft of every room; `tools/make-rooms.ts` turns them into Tiled maps (`scenes/`), which
 * are what the game loads and what a person edits from then on.
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

export const ROOM_SPECS: readonly RoomSpec[] = ROOMS;
