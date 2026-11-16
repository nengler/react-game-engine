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
  const inside = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  if (!inside(from.x, from.y) || !inside(to.x, to.y) || solid(from.x, from.y) || solid(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const size = width * height;
  const cost = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  // What `solid` said of each cell: 0 not asked yet, 1 open, 2 solid. A cell is asked once, however many neighbours look at it.
  const known = new Uint8Array(size);
  const blockedAt = (x: number, y: number): boolean => {
    const i = y * width + x;
    let k = known[i] as number;
    if (k === 0) known[i] = k = solid(x, y) ? 2 : 1;
    return k === 2;
  };
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const tx = to.x;
  const ty = to.y;

  // A binary heap of (priority, tie, cell), smallest priority first and then smallest tie (the order cells were reached in), in
  // three typed arrays. A cell is pushed at most once per time its cost drops, so 8 pushes a cell is room enough; it grows if not.
  let capacity = 64;
  let hp = new Float64Array(capacity);
  let ht = new Float64Array(capacity);
  let hc = new Int32Array(capacity);
  let count = 0;
  const push = (priority: number, tie: number, cell: number): void => {
    if (count === capacity) {
      capacity *= 2;
      const p2 = new Float64Array(capacity);
      const t2 = new Float64Array(capacity);
      const c2 = new Int32Array(capacity);
      p2.set(hp);
      t2.set(ht);
      c2.set(hc);
      hp = p2;
      ht = t2;
      hc = c2;
    }
    let i = count++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      const upP = hp[up] as number;
      if (upP < priority || (upP === priority && (ht[up] as number) < tie)) break;
      hp[i] = upP;
      ht[i] = ht[up] as number;
      hc[i] = hc[up] as number;
      i = up;
    }
    hp[i] = priority;
    ht[i] = tie;
    hc[i] = cell;
  };
  const pop = (): number => {
    const cell = hc[0] as number;
    count--;
    if (count > 0) {
      const p = hp[count] as number;
      const t = ht[count] as number;
      const c = hc[count] as number;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= count) break;
        const r = l + 1;
        let m = l;
        if (r < count) {
          const lp = hp[l] as number;
          const rp = hp[r] as number;
          if (rp < lp || (rp === lp && (ht[r] as number) < (ht[l] as number))) m = r;
        }
        const mp = hp[m] as number;
        if (p < mp || (p === mp && t < (ht[m] as number))) break;
        hp[i] = mp;
        ht[i] = ht[m] as number;
        hc[i] = hc[m] as number;
        i = m;
      }
      hp[i] = p;
      ht[i] = t;
      hc[i] = c;
    }
    return cell;
  };
  const heuristic = (x: number, y: number): number => {
    const dx = x > tx ? x - tx : tx - x;
    const dy = y > ty ? y - ty : ty - y;
    return diagonal ? (dx > dy ? dx : dy) + (SQRT2 - 1) * (dx < dy ? dx : dy) : dx + dy;
  };

  // Right, down, left, up, then the diagonals: a fixed order.
  const stepX = STEP_X;
  const stepY = STEP_Y;
  const directions = diagonal ? 8 : 4;
  let serial = 0;
  cost[start] = 0;
  push(heuristic(from.x, from.y), serial++, start);
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
    const cy = (current - cx) / width;
    const here = cost[current] as number;
    for (let d = 0; d < directions; d++) {
      const dx = stepX[d] as number;
      const dy = stepY[d] as number;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || blockedAt(nx, ny)) continue;
      // A diagonal step never cuts a solid corner: both cells it passes beside must be open.
      if (d >= 4 && (blockedAt(nx, cy) || blockedAt(cx, ny))) continue;
      const next = ny * width + nx;
      if (closed[next] === 1) continue;
      const through = here + (d >= 4 ? SQRT2 : 1);
      if (through < (cost[next] as number)) {
        cost[next] = through;
        parent[next] = current;
        push(through + heuristic(nx, ny), serial++, next);
      }
    }
  }
  return null;
}

/** The steps `findPath` tries, in its fixed order: right, down, left, up, then down-right, down-left, up-left, up-right. */
const STEP_X = [1, 0, -1, 0, 1, -1, -1, 1];
const STEP_Y = [0, 1, 0, -1, 1, 1, -1, -1];

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
