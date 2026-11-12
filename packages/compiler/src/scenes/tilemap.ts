/**
 * Tiled map (`.tmj`) → the data of a `<Tilemap>`: the tile layers (global tile ids with the flip bits split off, and whether the
 * layer is shown), the size of a cell, which tiles are solid (the tile property `solid`), each tileset's sheet and how it is cut,
 * the map's own properties, and the objects of its object layers as data. Object layers are also the scene importer's business
 * (`importTiled`) when a map holds prefabs; a map can have both.
 *
 * What it reads: JSON maps with tile data as CSV or base64 (uncompressed, zlib or gzip), finite (not infinite) maps, and tilesets
 * that are embedded or external, JSON (`.tsj`) or XML (`.tsx`), read through `options.readFile`; the `solid` tiles of every
 * tileset count. What it does not: infinite maps, zstd layers, and tilesets that are collections of images (their tiles are not
 * drawn unless the `<Tilemap>` names a sheet); each of these says so rather than being quietly wrong.
 */
import { gunzipSync, inflateSync } from "node:zlib";
import { posix } from "node:path";
import { DiagnosticCode, error, warning, type CompilerDiagnostic } from "../diagnostics/diagnostics.ts";
import { readTsx, type TilesetJson } from "./tsx.ts";

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

/** A tileset's sheet and how it is cut (see the runtime's `TilesetData`). */
export interface TilesetOut {
  readonly firstGid: number;
  /** The sheet as an asset name (through `options.resolveImage`), or "" when there is none to draw from. */
  readonly image: string;
  readonly columns: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly margin: number;
  readonly spacing: number;
}

export type PropertyValue = string | number | boolean;

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
  /** Every tileset, in order of `firstGid`. */
  readonly tilesets: readonly TilesetOut[];
  /** The map's own custom properties. */
  readonly properties: Readonly<Record<string, PropertyValue>>;
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
  readonly image?: unknown;
  readonly imagewidth?: unknown;
  readonly columns?: unknown;
  readonly tilewidth?: unknown;
  readonly tileheight?: unknown;
  readonly margin?: unknown;
  readonly spacing?: unknown;
}

export interface TilemapImportOptions {
  /** Read a file named in the map (an external tileset), by the path the map gives, relative to the map's folder: its text, or null when it cannot be read. */
  readonly readFile?: (path: string) => string | null;
  /**
   * Turn a tileset's image, as a path from the map's folder (`/` separated), into the name the game loads it by (a path in the
   * assets folder), or null when it is not in the assets folder. Without this, the path from the map's folder is kept.
   */
  readonly resolveImage?: (path: string) => string | null;
}

/** Custom properties as Tiled saves them (`[{ name, type, value }]`): only strings, numbers and booleans are kept. */
function readProperties(list: unknown): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  if (!Array.isArray(list)) return out;
  for (const p of list as { name?: unknown; value?: unknown }[]) {
    if (typeof p.name === "string" && (typeof p.value === "string" || typeof p.value === "number" || typeof p.value === "boolean")) out[p.name] = p.value;
  }
  return out;
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

  let map: { width?: unknown; height?: unknown; tilewidth?: unknown; tileheight?: unknown; infinite?: unknown; layers?: unknown; tilesets?: unknown; properties?: unknown };
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
  // Every visible object layer's objects, wherever Tiled shows them: a layer's offset (and its groups') moves them, as in the scene importer.
  const collect = (list: readonly RawLayer[], shown: boolean, dx: number, dy: number): void => {
    for (const layer of list) {
      const visible = shown && layer.visible !== false;
      const offset = layer as { offsetx?: unknown; offsety?: unknown };
      const x = dx + (typeof offset.offsetx === "number" ? offset.offsetx : 0);
      const y = dy + (typeof offset.offsety === "number" ? offset.offsety : 0);
      if (layer.type === "group" && Array.isArray(layer.layers)) collect(layer.layers as RawLayer[], visible, x, y);
      else if (layer.type === "objectgroup" && visible && Array.isArray((layer as { objects?: unknown }).objects)) {
        for (const o of (layer as { objects: Record<string, unknown>[] }).objects) {
          if (o["visible"] === false) continue;
          const properties = readProperties(o["properties"]);
          const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
          objects.push({ id: num(o["id"]), name: typeof o["name"] === "string" ? o["name"] : "", type: typeof o["type"] === "string" ? o["type"] : typeof o["class"] === "string" ? o["class"] : "", x: x + num(o["x"]), y: y + num(o["y"]), width: num(o["width"]), height: num(o["height"]), properties });
        }
      }
    }
  };
  collect(map.layers as RawLayer[], true, 0, 0);
  if (layers.length === 0 || diagnostics.some((d) => d.severity === "error")) return { tilemap: null, diagnostics };

  // The tilesets: each one's sheet and how it is cut, and the tiles with the property `solid` of every one. An external tileset is
  // read through `options.readFile`, as JSON (`.tsj`) or XML (`.tsx`); its image is relative to the tileset's own file.
  const raw = Array.isArray(map.tilesets) ? (map.tilesets as RawTileset[]) : [];
  const numOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const solid: number[] = [];
  const tilesets: TilesetOut[] = [];
  for (const set of raw) {
    let body: RawTileset = set;
    let folder = ""; // the folder the tileset's image is relative to, from the map's folder
    const base = numOr(set.firstgid, 1);
    if (set.source !== undefined) {
      const source = String(set.source);
      const xml = /\.tsx$/i.test(source);
      if (!xml && !/\.(tsj|json)$/i.test(source)) {
        note(`the tileset '${source}' is neither JSON (.tsj) nor XML (.tsx), so it is not read: its tiles are not solid and are not drawn. Save it as .tsj or .tsx, or embed it in the map.`);
        tilesets.push({ firstGid: base, image: "", columns: 0, tileWidth: tilewidth, tileHeight: tileheight, margin: 0, spacing: 0 });
        continue;
      }
      const loaded = options.readFile?.(source) ?? null;
      let parsed: RawTileset | null = null;
      let why = "";
      try {
        parsed = loaded === null ? null : xml ? (readTsx(loaded) as TilesetJson as RawTileset) : (JSON.parse(loaded) as RawTileset);
      } catch (e) {
        parsed = null;
        why = `: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (parsed === null || typeof parsed !== "object") {
        note(`the tileset '${source}' cannot be read${why}, so none of its tiles is solid or drawn.`);
        tilesets.push({ firstGid: base, image: "", columns: 0, tileWidth: tilewidth, tileHeight: tileheight, margin: 0, spacing: 0 });
        continue;
      }
      body = { ...parsed, firstgid: base };
      folder = posix.dirname(source.split("\\").join("/"));
    }
    if (Array.isArray(body.tiles)) {
      for (const tile of body.tiles as { id?: unknown; properties?: unknown }[]) {
        if (typeof tile.id !== "number") continue;
        if (readProperties(tile.properties)["solid"] === true) solid.push(base + tile.id);
      }
    }
    const tileWidth = numOr(body.tilewidth, tilewidth);
    const tileHeight = numOr(body.tileheight, tileheight);
    const margin = numOr(body.margin, 0);
    const spacing = numOr(body.spacing, 0);
    let image = "";
    let columns = 0;
    if (typeof body.image === "string" && body.image !== "") {
      const fromMap = posix.normalize(posix.join(folder, body.image.split("\\").join("/")));
      const resolved = options.resolveImage === undefined ? fromMap : options.resolveImage(fromMap);
      if (resolved === null) note(`the tileset image '${fromMap}' (from the map's folder) is not in the assets folder, so a <Tilemap> without \`image\` cannot draw its tiles. Keep tile sheets in the assets folder.`);
      else image = resolved;
      columns = numOr(body.columns, 0);
      if (columns <= 0 && typeof body.imagewidth === "number") columns = Math.floor((body.imagewidth - 2 * margin + spacing) / (tileWidth + spacing));
    } else if (Array.isArray(body.tiles) && (body.tiles as { image?: unknown }[]).some((t) => typeof t.image === "string")) {
      note(`a tileset (first id ${base}) is a collection of images, which a <Tilemap> cannot draw from: make it one sheet, or give the <Tilemap> an \`image\`.`);
    }
    tilesets.push({ firstGid: base, image, columns, tileWidth, tileHeight, margin, spacing });
  }
  tilesets.sort((a, b) => a.firstGid - b.firstGid);
  const firstGid = tilesets[0]?.firstGid ?? 1;
  const properties = readProperties(map.properties);
  return { tilemap: { width, height, tileWidth: tilewidth, tileHeight: tileheight, firstGid, solid, layers, objects, tilesets, properties }, diagnostics };
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
    if (map.tilesets.length > 0) lines.push(`    tilesets: ${JSON.stringify(map.tilesets)},`);
    if (Object.keys(map.properties).length > 0) lines.push(`    properties: ${JSON.stringify(map.properties)},`);
    lines.push("  },");
  }
  lines.push("};", "", "registerTilemaps(tilemaps);", "");
  return lines.join("\n");
}
