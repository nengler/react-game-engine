import { GameObject } from "../GameObject.ts";

export interface TilemapProps {
  /** The name of a registered map (`registerTilemaps`), which is the Tiled file's name without `.tmj`. */
  map: string;
  /** The tile sheet: one image of equally sized tiles, read left to right, then down, the first being `firstGid` of the map. */
  image: string;
  /** Draw only this layer. Default: every layer Tiled shows. */
  layer?: string;
  /** Opacity, 0 to 1. Default 1. */
  opacity?: number;
}

/**
 * A grid of tiles drawn from a sheet, with no game object per tile: the player writes one record for each filled cell. The
 * data is a registered Tiled map; the same data, as a `TileGrid`, is what movement code asks which cells are solid. It is
 * placed by its `transform` like any object, at the map's top left. A leaf. The mock draws nothing.
 */
export class Tilemap<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  map: string;
  image: string;
  layer: string | undefined;
  opacity: number;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TilemapProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.map = hostProps.map;
    this.image = hostProps.image;
    this.layer = hostProps.layer;
    this.opacity = hostProps.opacity ?? 1;
  }
}
