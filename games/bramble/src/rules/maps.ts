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

export interface MapDef {
  readonly id: MapId;
  readonly name: string;
  readonly rows: readonly string[];
  readonly doors: readonly Door[];
  readonly pickups: readonly Pickup[];
  readonly npcs: readonly (Placed & { readonly id: NpcId })[];
  readonly shrines: readonly (Placed & { readonly id: string })[];
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
  const g = grid(48, 30);
  fill(g, "~", 10, 6, 16, 10); // a pond
  fill(g, "#", 1, 14, 19, 14); // a ridge across the valley, with a pass between col 20 and 22
  fill(g, "#", 23, 14, 46, 14);
  fill(g, "#", 30, 15, 30, 21); // a second ridge in the south, open below row 22
  fill(g, "#", 30, 24, 30, 28);
  fill(g, "#", 22, 1, 26, 2); // the gate's wall
  fill(g, "#", 4, 3, 8, 5); // the house
  fill(g, "#", 40, 24, 44, 26); // the cave
  fill(g, "#", 40, 3, 44, 5); // the maze's front
  fill(g, "~", 34, 8, 36, 11); // a second pond
  return {
    id: "overworld",
    name: "The valley",
    rows: text(g),
    doors: [
      { id: "cave", col: 42, row: 26, to: { map: "cave", door: "cave-exit" }, out: [0, 1], needs: "lantern" },
      { id: "house", col: 6, row: 5, to: { map: "house", door: "house-exit" }, out: [0, 1], needs: "key" },
      { id: "maze", col: 42, row: 5, to: { map: "maze", door: "maze-exit" }, out: [0, 1] },
    ],
    pickups: [{ id: "lantern", item: "lantern", col: 9, row: 25 }],
    npcs: [
      { id: "guide", col: 12, row: 23 },
      { id: "gardener", col: 9, row: 7 },
      { id: "hermit", col: 38, row: 6 },
      { id: "keeper", col: 21, row: 4 },
    ],
    shrines: [
      { id: "shrine-south", col: 6, row: 24 },
      { id: "shrine-middle", col: 21, row: 11 },
      { id: "shrine-north", col: 42, row: 9 },
    ],
    gate: { col: 24, row: 2 },
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
