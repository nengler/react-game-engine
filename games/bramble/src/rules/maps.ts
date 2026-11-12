/**
 * The world: four maps drawn in Tiled (`scenes/*.tmj`). Each has a tile layer, `Ground` (floor, wall, water; the tileset marks
 * wall and water `solid`), and an object layer of the things on it, each a one-tile object whose Class says what it is:
 *
 * | Class | Name | Properties |
 * | --- | --- | --- |
 * | `door` | the door's id | `to` (`map/door`, where it leads), `out` (`up`, `down`, `left` or `right`: which way it faces), `needs` (an item, optional) |
 * | `item` | the pickup's id (unique in the world) | `item` (`lantern`, `key`, `shears` or `bell`) |
 * | `npc` | who it is (`guide`, `gardener`, `hermit`, `keeper`) | |
 * | `shrine` | the shrine's id | |
 * | `enemy` | the enemy's id | `kind` (`beetle` or `wisp`) |
 * | `gate` | | (one, on the overworld) |
 * | `bush` | | (solid until cut with the shears) |
 *
 * The map's own property `name` is the name shown on arrival. `readMap` checks all of it and says what is wrong, by map and object,
 * so a map saved by Tiled with a mistake fails `test/maps.test.ts` rather than the game. The rules see each map as text, as
 * before: `.` ground, `#` wall, `~` water, `b` a bush.
 */
import type { TilemapData } from "@rge/runtime";
import { tilemaps } from "../../generated/tilemaps.ts";
import { TILE } from "./constants.ts";
import { DIALOGUE, type NpcId } from "./dialogue.ts";

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

/** Global tile ids of `assets/tiles.png` in the `Ground` layer, as the rules' text. Any other tile is ground, or wall if solid. */
const GROUND: Readonly<Record<number, string>> = { 1: ".", 2: "#", 3: "~" };
const ITEMS: readonly ItemId[] = ["lantern", "key", "shears", "bell"];
const KINDS: readonly EnemyKind[] = ["beetle", "wisp"];
const FACING: Readonly<Record<string, readonly [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const MAP_IDS: readonly MapId[] = ["overworld", "cave", "house", "maze"];

/**
 * A map as the rules use it, from its Tiled data. Throws, naming the map and the object, for anything the rules cannot use: an
 * unknown Class, a missing or wrong property, an object off the map or two with the same id.
 */
export function readMap(id: MapId, data: TilemapData): MapDef {
  const fail = (message: string): never => {
    throw new Error(`scenes/${id}.tmj: ${message}`);
  };
  const ground = data.layers.find((l) => l.name === "Ground") ?? fail("it has no tile layer named Ground.");
  const solid = new Set(data.solid);
  const cells: string[][] = [];
  for (let r = 0; r < data.height; r++) {
    const row: string[] = [];
    for (let c = 0; c < data.width; c++) {
      const gid = ground.data[r * data.width + c] ?? 0;
      row.push(GROUND[gid] ?? (solid.has(gid) ? "#" : "."));
    }
    cells.push(row);
  }
  const doors: Door[] = [];
  const pickups: Pickup[] = [];
  const npcs: (Placed & { id: NpcId })[] = [];
  const shrines: (Placed & { id: string })[] = [];
  const enemies: EnemySpawn[] = [];
  let gate: Placed | undefined;
  const seen = new Set<string>();
  for (const o of data.objects ?? []) {
    const what = `object ${o.id}${o.name === "" ? "" : ` '${o.name}'`} (${o.type === "" ? "no Class" : o.type})`;
    // The cell under the object's middle; a point object is the cell it is in.
    const col = Math.floor((o.x + o.width / 2) / TILE);
    const row = Math.floor((o.y + o.height / 2) / TILE);
    if (!(col >= 0 && col < data.width && row >= 0 && row < data.height)) fail(`${what} is off the map.`);
    const text = (name: string, optional = false): string | undefined => {
      const value = o.properties[name];
      if (value === undefined && optional) return undefined;
      return typeof value === "string" && value !== "" ? value : fail(`${what} needs a string property '${name}'.`);
    };
    const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], name: string): T =>
      allowed.includes(value as T) ? (value as T) : fail(`${what}: '${name}' is '${String(value)}', not one of ${allowed.join(", ")}.`);
    const named = (): string => {
      if (o.name === "") fail(`${what} needs a name: its id.`);
      if (seen.has(`${o.type}:${o.name}`)) fail(`${what}: another ${o.type} on this map has the same name.`);
      seen.add(`${o.type}:${o.name}`);
      return o.name;
    };
    switch (o.type) {
      case "door": {
        const door = named();
        const [toMap, toDoor] = text("to")!.split("/");
        const facing = FACING[text("out")!] ?? fail(`${what}: 'out' must be up, down, left or right.`);
        const needs = text("needs", true);
        doors.push({ id: door, col, row, to: { map: oneOf(toMap, MAP_IDS, "to"), door: toDoor ?? fail(`${what}: 'to' is map/door.`) }, out: facing, ...(needs === undefined ? {} : { needs: oneOf(needs, ITEMS, "needs") }) });
        break;
      }
      case "item":
        pickups.push({ id: named(), item: oneOf(text("item"), ITEMS, "item"), col, row });
        break;
      case "npc":
        npcs.push({ id: oneOf(named(), Object.keys(DIALOGUE) as NpcId[], "name"), col, row });
        break;
      case "shrine":
        shrines.push({ id: named(), col, row });
        break;
      case "enemy":
        enemies.push({ id: named(), kind: oneOf(text("kind"), KINDS, "kind"), col, row });
        break;
      case "gate":
        if (gate !== undefined) fail(`${what}: a map has one gate.`);
        gate = { col, row };
        break;
      case "bush":
        cells[row]![col] = "b";
        break;
      default:
        fail(`${what}: the Class must be door, item, npc, shrine, enemy, gate or bush.`);
    }
  }
  const name = data.properties?.["name"];
  return {
    id,
    name: typeof name === "string" ? name : fail("it needs a map property 'name' (Map → Map Properties)."),
    rows: cells.map((r) => r.join("")),
    doors,
    pickups,
    npcs,
    shrines,
    enemies,
    ...(gate === undefined ? {} : { gate }),
  };
}

/** Every map, read from `generated/tilemaps.ts`; a door that leads nowhere is an error here too. */
function readWorld(maps: Readonly<Record<string, TilemapData>>): Record<MapId, MapDef> {
  const world = {} as Record<MapId, MapDef>;
  for (const id of MAP_IDS) world[id] = readMap(id, maps[id] ?? (() => { throw new Error(`scenes/${id}.tmj is missing (or was not compiled).`); })());
  for (const def of Object.values(world)) {
    for (const d of def.doors) {
      if (!world[d.to.map].doors.some((there) => there.id === d.to.door)) throw new Error(`scenes/${def.id}.tmj: door '${d.id}' leads to '${d.to.map}/${d.to.door}', which is not a door.`);
    }
  }
  return world;
}

export const MAPS: Readonly<Record<MapId, MapDef>> = readWorld(tilemaps);

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
