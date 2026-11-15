/**
 * Run the frame bench (`packages/player/bench/frame.ts`) and fail when a scene is over its budget in
 * `packages/player/bench/budget.json`:
 *
 *   npm run bench:check
 *
 * It runs under Node, the engine games ship with. Budgets are generous (about 2.5 to 3 times today's numbers) so that a slower CI runner passes; the size ratios in the
 * same file do not depend on the machine at all, and catch an algorithm that turns quadratic. Exits 1 on any failure,
 * and also when a budgeted scene is missing from the bench's output (a scene renamed without its budget).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Ratio {
  readonly larger: string;
  readonly smaller: string;
  readonly "at most": number;
}
interface Budget {
  readonly node: Record<string, number>;
  readonly ratios: readonly Ratio[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bench = resolve(root, "packages/player/bench/frame.ts");
const budget = JSON.parse(readFileSync(resolve(root, "packages/player/bench/budget.json"), "utf8")) as Budget;

/** `name : 1.23 ms ...` lines of the bench's output, by name. */
function parse(output: string): Map<string, number> {
  const results = new Map<string, number>();
  for (const line of output.split("\n")) {
    const match = /^(\S.*?)\s*: ([\d.]+) ms/.exec(line);
    if (match) results.set(match[1] as string, Number(match[2]));
  }
  return results;
}

let failures = 0;

function check(engine: string, output: string, results: Map<string, number>, budgets: Record<string, number>): void {
  console.log(`--- ${engine} ---`);
  console.log(output.trimEnd());
  console.log(`\n${"scene".padEnd(45)} ${"ms".padStart(8)} ${"budget".padStart(8)}`);
  for (const [scene, limit] of Object.entries(budgets)) {
    const ms = results.get(scene);
    const ok = ms !== undefined && ms <= limit;
    if (!ok) failures++;
    console.log(
      `${scene.padEnd(45)} ${(ms === undefined ? "missing" : ms.toFixed(2)).padStart(8)} ${limit.toFixed(2).padStart(8)}${ok ? "" : "   FAIL"}`
    );
  }
  for (const ratio of budget.ratios) {
    const larger = results.get(ratio.larger);
    const smaller = results.get(ratio.smaller);
    if (larger === undefined || smaller === undefined) {
      failures++;
      console.log(`${ratio.larger} / ${ratio.smaller}: missing   FAIL`);
      continue;
    }
    // A scene too quick to time (under a millisecond on a fast engine) says nothing about how it grows.
    if (smaller < 1) continue;
    const value = larger / smaller;
    const ok = value <= ratio["at most"];
    if (!ok) failures++;
    console.log(
      `${`${ratio.larger} / ${ratio.smaller}`.padEnd(62)} ${value.toFixed(1).padStart(5)}x (at most ${ratio["at most"]}x)${ok ? "" : "   FAIL"}`
    );
  }
  console.log();
}

const run = (command: string, commandArgs: string[]): string =>
  execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });

/**
 * A shared runner has noisy neighbours, and a scene that takes hundredths of a millisecond can be slowed several times over by
 * one. Slowness from noise does not repeat, a real regression does: so a failing run is measured again (up to twice), keeping each
 * scene's best time, and only a scene that is over budget every time fails.
 */
const attempts = 3;
let output = run(process.execPath, [bench]);
let results = parse(output);
for (let attempt = 1; attempt < attempts; attempt++) {
  const over = Object.entries(budget.node).some(([scene, limit]) => (results.get(scene) ?? Infinity) > limit);
  if (!over) break;
  console.log(`Over budget; measuring again (${attempt + 1} of ${attempts}), keeping the best time per scene.\n`);
  output = run(process.execPath, [bench]);
  for (const [scene, ms] of parse(output)) results.set(scene, Math.min(ms, results.get(scene) ?? Infinity));
}

check("Node", output, results, budget.node);

if (failures > 0) {
  console.error(
    `${failures} bench check(s) failed. If a change made a scene slower on purpose, raise its budget in packages/player/bench/budget.json and say why.`
  );
  process.exit(1);
}
console.log("All bench scenes are within budget.");
