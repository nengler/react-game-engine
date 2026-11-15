/**
 * The whole game as one route: the legs that take the character from the title to the gate with three bells. The legs are not
 * written by hand: each stretch is planned with the engine's `findPath` over the map's open cells (people and doors are walls, the
 * way the character's own movement treats them), then walked by `route`, which simulates it with the rules and writes down what was
 * held. The route is made with no enemies (the replay of the whole game is about the world; enemies have their own tests).
 */
import { findPath } from "@rge/runtime";

import { cellAt, findDoor, MAPS, type MapId } from "../src/rules/maps.ts";
import { bodyAt, bushKey, newRun, type Run } from "../src/rules/run.ts";
import { route, type Leg } from "./replays.ts";

interface Cell {
  readonly x: number;
  readonly y: number;
}

/** Legs that walk from the cell the character is in to `to` on this map, round walls, water, people and the other doors. */
function walkTo(run: Run, to: Cell): Leg[] {
  const def = MAPS[run.map];
  const from = { x: Math.floor((run.x + 5) / 16), y: Math.floor((run.y + 5) / 16) };
  const solid = (x: number, y: number): boolean => {
    const ch = cellAt(run.map, x, y);
    if (ch === "#" || ch === "~" || (ch === "b" && !run.cut.includes(bushKey(run.map, x, y))))
      return !(x === to.x && y === to.y && def.doors.some((d) => d.col === x && d.row === y));
    return def.npcs.some((n) => n.col === x && n.row === y);
  };
  const doorCells = def.doors.filter((d) => !(d.col === to.x && d.row === to.y));
  const path = findPath({ width: def.rows[0]!.length, height: def.rows.length }, from, to, {
    blocked: (x, y) => solid(x, y) || doorCells.some((d) => d.col === x && d.row === y),
  });
  if (path === null) throw new Error(`no way on ${run.map} from ${from.x},${from.y} to ${to.x},${to.y}`);
  const legs: Leg[] = [];
  for (const cell of path) {
    const at = bodyAt(cell.x, cell.y);
    legs.push({ x: at.x }, { y: at.y });
  }
  return legs;
}

/** The pickup's cell on a map. */
const pickupCell = (map: MapId, id: string): Cell => {
  const p = MAPS[map].pickups.find((q) => q.id === id)!;
  return { x: p.col, y: p.row };
};

/** A segment: plan from where the run is, walk it, and carry on from where it ends. */
function segment(run: Run, to: Cell, legsAfter: Leg[] = []): { script: string; run: Run } {
  const walked = route([...walkTo(run, to), ...legsAfter], run);
  return walked;
}

/** The whole game, from the title's first press (not included) to the gate. Returns the input script and the run it ends in. */
export function fullRun(): { script: string; run: Run } {
  let run: Run = { ...newRun(), enemies: [] };
  const scripts: string[] = [];
  const go = (to: Cell, after: Leg[] = []): void => {
    const r = segment(run, to, after);
    scripts.push(r.script);
    run = { ...r.run, enemies: [] };
  };
  /** Walk to the cell outside a door, then hold towards it until the map changes. */
  const through = (map: MapId, id: string): void => {
    const d = findDoor(map, id);
    go({ x: d.col + d.out[0], y: d.row + d.out[1] }, [{ through: [-d.out[0], -d.out[1]] }]);
  };
  go(pickupCell("overworld", "lantern"));
  through("overworld", "cave"); // the cave: the lantern lights it
  go(pickupCell("cave", "key"));
  go(pickupCell("cave", "bell-cave"));
  through("cave", "cave-exit");
  through("overworld", "house"); // the key opens it
  go(pickupCell("house", "shears"));
  go(pickupCell("house", "bell-house"));
  through("house", "house-exit");
  through("overworld", "maze");
  // The maze: walk to the bush's foot, face it, cut it, and the way to the bell is open.
  go({ x: 14, y: 4 }, [{ hold: [0, -1], frames: 2 }, { action: true }]);
  go(pickupCell("maze", "bell-maze"));
  through("maze", "maze-exit");
  const gate = MAPS.overworld.gate!;
  go({ x: gate.col, y: gate.row + 1 }, [{ through: [0, -1] }]);
  return { script: scripts.join(", "), run };
}
