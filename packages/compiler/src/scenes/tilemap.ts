/**
 * Tiled map (`.tmj`) → the data of a `<Tilemap>`: the tile layers (global tile ids with the flip bits split off, and whether the
 * layer is shown), the size of a cell, and which tiles are solid (the tile property `solid`, from an embedded tileset). Object
 * layers are the scene importer's business (`importTiled`); a map can have both.
 *
 * What it reads: JSON maps with plain (CSV) tile data, finite (not infinite) maps, and one embedded tileset. What it does not:
 * base64 or compressed layers, infinite maps, external tilesets (the tiles are drawn but none is solid) and more than one tileset
 * (only the first is used); each of these says so rather than being quietly wrong.
 */
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

export interface TilemapOut {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly firstGid: number;
  readonly solid: readonly number[];
  readonly layers: readonly TilemapLayerOut[];
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

export function importTilemap(fileName: string, text: string): TilemapImport {
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
    if (typeof layer.data === "string" || layer.encoding === "base64" || layer.compression !== undefined) {
      fail(`tile layer '${name}' is stored as ${layer.encoding === "base64" ? "base64" : "compressed or text"} data, which the importer does not read: set the map's Tile Layer Format to CSV in Tiled.`);
      return;
    }
    if (!Array.isArray(layer.data) || layer.data.length === 0) return; // an empty layer (as in a map made for objects only)
    if (layer.data.length !== width * height) {
      fail(`tile layer '${name}' has ${layer.data.length} cells, but the map is ${width} × ${height} = ${width * height}.`);
      return;
    }
    const data: number[] = new Array<number>(layer.data.length);
    const flips: number[] = new Array<number>(layer.data.length).fill(0);
    let flipped = false;
    for (let i = 0; i < layer.data.length; i++) {
      const raw = layer.data[i];
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
  if (layers.length === 0 || diagnostics.some((d) => d.severity === "error")) return { tilemap: null, diagnostics };

  // The first tileset: where its ids start, and which of its tiles have the property `solid`.
  const tilesets = Array.isArray(map.tilesets) ? (map.tilesets as RawTileset[]) : [];
  const first = tilesets[0];
  const firstGid = first !== undefined && typeof first.firstgid === "number" ? first.firstgid : 1;
  if (tilesets.length > 1) note(`the map has ${tilesets.length} tilesets: only the first is used, so tiles of the others are drawn from the wrong sheet. Put all the tiles in one tileset.`);
  const solid: number[] = [];
  if (first !== undefined && first.source !== undefined) note(`the tileset is external ('${String(first.source)}'), so its tile properties cannot be read and no tile is solid. Embed the tileset in the map.`);
  if (first !== undefined && Array.isArray(first.tiles)) {
    for (const tile of first.tiles as { id?: unknown; properties?: unknown }[]) {
      if (typeof tile.id !== "number" || !Array.isArray(tile.properties)) continue;
      for (const property of tile.properties as { name?: unknown; value?: unknown }[]) {
        if (property.name === "solid" && property.value === true) solid.push(firstGid + tile.id);
      }
    }
  }
  return { tilemap: { width, height, tileWidth: tilewidth, tileHeight: tileheight, firstGid, solid, layers }, diagnostics };
}

/** The text of `generated/tilemaps.ts` for the maps found, by name: the table `registerTilemaps` takes. */
export function tilemapsSource(maps: ReadonlyMap<string, TilemapOut>, fromDir: string): string {
  const lines: string[] = [
    `// Generated by @rge/compiler from the Tiled maps in ${fromDir}. Do not edit.`,
    `import type { TilemapData } from "@rge/runtime";`,
    "",
    "/** Every map's tile layers and solid tiles, by the map's file name: pass it to `registerTilemaps` before the game starts. */",
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
    lines.push("    ],", "  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}
