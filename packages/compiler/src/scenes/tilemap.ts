/**
 * Tiled map (`.tmj`) → the data of a `<Tilemap>`: the tile layers (global tile ids with the flip bits split off, and whether the
 * layer is shown), the size of a cell, and which tiles are solid (the tile property `solid`, from an embedded tileset). Object
 * layers are the scene importer's business (`importTiled`); a map can have both.
 *
 * What it reads: JSON maps with tile data as CSV or base64 (uncompressed, zlib or gzip), finite (not infinite) maps, and tilesets
 * that are embedded or external JSON (`.tsj`, read through `options.readFile`); the `solid` tiles of every tileset count. What it
 * does not: infinite maps, zstd layers, XML tilesets (`.tsx`) and drawing from more than one sheet (the map's `firstGid` is the first
 * tileset's, so tiles of the others are drawn from the wrong sheet); each of these says so rather than being quietly wrong.
 */
import { gunzipSync, inflateSync } from "node:zlib";
import { DiagnosticCode, error, warning, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";

/** The three flip flags Tiled keeps in the top bits of a tile's global id. */
const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const GID_MASK = 0x1fffffff;

export interface TilemapLayerOut {
  readonly name: string;
  readonly visible: boolean;
  readonly data: readonly number[];
  readonly flips?: readonly number[];
}

/** A Tiled object, as data for a game's rules: where it is (pixels of the map), its size, and its custom properties. */
export interface TilemapObjectOut {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

export interface TilemapOut {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly firstGid: number;
  readonly solid: readonly number[];
  readonly layers: readonly TilemapLayerOut[];
  /** The objects of every object layer (not the ones Tiled hides), in file order. */
  readonly objects: readonly TilemapObjectOut[];
}

export interface TilemapImport {
  /** Null when the map has no tile layer with tiles in it (an object-only map), or could not be read. */
  readonly tilemap: TilemapOut | null;
  readonly diagnostics: CompilerDiagnostic[];
}

interface RawLayer {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly visible?: unknown;
  readonly data?: unknown;
  readonly encoding?: unknown;
  readonly compression?: unknown;
  readonly chunks?: unknown;
  readonly layers?: unknown;
}

interface RawTileset {
  readonly firstgid?: unknown;
  readonly source?: unknown;
  readonly tiles?: unknown;
}

export interface TilemapImportOptions {
  /** Read a file named in the map (an external tileset), by the path the map gives, relative to the map's folder: its text, or null when it cannot be read. */
  readonly readFile?: (path: string) => string | null;
}

/** The cells of a base64 tile layer: little-endian 32-bit ids, after inflating `compression` ("", "zlib" or "gzip"). Null, with a reason, when it cannot be read. */
function decodeLayerData(text: string, compression: unknown, cells: number): { data: number[] } | { reason: string } {
  let bytes = Buffer.from(text, "base64");
  try {
    if (compression === "zlib") bytes = inflateSync(bytes);
    else if (compression === "gzip") bytes = gunzipSync(bytes);
    else if (compression !== undefined && compression !== "") return { reason: `compression '${String(compression)}' is not supported: set the map's Tile Layer Compression to zlib or gzip, or Tile Layer Format to CSV` };
  } catch {
    return { reason: "its data does not decompress" };
  }
  if (bytes.length !== cells * 4) return { reason: `it holds ${bytes.length} bytes, not ${cells * 4} (${cells} cells), but the map is ${cells}` };
  const data: number[] = new Array<number>(cells);
  for (let i = 0; i < cells; i++) data[i] = bytes.readUInt32LE(i * 4);
  return { data };
}

export function importTilemap(fileName: string, text: string, options: TilemapImportOptions = {}): TilemapImport {
  const diagnostics: CompilerDiagnostic[] = [];
  const at = (message: string): string => `${fileName}: ${message}`;
  const fail = (message: string): TilemapImport => {
    diagnostics.push(error(DiagnosticCode.TiledImport, at(message), null));
    return { tilemap: null, diagnostics };
  };
  const note = (message: string): void => void diagnostics.push(warning(DiagnosticCode.TiledImport, at(message), null));

  let map: { width?: unknown; height?: unknown; tilewidth?: unknown; tileheight?: unknown; infinite?: unknown; layers?: unknown; tilesets?: unknown };
  try {
    map = JSON.parse(text) as typeof map;
  } catch {
    return { tilemap: null, diagnostics }; // the scene importer reports unreadable JSON
  }
  if (map === null || typeof map !== "object" || !Array.isArray(map.layers)) return { tilemap: null, diagnostics };
  const { width, height, tilewidth, tileheight } = map;
  if (map.infinite === true) {
    const tileLayers = (map.layers as RawLayer[]).some((l) => l.type === "tilelayer");
    return tileLayers ? fail("an infinite map has no fixed size to draw: turn off Infinite in the map's properties.") : { tilemap: null, diagnostics };
  }
  if (typeof width !== "number" || typeof height !== "number" || typeof tilewidth !== "number" || typeof tileheight !== "number") {
    return (map.layers as RawLayer[]).some((l) => l.type === "tilelayer") ? fail("a map with tile layers needs a numeric width, height, tilewidth and tileheight.") : { tilemap: null, diagnostics };
  }

  const layers: TilemapLayerOut[] = [];
  const visit = (list: readonly RawLayer[], shown: boolean): void => {
    for (const layer of list) {
      const visible = shown && layer.visible !== false;
      if (layer.type === "group" && Array.isArray(layer.layers)) visit(layer.layers as RawLayer[], visible);
      else if (layer.type === "tilelayer") readLayer(layer, visible);
    }
  };
  const readLayer = (layer: RawLayer, visible: boolean): void => {
    const name = typeof layer.name === "string" ? layer.name : "layer";
    if (layer.chunks !== undefined) {
      fail(`tile layer '${name}' is in chunks (an infinite map): turn off Infinite.`);
      return;
    }
    let cells: unknown[];
    if (typeof layer.data === "string") {
      if (layer.encoding !== "base64") {
        fail(`tile layer '${name}' has text data in an encoding the importer does not read: set the map's Tile Layer Format to CSV or base64.`);
        return;
      }
      const decoded = decodeLayerData(layer.data, layer.compression, width * height);
      if ("reason" in decoded) {
        fail(`tile layer '${name}': ${decoded.reason}.`);
        return;
      }
      cells = decoded.data;
    } else if (layer.compression !== undefined && layer.compression !== "") {
      fail(`tile layer '${name}' is compressed but its data is not base64 text.`);
      return;
    } else if (!Array.isArray(layer.data) || layer.data.length === 0) return; // an empty layer (as in a map made for objects only)
    else cells = layer.data;
    if (cells.length !== width * height) {
      fail(`tile layer '${name}' has ${cells.length} cells, but the map is ${width} × ${height} = ${width * height}.`);
      return;
    }
    const data: number[] = new Array<number>(cells.length);
    const flips: number[] = new Array<number>(cells.length).fill(0);
    let flipped = false;
    for (let i = 0; i < cells.length; i++) {
      const raw = cells[i];
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        fail(`tile layer '${name}', cell ${i}: ${String(raw)} is not a tile id.`);
        return;
      }
      const flags = (raw & FLIP_H ? 1 : 0) | (raw & FLIP_V ? 2 : 0) | (raw & FLIP_D ? 4 : 0);
      data[i] = raw & GID_MASK;
      if (flags !== 0) {
        flips[i] = flags;
        flipped = true;
      }
      if ((raw & 0x10000000) !== 0) note(`tile layer '${name}', cell ${i} is a rotated hexagonal tile, which is not supported: it is drawn unrotated.`);
    }
    layers.push({ name, visible, data, ...(flipped ? { flips } : {}) });
  };
  visit(map.layers as RawLayer[], true);
  const objects: TilemapObjectOut[] = [];
  const collect = (list: readonly RawLayer[], shown: boolean): void => {
    for (const layer of list) {
      const visible = shown && layer.visible !== false;
      if (layer.type === "group" && Array.isArray(layer.layers)) collect(layer.layers as RawLayer[], visible);
      else if (layer.type === "objectgroup" && visible && Array.isArray((layer as { objects?: unknown }).objects)) {
        for (const o of (layer as { objects: Record<string, unknown>[] }).objects) {
          if (o["visible"] === false) continue;
          const properties: Record<string, string | number | boolean> = {};
          if (Array.isArray(o["properties"])) {
            for (const p of o["properties"] as { name?: unknown; value?: unknown }[]) {
              if (typeof p.name === "string" && (typeof p.value === "string" || typeof p.value === "number" || typeof p.value === "boolean")) properties[p.name] = p.value;
            }
          }
          const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
          objects.push({ id: num(o["id"]), name: typeof o["name"] === "string" ? o["name"] : "", type: typeof o["type"] === "string" ? o["type"] : typeof o["class"] === "string" ? o["class"] : "", x: num(o["x"]), y: num(o["y"]), width: num(o["width"]), height: num(o["height"]), properties });
        }
      }
    }
  };
  collect(map.layers as RawLayer[], true);
  if (layers.length === 0 || diagnostics.some((d) => d.severity === "error")) return { tilemap: null, diagnostics };

  // The tilesets: the first says where the map's ids start; the tiles with the property `solid` of every one are solid. An external
  // tileset is read through `options.readFile` (JSON only).
  const tilesets = Array.isArray(map.tilesets) ? (map.tilesets as RawTileset[]) : [];
  const first = tilesets[0];
  const firstGid = first !== undefined && typeof first.firstgid === "number" ? first.firstgid : 1;
  if (tilesets.length > 1) note(`the map has ${tilesets.length} tilesets: tiles of all of them are drawn from the first one's sheet, so those of the others look wrong. (Their \`solid\` tiles are read.)`);
  const solid: number[] = [];
  for (const set of tilesets) {
    let body: RawTileset = set;
    if (set.source !== undefined) {
      const source = String(set.source);
      if (!/\.(tsj|json)$/i.test(source)) {
        note(`the tileset '${source}' is not JSON (.tsj), so its tile properties cannot be read and none of its tiles is solid. Save it as .tsj or embed it in the map.`);
        continue;
      }
      const loaded = options.readFile?.(source) ?? null;
      let parsed: RawTileset | null = null;
      try {
        parsed = loaded === null ? null : (JSON.parse(loaded) as RawTileset);
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        note(`the tileset '${source}' cannot be read, so none of its tiles is solid.`);
        continue;
      }
      body = { ...parsed, firstgid: set.firstgid };
    }
    const base = typeof body.firstgid === "number" ? body.firstgid : 1;
    if (!Array.isArray(body.tiles)) continue;
    for (const tile of body.tiles as { id?: unknown; properties?: unknown }[]) {
      if (typeof tile.id !== "number" || !Array.isArray(tile.properties)) continue;
      for (const property of tile.properties as { name?: unknown; value?: unknown }[]) {
        if (property.name === "solid" && property.value === true) solid.push(base + tile.id);
      }
    }
  }
  return { tilemap: { width, height, tileWidth: tilewidth, tileHeight: tileheight, firstGid, solid, layers, objects }, diagnostics };
}

/** The text of `generated/tilemaps.ts` for the maps found, by name: the table `registerTilemaps` takes. */
export function tilemapsSource(maps: ReadonlyMap<string, TilemapOut>, fromDir: string): string {
  const lines: string[] = [
    `// Generated by @rge/compiler from the Tiled maps in ${fromDir}. Do not edit.`,
    `import { registerTilemaps, type TilemapData } from "@rge/runtime";`,
    "",
    "/** Every map's tile layers and solid tiles, by the map's file name. Registered as this module loads, so `getTilemap(name)` and `<Tilemap map>` find them. */",
    "export const tilemaps: Record<string, TilemapData> = {",
  ];
  for (const [name, map] of [...maps].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    lines.push(`  ${JSON.stringify(name)}: {`);
    lines.push(`    width: ${map.width}, height: ${map.height}, tileWidth: ${map.tileWidth}, tileHeight: ${map.tileHeight}, firstGid: ${map.firstGid},`);
    lines.push(`    solid: ${JSON.stringify(map.solid)},`);
    lines.push("    layers: [");
    for (const layer of map.layers) {
      lines.push(`      { name: ${JSON.stringify(layer.name)}, visible: ${layer.visible},`);
      lines.push(`        data: ${JSON.stringify(layer.data)},`);
      if (layer.flips !== undefined) lines.push(`        flips: ${JSON.stringify(layer.flips)},`);
      lines.push("      },");
    }
    lines.push("    ],");
    if (map.objects.length > 0) lines.push(`    objects: ${JSON.stringify(map.objects)},`);
    lines.push("  },");
  }
  lines.push("};", "", "registerTilemaps(tilemaps);", "");
  return lines.join("\n");
}
