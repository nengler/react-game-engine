import type { TileGrid } from "@rge/runtime";
import { TILE } from "./constants.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A polyline the enemies walk: where a distance along it is, and which way it is heading there. */
export interface Path {
  readonly points: readonly Point[];
  /** Distance from the start to each point. */
  readonly offsets: readonly number[];
  readonly length: number;
}

export function makePath(points: readonly Point[]): Path {
  if (points.length < 2) throw new Error("A path needs at least a start and an end.");
  const offsets: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    offsets.push((offsets[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, offsets, length: offsets[offsets.length - 1] as number };
}

export interface PathAt extends Point {
  /** The unit direction of the segment it is on. */
  readonly dx: number;
  readonly dy: number;
}

/** The position `distance` pixels along the path (clamped to its ends) and the direction of travel there. */
export function pathAt(path: Path, distance: number): PathAt {
  const d = Math.max(0, Math.min(distance, path.length));
  let i = 1;
  while (i < path.points.length - 1 && (path.offsets[i] as number) < d) i++;
  const a = path.points[i - 1] as Point;
  const b = path.points[i] as Point;
  const segment = (path.offsets[i] as number) - (path.offsets[i - 1] as number);
  const t = segment === 0 ? 0 : (d - (path.offsets[i - 1] as number)) / segment;
  const dx = segment === 0 ? 1 : (b.x - a.x) / segment;
  const dy = segment === 0 ? 0 : (b.y - a.y) / segment;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx, dy };
}

/** The global tile ids of `assets/tiles.png` that the map's Markers layer uses (tools/make-map.ts writes them). */
export const MARK = { pad: 10, spawn: 11, hearth: 12, waypoint: 20 } as const;

export interface PadSpot extends Point {
  readonly id: number;
}

export interface BattleMap {
  readonly path: Path;
  /** The build pads in reading order (top to bottom, left to right), numbered from 0. */
  readonly pads: readonly PadSpot[];
}

const centre = (col: number, row: number): Point => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

/**
 * Read the map's hidden `Markers` layer: `spawn` is the path's start, tiles `waypoint + n` are its corners in order (n = 0, 1, ...),
 * `hearth` is its end, and every `pad` is a place to build.
 */
export function readMap(grid: TileGrid): BattleMap {
  const spawn = grid.find("Markers", MARK.spawn)[0];
  const hearth = grid.find("Markers", MARK.hearth)[0];
  if (spawn === undefined) throw new Error(`The map has no spawn marker (tile ${MARK.spawn} on the Markers layer).`);
  if (hearth === undefined) throw new Error(`The map has no hearth marker (tile ${MARK.hearth} on the Markers layer).`);
  const corners: Point[] = [];
  for (let n = 0; ; n++) {
    const found = grid.find("Markers", MARK.waypoint + n)[0];
    if (found === undefined) break;
    corners.push(centre(found[0], found[1]));
  }
  const pads = grid.find("Markers", MARK.pad).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([col, row], id) => ({ id, ...centre(col, row) }));
  return { path: makePath([centre(spawn[0], spawn[1]), ...corners, centre(hearth[0], hearth[1])]), pads };
}
