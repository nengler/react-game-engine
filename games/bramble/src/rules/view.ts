/**
 * What the screen shows of a map, as plain lists: the compiler's lists come from state or props, not from a computation in a
 * component, so the rules make them and the game state holds them (`view`), updated when the run changes.
 */
import { TILE } from "./constants.ts";
import { MAPS } from "./maps.ts";
import { bushKey, type Run } from "./run.ts";

export interface Spot {
  readonly id: string;
  /** Top left of the thing's sprite, in map pixels. */
  readonly x: number;
  readonly y: number;
}

export interface View {
  readonly bushes: readonly Spot[];
  readonly doors: readonly Spot[];
  readonly gates: readonly Spot[];
  readonly shrines: readonly Spot[];
  readonly pickups: readonly Spot[];
  readonly npcs: readonly Spot[];
}

export function viewOf(run: Run): View {
  const def = MAPS[run.map];
  const bushes: Spot[] = [];
  def.rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "b" && !run.cut.includes(bushKey(run.map, c, r))) bushes.push({ id: `${c},${r}`, x: c * TILE, y: r * TILE });
    }
  });
  const at = (id: string, col: number, row: number, dx = 0, dy = 0): Spot => ({ id, x: col * TILE + dx, y: row * TILE + dy });
  return {
    bushes,
    doors: def.doors.map((d) => at(d.id, d.col, d.row)),
    gates: def.gate === undefined ? [] : [at("gate", def.gate.col, def.gate.row)],
    shrines: def.shrines.map((s) => at(s.id, s.col, s.row, 2, 2)),
    pickups: def.pickups.filter((p) => !run.taken.includes(p.id)).map((p) => at(p.id, p.col, p.row, 4, 4)),
    npcs: def.npcs.map((n) => at(n.id, n.col, n.row, 2, 1)),
  };
}
