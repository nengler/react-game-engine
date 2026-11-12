/**
 * The world: four maps as text, with the people, items, doors and shrines placed on them by tile. `tools/make-maps.ts` writes
 * the text as Tiled maps (`scenes/*.tmj`, the ground layer the game draws), and `test/maps.test.ts` checks they still agree. The
 * rules read the text: `.` ground, `#` wall, `~` water, `b` a bush (solid until cut with the shears).
 */
import { TILE } from "./constants.ts";
import type { NpcId } from "./dialogue.ts";

export type MapId = "overworld" | "cave" | "house" | "maze";
export type ItemId = "lantern" | "key" | "shears" | "bell";

export interface Door {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  /** Where it leads: the map and the door there; the character arrives one tile out from that door. */
  readonly to: { readonly map: MapId; readonly door: string };
  /** Which way the door faces: arriving here puts the character at `col + out[0]`, `row + out[1]`. */
  readonly out: readonly [number, number];
  /** What the character must carry to go through. */
  readonly needs?: ItemId;
}

export interface Pickup {
  /** Unique across the world; kept in the run's `taken` once picked up. */
  readonly id: string;
  readonly item: ItemId;
  readonly col: number;
  readonly row: number;
}

export interface Placed {
  readonly col: number;
  readonly row: number;
}

export type EnemyKind = "beetle" | "wisp";

export interface EnemySpawn extends Placed {
  readonly id: string;
  readonly kind: EnemyKind;
}

export interface MapDef {
  readonly id: MapId;
  readonly name: string;
  readonly rows: readonly string[];
  readonly doors: readonly Door[];
  readonly pickups: readonly Pickup[];
  readonly npcs: readonly (Placed & { readonly id: NpcId })[];
  readonly shrines: readonly (Placed & { readonly id: string })[];
  readonly enemies: readonly EnemySpawn[];
  /** The gate that ends the game, on the overworld only. */
  readonly gate?: Placed;
}

function grid(width: number, height: number): string[][] {
  return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => (r === 0 || c === 0 || r === height - 1 || c === width - 1 ? "#" : ".")));
}

function fill(g: string[][], ch: string, c0: number, r0: number, c1: number, r1: number): void {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r]![c] = ch;
}

const text = (g: string[][]): string[] => g.map((row) => row.join(""));

function overworld(): MapDef {
  const g = grid(80, 48);
  fill(g, "#", 1, 32, 19, 32); // a ridge across the valley, with a pass at cols 20 to 22
  fill(g, "#", 23, 32, 78, 32);
  fill(g, "#", 40, 33, 40, 39); // a second ridge, with a gap at rows 40 and 41 into the south-east
  fill(g, "#", 40, 42, 40, 46);
  fill(g, "~", 10, 24, 16, 28); // two ponds
  fill(g, "~", 60, 24, 66, 29);
  fill(g, "#", 36, 1, 44, 2); // the gate's wall
  fill(g, "#", 4, 21, 8, 23); // the house, in the west
  fill(g, "#", 70, 3, 74, 5); // the maze's front, in the north-east
  fill(g, "#", 66, 42, 70, 44); // the cave, in the south-east
  fill(g, "#", 28, 8, 28, 20); // a hedge-row of rock in the north, to walk round
  fill(g, "#", 50, 10, 58, 10);
  return {
    id: "overworld",
    name: "The valley",
    rows: text(g),
    doors: [
      { id: "cave", col: 68, row: 44, to: { map: "cave", door: "cave-exit" }, out: [0, 1], needs: "lantern" },
      { id: "house", col: 6, row: 23, to: { map: "house", door: "house-exit" }, out: [0, 1], needs: "key" },
      { id: "maze", col: 72, row: 5, to: { map: "maze", door: "maze-exit" }, out: [0, 1] },
    ],
    pickups: [{ id: "lantern", item: "lantern", col: 9, row: 43 }],
    npcs: [
      { id: "guide", col: 12, row: 41 },
      { id: "gardener", col: 9, row: 25 },
      { id: "hermit", col: 68, row: 6 },
      { id: "keeper", col: 37, row: 4 },
    ],
    shrines: [
      { id: "shrine-south", col: 6, row: 42 },
      { id: "shrine-middle", col: 21, row: 29 },
      { id: "shrine-north", col: 72, row: 9 },
    ],
    enemies: [
      { id: "beetle-1", kind: "beetle", col: 16, row: 38 },
      { id: "beetle-2", kind: "beetle", col: 34, row: 44 },
      { id: "beetle-3", kind: "beetle", col: 12, row: 18 },
      { id: "beetle-4", kind: "beetle", col: 56, row: 40 },
      { id: "wisp-1", kind: "wisp", col: 22, row: 20 },
      { id: "wisp-2", kind: "wisp", col: 48, row: 16 },
      { id: "wisp-3", kind: "wisp", col: 60, row: 8 },
    ],
    gate: { col: 40, row: 2 },
  };
}

function cave(): MapDef {
  const g = grid(30, 16);
  fill(g, "#", 5, 3, 5, 10);
  fill(g, "#", 5, 10, 20, 10);
  fill(g, "#", 10, 4, 24, 4);
  fill(g, "#", 24, 4, 24, 8);
  fill(g, "#", 14, 7, 14, 10);
  return {
    id: "cave",
    name: "The cave",
    rows: text(g),
    // The way out is in the bottom wall: a door tile in the wall row, reached from above.
    doors: [{ id: "cave-exit", col: 15, row: 15, to: { map: "overworld", door: "cave" }, out: [0, -1] }],
    pickups: [
      { id: "key", item: "key", col: 3, row: 3 },
      { id: "bell-cave", item: "bell", col: 27, row: 2 },
    ],
    npcs: [],
    shrines: [],
    enemies: [{ id: "wisp-cave", kind: "wisp", col: 20, row: 8 }, { id: "beetle-cave", kind: "beetle", col: 8, row: 13 }],
  };
}

function house(): MapDef {
  const g = grid(20, 12);
  fill(g, "#", 8, 3, 8, 6);
  fill(g, "#", 12, 6, 12, 9);
  return {
    id: "house",
    name: "The old house",
    rows: text(g),
    doors: [{ id: "house-exit", col: 10, row: 11, to: { map: "overworld", door: "house" }, out: [0, -1] }],
    pickups: [
      { id: "shears", item: "shears", col: 3, row: 3 },
      { id: "bell-house", item: "bell", col: 16, row: 3 },
    ],
    npcs: [],
    shrines: [],
    enemies: [],
  };
}

function maze(): MapDef {
  const g = grid(30, 16);
  // A ring of hedge with its entrance at the bottom, a solid block inside it, and the way on to the bell blocked by bushes that
  // only the shears clear.
  fill(g, "#", 3, 3, 26, 3);
  fill(g, "#", 3, 3, 3, 12);
  fill(g, "#", 26, 3, 26, 12);
  fill(g, "#", 3, 12, 13, 12);
  fill(g, "#", 16, 12, 26, 12);
  fill(g, "#", 7, 6, 22, 9);
  fill(g, "#", 4, 4, 12, 4);
  fill(g, "#", 17, 4, 25, 4);
  fill(g, "b", 14, 3, 15, 3);
  return {
    id: "maze",
    name: "The hedge maze",
    rows: text(g),
    doors: [{ id: "maze-exit", col: 15, row: 15, to: { map: "overworld", door: "maze" }, out: [0, -1] }],
    pickups: [{ id: "bell-maze", item: "bell", col: 15, row: 1 }],
    npcs: [],
    shrines: [],
    enemies: [{ id: "beetle-maze", kind: "beetle", col: 10, row: 13 }],
  };
}

export const MAPS: Readonly<Record<MapId, MapDef>> = { overworld: overworld(), cave: cave(), house: house(), maze: maze() };
export const MAP_IDS: readonly MapId[] = ["overworld", "cave", "house", "maze"];

export function mapSize(map: MapId): { readonly cols: number; readonly rows: number } {
  const def = MAPS[map];
  return { cols: def.rows[0]!.length, rows: def.rows.length };
}

export const mapPixels = (map: MapId): { readonly width: number; readonly height: number } => {
  const { cols, rows } = mapSize(map);
  return { width: cols * TILE, height: rows * TILE };
};

/** The character of a cell; outside the map counts as wall. */
export function cellAt(map: MapId, col: number, row: number): string {
  return MAPS[map].rows[row]?.[col] ?? "#";
}

export function findDoor(map: MapId, id: string): Door {
  const door = MAPS[map].doors.find((d) => d.id === id);
  if (door === undefined) throw new Error(`no door ${id} on ${map}`);
  return door;
}
