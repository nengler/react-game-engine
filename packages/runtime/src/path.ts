/**
 * Finding a way across a grid of tiles: `findPath` (A*) and `lineOfSight`. Plain functions for a game's rules. What is solid is the
 * grid's (`solidAt`, which a `TileGrid` has) or the game's (`options.blocked`, which is asked instead, for cells a map does not
 * know about: a bush, a person).
 */

/** A cell of the grid, by column and row. */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

/** A point in pixels. */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
}

/** What the search needs of a map: its size in cells, and (unless `blocked` is given) which cells are solid. A `TileGrid` is one. */
export interface PathGrid {
  readonly width: number;
  readonly height: number;
  readonly tileWidth?: number;
  readonly tileHeight?: number;
  solidAt?(col: number, row: number): boolean;
}

export interface PathOptions {
  /** Allow diagonal steps (never cutting a solid corner). Default false. */
  readonly diagonal?: boolean;
  /** Give up after expanding this many cells: null comes back. Default 20000. */
  readonly maxNodes?: number;
  /** Is the cell blocked, replacing the grid's own `solidAt`. */
  readonly blocked?: (x: number, y: number) => boolean;
}

const DEFAULT_MAX_NODES = 20000;
const SQRT2 = Math.SQRT2;

/**
 * The shortest path from one cell to another, as the cells to walk through from the one after `from` to `to` (empty when they are
 * the same cell), or null when there is none, when either end is outside the grid or blocked, or when `maxNodes` ran out.
 *
 * A* with a binary heap. Ties are broken by a fixed order (lower cost first, then the cell that was found first), and neighbours
 * are visited in a fixed order, so the same search gives the same path under any engine. Costs are 1 for a step and √2 for a
 * diagonal one.
 */
export function findPath(grid: PathGrid, from: Cell, to: Cell, options: PathOptions = {}): Cell[] | null {
  const { width, height } = grid;
  const diagonal = options.diagonal ?? false;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const solid = options.blocked ?? ((x: number, y: number) => grid.solidAt?.(x, y) ?? false);
  const inside = (x: number, y: number): boolean => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(from.x, from.y) || !inside(to.x, to.y) || solid(from.x, from.y) || solid(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const size = width * height;
  const cost = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const order = new Float64Array(size); // when a cell was first reached, to break ties
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const heuristic = (i: number): number => {
    const dx = Math.abs((i % width) - to.x);
    const dy = Math.abs(Math.floor(i / width) - to.y);
    return diagonal ? Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
  };

  // A binary heap of [priority, order, cell], smallest first.
  const heap: number[] = [];
  const less = (a: number, b: number): boolean => (heap[a * 3] as number) < (heap[b * 3] as number) || ((heap[a * 3] as number) === (heap[b * 3] as number) && (heap[a * 3 + 1] as number) < (heap[b * 3 + 1] as number));
  const swap = (a: number, b: number): void => {
    for (let k = 0; k < 3; k++) {
      const t = heap[a * 3 + k] as number;
      heap[a * 3 + k] = heap[b * 3 + k] as number;
      heap[b * 3 + k] = t;
    }
  };
  let count = 0;
  const push = (priority: number, tie: number, cell: number): void => {
    heap.push(priority, tie, cell);
    let i = count++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!less(i, up)) break;
      swap(i, up);
      i = up;
    }
  };
  const pop = (): number => {
    const cell = heap[2] as number;
    count--;
    if (count > 0) {
      for (let k = 0; k < 3; k++) heap[k] = heap[count * 3 + k] as number;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < count && less(l, m)) m = l;
        if (r < count && less(r, m)) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    heap.length = count * 3;
    return cell;
  };

  // Right, down, left, up, then the diagonals: a fixed order.
  const steps: readonly (readonly [number, number])[] = diagonal
    ? [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]
    : [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let serial = 0;
  cost[start] = 0;
  push(heuristic(start), serial++, start);
  let expanded = 0;
  while (count > 0) {
    const current = pop();
    if (closed[current] === 1) continue;
    closed[current] = 1;
    if (current === goal) {
      const path: Cell[] = [];
      for (let c = goal; c !== start; c = parent[c] as number) path.push({ x: c % width, y: Math.floor(c / width) });
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy] of steps) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(nx, ny) || solid(nx, ny)) continue;
      // A diagonal step never cuts a solid corner: both cells it passes beside must be open.
      if (dx !== 0 && dy !== 0 && (solid(cx + dx, cy) || solid(cx, cy + dy))) continue;
      const next = ny * width + nx;
      if (closed[next] === 1) continue;
      const through = (cost[current] as number) + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (through < (cost[next] as number)) {
        cost[next] = through;
        parent[next] = current;
        order[next] = serial;
        push(through + heuristic(next), serial++, next);
      }
    }
  }
  return null;
}

/**
 * Can a straight line from one point to another (pixels) cross the grid without touching a solid cell? Walks the cells the line passes
 * through (a grid traversal, so it misses none). A point inside a solid cell sees nothing. The tile size comes from the grid
 * (16 when it does not say).
 */
export function lineOfSight(grid: PathGrid, from: PathPoint, to: PathPoint, blocked?: (x: number, y: number) => boolean): boolean {
  const tw = grid.tileWidth ?? 16;
  const th = grid.tileHeight ?? 16;
  const solid = blocked ?? ((x: number, y: number) => grid.solidAt?.(x, y) ?? false);
  let cx = Math.floor(from.x / tw);
  let cy = Math.floor(from.y / th);
  const ex = Math.floor(to.x / tw);
  const ey = Math.floor(to.y / th);
  if (solid(cx, cy) || solid(ex, ey)) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Distance along the line (0 to 1) to the next vertical and horizontal cell edge, and between edges.
  let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? (cx + 1) * tw : cx * tw) - from.x) / dx;
  let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? (cy + 1) * th : cy * th) - from.y) / dy;
  const tDeltaX = dx === 0 ? Infinity : tw / Math.abs(dx);
  const tDeltaY = dy === 0 ? Infinity : th / Math.abs(dy);
  let guard = Math.abs(ex - cx) + Math.abs(ey - cy) + 2;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      cy += stepY;
      tMaxY += tDeltaY;
    } else {
      // Exactly through a corner: both neighbours must be open for the line to pass.
      if (solid(cx + stepX, cy) || solid(cx, cy + stepY)) return false;
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    if (solid(cx, cy)) return false;
  }
  return true;
}
