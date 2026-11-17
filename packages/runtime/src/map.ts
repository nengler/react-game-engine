/**
 * The level as text: the tilemaps of a tree drawn one character a tile, with the game's things marked on it by letter. What an
 * agent reads to see where the walls, the road and the player are, without a screenshot (`tse session`'s `map`).
 *
 *     ................................
 *     ..........##########............
 *     ......B.........................
 *     ####...A.....##########.........
 *     ################################
 *     # solid  . empty
 *     A Player @(72,139)  B Gem @(64,112)
 *
 * Solid tiles (the Tiled property `solid`) are `#`; every other tile kind gets a symbol of its own, the most common first (`.`, so
 * the background is quiet), and the legend says which tile id each is. A thing is a compiled component that shows something of its
 * own (a sprite, a shape, a collider, a pointer); it is marked where its collider's middle is, else where it is.
 */
import { AnimatedSprite } from "./components/AnimatedSprite.ts";
import { Camera } from "./components/Camera.ts";
import { Collider } from "./components/Collider.ts";
import { Hud } from "./components/Hud.ts";
import { Pointer } from "./components/Pointer.ts";
import { Shape } from "./components/Shape.ts";
import { Sprite } from "./components/Sprite.ts";
import { Tilemap } from "./components/Tilemap.ts";
import { matchesQuery } from "./describe.ts";
import { GameObject } from "./GameObject.ts";
import { getGameTree } from "./gameTree.ts";
import { isComponent } from "./inspect.ts";
import { findTilemap } from "./tilemap.ts";

export interface MapOptions {
  /** The part of the world to draw, in pixels. Default: the tilemap that holds `around`. */
  readonly region?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /**
   * A component (by name or class name) the map is drawn around: the tilemap it stands on, or a region of `aroundSize` centred on it
   * when it is on none. Default: the first thing a `<Camera>` follows, else the first tilemap.
   */
  readonly around?: string;
  /** With `around` and no tilemap under it: the region's size in pixels. Default 320 × 180. */
  readonly aroundSize?: { readonly width: number; readonly height: number };
  /** The widest the map may be, in characters; larger regions put several tiles in one character. Default 120. */
  readonly maxColumns?: number;
  /** Mark the game's things on the map. Default true. */
  readonly things?: boolean;
}

interface PlacedMap {
  readonly tilemap: Tilemap;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Thing {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

const SYMBOLS = ".:-=~+*%o^&$";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const round = (n: number): number => Math.round(n * 10) / 10;

/** Every tilemap under `root` that names a registered map, with where it is in the world. */
function placedMaps(root: GameObject): PlacedMap[] {
  const out: PlacedMap[] = [];
  const visit = (object: GameObject): void => {
    if (object instanceof Hud) return;
    if (object instanceof Tilemap) {
      const grid = findTilemap(object.map);
      if (grid !== undefined) {
        const at = object.worldTransform();
        out.push({ tilemap: object, x: at.x, y: at.y, width: grid.width * grid.tileWidth, height: grid.height * grid.tileHeight });
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out;
}

/** Whether a component shows something of its own: a drawn or touchable built-in among its children, not inside another component. */
function showsItself(component: GameObject): boolean {
  const own = (object: GameObject): boolean => {
    for (const child of object.children) {
      if (isComponent(child)) continue;
      if (child instanceof Tilemap) return false;
      if (
        child instanceof Sprite ||
        child instanceof AnimatedSprite ||
        child instanceof Shape ||
        child instanceof Collider ||
        child instanceof Pointer
      )
        return true;
      if (own(child)) return true;
    }
    return false;
  };
  return own(component);
}

/** Where a thing is marked: its first own collider's (or pointer's) middle, else its world position. */
function markAt(component: GameObject): { x: number; y: number } {
  const find = (object: GameObject): GameObject | null => {
    for (const child of object.children) {
      if (isComponent(child)) continue;
      if (child instanceof Collider || child instanceof Pointer) return child;
      const deeper = find(child);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  const box = find(component);
  if (box !== null) {
    const at = box.worldTransform();
    const size = box as unknown as { width: number; height: number };
    return { x: at.x + size.width / 2, y: at.y + size.height / 2 };
  }
  const at = component.worldTransform();
  return { x: at.x, y: at.y };
}

/** The game's things, in tree order (outside any `<Hud>`, whose positions are on the screen, not in the world). */
function things(root: GameObject): { object: GameObject; thing: Thing }[] {
  const out: { object: GameObject; thing: Thing }[] = [];
  const visit = (object: GameObject): void => {
    if (object instanceof Hud) return;
    if (object !== root && isComponent(object) && showsItself(object)) {
      const at = markAt(object);
      const name = object.hotKey !== undefined ? `${object.constructor.name}[key=${String(object.hotKey)}]` : object.constructor.name;
      out.push({ object, thing: { name, x: round(at.x), y: round(at.y) } });
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return out;
}

/** The first thing a camera follows: the camera's first child that is a component, or one inside it. */
function followed(root: GameObject): GameObject | null {
  let found: GameObject | null = null;
  const visit = (object: GameObject, inCamera: boolean): void => {
    if (found !== null) return;
    if (inCamera && isComponent(object)) {
      found = object;
      return;
    }
    for (const child of object.children) visit(child, inCamera || object instanceof Camera);
  };
  visit(root, false);
  return found;
}

/** The region to draw: the one given, or the tilemap under the focus, or a box round it. */
function regionOf(root: GameObject, maps: readonly PlacedMap[], options: MapOptions): NonNullable<MapOptions["region"]> | string {
  if (options.region !== undefined) return options.region;
  let focus: GameObject | null = null;
  if (options.around !== undefined) {
    const visit = (object: GameObject): void => {
      if (focus !== null) return;
      if (matchesQuery(object, options.around as string)) focus = object;
      else for (const child of object.children) visit(child);
    };
    visit(root);
    if (focus === null) return `nothing called '${options.around}' is in the tree`;
  } else focus = followed(root);
  if (focus !== null) {
    const at = markAt(focus);
    const under = maps.find((m) => at.x >= m.x && at.x < m.x + m.width && at.y >= m.y && at.y < m.y + m.height);
    if (under !== undefined) return { x: under.x, y: under.y, width: under.width, height: under.height };
    const size = options.aroundSize ?? { width: 320, height: 180 };
    return { x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height };
  }
  const first = maps[0];
  if (first === undefined) return "there is no tilemap to draw; give a region";
  return { x: first.x, y: first.y, width: first.width, height: first.height };
}

/** What is at a point of the world: a solid tile (its ids noted in `solidIds`), the top drawn tile's id, or nothing. */
function tileAt(maps: readonly PlacedMap[], wx: number, wy: number, solidIds: Set<number>): number | "solid" | null {
  let found: number | "solid" | null = null;
  for (const m of maps) {
    if (wx < m.x || wx >= m.x + m.width || wy < m.y || wy >= m.y + m.height) continue;
    const grid = findTilemap(m.tilemap.map)!;
    const c = Math.floor((wx - m.x) / grid.tileWidth);
    const r = Math.floor((wy - m.y) / grid.tileHeight);
    if (grid.solidAt(c, r)) {
      for (const layer of grid.data.layers) {
        const id = layer.data[r * grid.width + c];
        if (id !== undefined && id !== 0 && grid.data.solid.includes(id)) solidIds.add(id);
      }
      return "solid";
    }
    if (found !== null) continue;
    // The top layer the tilemap draws that has a tile here.
    const layers = grid.data.layers.filter((l) => (m.tilemap.layer === undefined ? l.visible : l.name === m.tilemap.layer));
    for (let i = layers.length - 1; i >= 0; i--) {
      const id = layers[i]!.data[r * grid.width + c] ?? 0;
      if (id !== 0) {
        found = id;
        break;
      }
    }
  }
  return found;
}

/**
 * The tilemaps of the tree under `root` (default: the running game's) as text, with its things marked and a legend. See the file's
 * comment for what each character means.
 */
export function sceneMap(root: GameObject | null = getGameTree()?.root ?? null, options: MapOptions = {}): string {
  if (root === null) return "(no game)";
  const maps = placedMaps(root);
  const region = regionOf(root, maps, options);
  if (typeof region === "string") return `(no map: ${region})`;
  // A character is one tile of the first map in the region (or 8 pixels with none), more when the region is wide.
  const inRegion = maps.filter(
    (m) => m.x < region.x + region.width && m.x + m.width > region.x && m.y < region.y + region.height && m.y + m.height > region.y
  );
  const grid0 = inRegion[0] === undefined ? undefined : findTilemap(inRegion[0].tilemap.map);
  const tileW = grid0?.tileWidth ?? 8;
  const tileH = grid0?.tileHeight ?? 8;
  const maxColumns = options.maxColumns ?? 120;
  const scale = Math.max(1, Math.ceil(region.width / tileW / maxColumns));
  const cellW = tileW * scale;
  const cellH = tileH * scale;
  const columns = Math.max(1, Math.ceil(region.width / cellW));
  const rows = Math.max(1, Math.ceil(region.height / cellH));

  // What is in each cell: solid, a tile id, or nothing; and how common each id is, for its symbol.
  const cells: (number | "solid" | null)[] = new Array(columns * rows).fill(null);
  const counts = new Map<number, number>();
  const solidIds = new Set<number>();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      // Each tile under the character, sampled at its middle: solid when more than half are, else its most common tile.
      let solidCount = 0;
      const tiles = new Map<number, number>();
      for (let sy = 0; sy < scale; sy++)
        for (let sx = 0; sx < scale; sx++) {
          const wx = region.x + col * cellW + (sx + 0.5) * tileW;
          const wy = region.y + row * cellH + (sy + 0.5) * tileH;
          const tile = tileAt(inRegion, wx, wy, solidIds);
          if (tile === "solid") solidCount++;
          else if (tile !== null) tiles.set(tile, (tiles.get(tile) ?? 0) + 1);
        }
      let cell: number | "solid" | null = null;
      if (solidCount * 2 > scale * scale) cell = "solid";
      else {
        let best = 0;
        for (const [id, n] of tiles) if (n > best || (n === best && cell !== null && id < (cell as number))) [cell, best] = [id, n];
        if (cell === null && solidCount > 0) cell = "solid";
      }
      cells[row * columns + col] = cell;
      if (typeof cell === "number") counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
  }
  const byCount = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
  const symbolOf = new Map<number, string>();
  byCount.forEach((id, i) => symbolOf.set(id, SYMBOLS[i] ?? "?"));
  const lines: string[][] = [];
  for (let row = 0; row < rows; row++) {
    const line: string[] = [];
    for (let col = 0; col < columns; col++) {
      const cell = cells[row * columns + col];
      line.push(cell === "solid" ? "#" : cell === null || cell === undefined ? " " : (symbolOf.get(cell) ?? "?"));
    }
    lines.push(line);
  }

  // The things in the region, by letter; one off the map is listed, not drawn.
  const marks: string[] = [];
  const outside: string[] = [];
  if (options.things ?? true) {
    let next = 0;
    for (const { thing } of things(root)) {
      const col = Math.floor((thing.x - region.x) / cellW);
      const row = Math.floor((thing.y - region.y) / cellH);
      if (col < 0 || col >= columns || row < 0 || row >= rows) {
        outside.push(`${thing.name} @(${thing.x},${thing.y})`);
        continue;
      }
      const letter = LETTERS[next++] ?? "@";
      lines[row]![col] = letter;
      marks.push(`${letter} ${thing.name} @(${thing.x},${thing.y})`);
    }
  }

  const legend: string[] = [];
  if (solidIds.size > 0 || cells.includes("solid"))
    legend.push(`# solid${solidIds.size > 0 ? ` (tile ${[...solidIds].sort((a, b) => a - b).join(", ")})` : ""}`);
  for (const id of byCount) legend.push(`${symbolOf.get(id)} tile ${id}`);
  if (cells.includes(null)) legend.push("(space) no tile");
  const header = `region @(${round(region.x)},${round(region.y)}) ${round(region.width)}×${round(region.height)}, a character is ${cellW}×${cellH} px, y grows downward`;
  return [
    header,
    ...lines.map((line) => line.join("")),
    legend.join("  "),
    ...marks,
    ...(outside.length > 0 ? [`off this map: ${outside.join(", ")}`] : []),
  ].join("\n");
}
