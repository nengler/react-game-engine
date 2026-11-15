/**
 * Input scripts made from routes through the world. A route is a list of legs, each walked with the rules (`step`) until it is
 * done, and what was held is written as the player's input script (`right*48, up*9, …`): the replay format `tse screenshot` and
 * the player take. Walking is by axis, to exact pixels, so a leg that does not get there (a wall in the way) throws here
 * instead of producing a script that wanders.
 */
import { bodyAt, newRun, step, type Run } from "../src/rules/run.ts";

export type Leg =
  | { readonly x: number }
  | { readonly y: number }
  | { readonly raw: string }
  /** Hold a direction for some frames (each of -1, 0, 1): turning to face something. */
  | { readonly hold: readonly [number, number]; readonly frames: number }
  /** Hold a direction until the map changes or the game ends (through a door or the gate). */
  | { readonly through: readonly [number, number] }
  /** Press the action, then a frame of nothing. */
  | { readonly action: true };

export function route(legs: readonly Leg[], from: Run = newRun()): { readonly script: string; readonly run: Run } {
  let run = from;
  const parts: string[] = [];
  const walk = (axis: "x" | "y", target: number): void => {
    const dir = Math.sign(target - run[axis]);
    if (dir === 0) return;
    const name = axis === "x" ? (dir > 0 ? "right" : "left") : dir > 0 ? "down" : "up";
    let frames = 0;
    let still = 0;
    while (dir > 0 ? run[axis] < target : run[axis] > target) {
      const before = run[axis];
      run = step(run, { dx: axis === "x" ? dir : 0, dy: axis === "y" ? dir : 0, action: false }, 1 / 60).run;
      frames++;
      still = run[axis] === before ? still + 1 : 0;
      if (still > 10) throw new Error(`the route is stuck going ${name} to ${target} at ${run.x},${run.y}`);
    }
    parts.push(`${name}*${frames}`);
  };
  for (const leg of legs) {
    if ("x" in leg) walk("x", leg.x);
    else if ("y" in leg) walk("y", leg.y);
    else if ("hold" in leg) {
      for (let i = 0; i < leg.frames; i++) run = step(run, { dx: leg.hold[0], dy: leg.hold[1], action: false }, 1 / 60).run;
      parts.push(`${leg.hold[0] === 0 ? (leg.hold[1] > 0 ? "down" : "up") : leg.hold[0] > 0 ? "right" : "left"}*${leg.frames}`);
    } else if ("through" in leg) {
      const map = run.map;
      let frames = 0;
      while (run.map === map && !run.done && frames < 120) {
        run = step(run, { dx: leg.through[0], dy: leg.through[1], action: false }, 1 / 60).run;
        frames++;
      }
      if (run.map === map && !run.done) throw new Error(`holding ${leg.through} did not go through anything`);
      parts.push(`${leg.through[0] === 0 ? (leg.through[1] > 0 ? "down" : "up") : leg.through[0] > 0 ? "right" : "left"}*${frames}`);
    } else if ("action" in leg) {
      run = step(step(run, { dx: 0, dy: 0, action: true }, 1 / 60).run, { dx: 0, dy: 0, action: false }, 1 / 60).run;
      parts.push("Z, _");
    } else parts.push(leg.raw);
  }
  return { script: parts.join(", "), run };
}

const tile = (col: number, row: number) => bodyAt(col, row);

/**
 * From the start: pick up the lantern, talk to the guide through her pages, walk round the cave's walls and go in through its
 * door. (The raw legs are plain input script: a press needs a frame of its own between presses.)
 */
export const TO_THE_CAVE: readonly Leg[] = [
  { x: tile(9, 43).x },
  { y: tile(9, 40).y },
  { x: tile(12, 40).x },
  { raw: "down*6, Z, _, Z, _, Z, _, Z, _, Z, _" },
  { x: tile(73, 40).x },
  { y: tile(73, 45).y },
  { x: tile(68, 45).x },
  { raw: "up*40, _*5" },
];
