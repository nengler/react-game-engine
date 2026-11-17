/**
 * Script time of a step, on a recording backend (drawing in libtse is not in it). Two ways:
 *
 *   node games/swarm/tools/frame-time.ts                    the replay: a scripted run, timed while it lasts
 *   node games/swarm/tools/frame-time.ts --count 1500       the stress scene: 1,500 enemies kept alive round a walking player
 *   node games/swarm/tools/frame-time.ts --count 1500 --armed   the same, with every weapon at its last level
 *
 * It prints one line of JSON: the steps timed, the mean, the 99th percentile and the slowest, and how many enemies, bolts and gems
 * there were at the busiest step. A stress run skips the first 120 steps (the crowd filling up, and V8 warming up).
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@tsengine/player";
import { startProfiling, stopProfiling, type Profiler } from "@tsengine/runtime";

import { bindings, gameConfig, screen } from "../game.ts";
import { Stress } from "../generated/Stress.ts";
import { walk } from "../test/replays.ts";
import { findPlay, runOf } from "../test/run-state.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--count");
const count = at >= 0 ? Number(args[at + 1]) : 0;
const armed = args.includes("--armed");
/** `--profile`: also print each phase's milliseconds a step and the costliest components (the inspector's profiler). */
const profile = args.includes("--profile");
let profiler: Profiler | null = null;
const secondsAt = args.indexOf("--seconds");
const seconds = secondsAt >= 0 ? Number(args[secondsAt + 1]) : count > 0 ? 20 : 600;

const now = (): number => performance.now();
// The stress scene has no title: drop the replay's opening confirm.
const script = count > 0 ? walk(seconds).replace(/^confirm, /, "") : walk(seconds);
const frames = parseInputScript(script, { bindings, screen });
const backend = new RecordingBackend({ keepFrames: 1 });
for (const f of frames) backend.queueInput(f);
const base = args.includes("--no-interpolate") ? { ...gameConfig, interpolate: false } : gameConfig;
const config = count > 0 ? { ...base, root: () => new Stress({ count, armed }) } : base;
const player = createPlayer(backend, { ...config, warn: () => {} });
const times: number[] = [];
let busiest = { enemies: 0, bolts: 0, gems: 0, time: 0 };
let play: ReturnType<typeof findPlay> = null;
for (let i = 0; i < frames.length; i++) {
  const start = now();
  player.step();
  const elapsed = now() - start;
  // The run's component, found again only when it has gone (a search of the tree each step would be timed with the game).
  if (play === null || play.world === null) play = findPlay();
  if (play === null) continue;
  const r = runOf(play);
  if (count > 0 && i < 120) continue;
  if (profile && profiler === null) profiler = startProfiling();
  times.push(elapsed);
  if (r.enemies >= busiest.enemies) busiest = { enemies: r.enemies, bolts: r.bolts, gems: r.gems, time: Math.round(r.time) };
}
player.close();
if (profiler !== null) {
  const report = profiler.take();
  stopProfiling();
  const round = (n: number): number => +n.toFixed(3);
  console.log(JSON.stringify({ phases: Object.fromEntries(Object.entries(report.phases).map(([k, v]) => [k, round(v)])) }));
  for (const c of report.components.slice(0, 12))
    console.log(
      `${c.name.padEnd(16)} n=${String(c.instances).padStart(5)} update ${round(c.update)} render ${round(c.render)} renders ${round(c.renders)}`
    );
}
times.sort((a, c) => a - c);
const mean = times.reduce((a, c) => a + c, 0) / Math.max(1, times.length);
console.log(
  JSON.stringify({
    steps: times.length,
    meanMs: +mean.toFixed(3),
    medianMs: +(times[times.length >> 1] ?? 0).toFixed(3),
    p99Ms: +(times[Math.floor(times.length * 0.99)] ?? 0).toFixed(3),
    maxMs: +(times[times.length - 1] ?? 0).toFixed(3),
    busiest,
  })
);
