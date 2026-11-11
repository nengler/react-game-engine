/**
 * Input scripts made from routes through the world. A route is a list of legs, each walked with the rules (`step`) until it is
 * done, and what was held is written as the player's input script (`right*48, up*9, …`): the replay format `rge screenshot` and
 * the player take. Walking is by axis, to exact pixels, so a leg that does not get there (a wall in the way) throws here
 * instead of producing a script that wanders.
 */
import { bodyAt, newRun, step, type Run } from "../src/rules/run.ts";

type Leg = { readonly x: number } | { readonly y: number } | { readonly raw: string };

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
    else parts.push(leg.raw);
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
  { raw: "down*6, Z, _, Z, _, Z, _" },
  { x: tile(73, 40).x },
  { y: tile(73, 45).y },
  { x: tile(68, 45).x },
  { raw: "up*40, _*5" },
];
