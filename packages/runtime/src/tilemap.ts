/**
 * Tile maps as data: what `tse-compile --scenes` writes for each Tiled map (`generated/tilemaps.ts`), and the grid the
 * movement code of a game asks about. The data is plain numbers, so it is the same under Node and QuickJS.
 */

/** Bits Tiled keeps in the top of a tile's global id: which way the tile is mirrored. */
export const TILE_FLIP_H = 1;
export const TILE_FLIP_V = 2;
/** Mirrored across the diagonal: Tiled applies this first, then the horizontal and vertical flips. */
export const TILE_FLIP_D = 4;

export interface TilemapLayerData {
  readonly name: string;
  /** Whether the layer is shown in Tiled. A hidden layer is not drawn (the grid can still be asked about it). */
  readonly visible: boolean;
  /** One global tile id per cell, row by row, 0 for an empty cell, with the flip bits taken off. */
  readonly data: readonly number[];
  /** The flip bits of each cell (`TILE_FLIP_*`), when any cell has them. */
  readonly flips?: readonly number[];
}

/** A Tiled object as data for the rules: a door, a person, a spawn. Position and size in pixels of the map. */
export interface TilemapObject {
  readonly id: number;
  readonly name: string;
  /** Tiled's "Class" (or "Type") field. */
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The object's custom properties. */
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

/**
 * One tileset of a map: its sheet and how the sheet is cut. A cell's tile belongs to the tileset with the largest `firstGid` not
 * above the cell's global id, as in Tiled.
 */
export interface TilesetData {
  /** The global id of the sheet's first tile. */
  readonly firstGid: number;
  /** The sheet, as a name in the assets folder (what `<Sprite image>` takes). Empty when it is not there, or the tileset is a collection of images. */
  readonly image: string;
  /** Tiles across the sheet. */
  readonly columns: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Pixels round the edge of the sheet, and between tiles. */
  readonly margin: number;
  readonly spacing: number;
}

export interface TilemapData {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** The global id of the first tileset's first tile: where a sheet given as `<Tilemap image>` starts. */
  readonly firstGid: number;
  /** The global ids of the tiles that are solid (the tile property `solid` in Tiled). */
  readonly solid: readonly number[];
  readonly layers: readonly TilemapLayerData[];
  /** The objects of the map's visible object layers, in file order. Absent when there are none. */
  readonly objects?: readonly TilemapObject[];
  /** The map's tilesets, in order of `firstGid`: what a `<Tilemap>` with no `image` draws from. Absent in maps written by hand. */
  readonly tilesets?: readonly TilesetData[];
  /** The map's own custom properties (Map → Map Properties in Tiled). Absent when there are none. */
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

/** A map's cells, asked about by column and row or by pixel. Reading outside the map gives an empty cell, not an error. */
export class TileGrid {
  readonly data: TilemapData;
  readonly #solid: ReadonlySet<number>;

  constructor(data: TilemapData) {
    this.data = data;
    this.#solid = new Set(data.solid);
  }

  get width(): number {
    return this.data.width;
  }
  get height(): number {
    return this.data.height;
  }
  get tileWidth(): number {
    return this.data.tileWidth;
  }
  get tileHeight(): number {
    return this.data.tileHeight;
  }

  /** One of the map's custom properties, or undefined. */
  property(name: string): string | number | boolean | undefined {
    return this.data.properties?.[name];
  }

  /** The map's objects, all of them or only those of one `type` (Tiled's Class). */
  objects(type?: string): readonly TilemapObject[] {
    const all = this.data.objects ?? [];
    return type === undefined ? all : all.filter((o) => o.type === type);
  }

  layer(name: string): TilemapLayerData | undefined {
    return this.data.layers.find((layer) => layer.name === name);
  }

  /** The global tile id at a cell of a layer (0 when empty or outside the map, or when the layer does not exist). */
  tileAt(layer: string, col: number, row: number): number {
    const l = this.layer(layer);
    if (l === undefined || !(col >= 0 && col < this.data.width && row >= 0 && row < this.data.height)) return 0;
    return l.data[Math.floor(row) * this.data.width + Math.floor(col)] ?? 0;
  }

  /** Is any layer's tile at this cell one marked solid? Outside the map nothing is. */
  solidAt(col: number, row: number): boolean {
    if (!(col >= 0 && col < this.data.width && row >= 0 && row < this.data.height)) return false;
    const index = Math.floor(row) * this.data.width + Math.floor(col);
    for (const layer of this.data.layers) {
      const gid = layer.data[index];
      if (gid !== undefined && gid !== 0 && this.#solid.has(gid)) return true;
    }
    return false;
  }

  /** `solidAt` for the cell that holds a pixel of the map (x to the right, y down from the map's top left). */
  solidAtPixel(x: number, y: number): boolean {
    return this.solidAt(Math.floor(x / this.data.tileWidth), Math.floor(y / this.data.tileHeight));
  }

  /** The cells of a layer holding a tile, as `[col, row, gid]`: how a game finds its spawn points and markers. */
  find(layer: string, gid: number): [number, number, number][] {
    const l = this.layer(layer);
    const out: [number, number, number][] = [];
    if (l === undefined) return out;
    for (let i = 0; i < l.data.length; i++) if (l.data[i] === gid) out.push([i % this.data.width, Math.floor(i / this.data.width), gid]);
    return out;
  }
}

const registry = new Map<string, TileGrid>();

/** Make maps known by name, for `<Tilemap map="…">` and `getTilemap`. A game does this once at start, with the generated `tilemaps` table. */
export function registerTilemaps(maps: Readonly<Record<string, TilemapData>>): void {
  for (const [name, data] of Object.entries(maps)) registry.set(name, new TileGrid(data));
}

/** The grid of a registered map. Throws, naming the maps there are, for a name that was never registered. */
export function getTilemap(name: string): TileGrid {
  const grid = registry.get(name);
  if (grid === undefined)
    throw new Error(
      `No tilemap named '${name}' is registered (registered: ${[...registry.keys()].join(", ") || "none"}). Call registerTilemaps(tilemaps) with the compiler's generated table before the game starts.`
    );
  return grid;
}

/** The grid of a registered map, or undefined. */
export function findTilemap(name: string): TileGrid | undefined {
  return registry.get(name);
}
