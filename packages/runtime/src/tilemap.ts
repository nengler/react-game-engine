/**
 * Tile maps as data: what `rge-compile --scenes` writes for each Tiled map (`generated/tilemaps.ts`), and the grid the
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

export interface TilemapData {
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** The global id of the tile sheet's first tile. */
  readonly firstGid: number;
  /** The global ids of the tiles that are solid (the tile property `solid` in Tiled). */
  readonly solid: readonly number[];
  readonly layers: readonly TilemapLayerData[];
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
  if (grid === undefined) throw new Error(`No tilemap named '${name}' is registered (registered: ${[...registry.keys()].join(", ") || "none"}). Call registerTilemaps(tilemaps) with the compiler's generated table before the game starts.`);
  return grid;
}

/** The grid of a registered map, or undefined. */
export function findTilemap(name: string): TileGrid | undefined {
  return registry.get(name);
}
