/**
 * Script time of each step of the replay (Node, V8) on a recording backend, with the steps that change map named: the mean, the
 * 99th percentile, the slowest step, and what a door costs. Drawing in librge is not in it.
 *
 *   node tools/frame-time.ts
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";
import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { route, TO_THE_CAVE } from "../test/replays.ts";

const { script } = route(TO_THE_CAVE.slice(0, -1));
const frames = parseInputScript(`Enter, _*3, ${script}, ${(TO_THE_CAVE.at(-1) as { raw: string }).raw}`, { bindings });
const backend = new RecordingBackend({ textureSizes: { "assets/tiles.png": { width: 48, height: 16 } } });
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: () => {} });
const times: number[] = [];
const doors: { step: number; ms: number }[] = [];
let map = useGame.getState().run.map;
for (let i = 0; i < frames.length + 1; i++) {
  const start = performance.now();
  player.step();
  const ms = performance.now() - start;
  times.push(ms);
  const now = useGame.getState().run.map;
  if (now !== map) doors.push({ step: i, ms: +ms.toFixed(2) });
  map = now;
}
const slowest = times.map((ms, step) => ({ step, ms: +ms.toFixed(1) })).sort((a, b) => b.ms - a.ms).slice(0, 5);
const sorted = [...times].sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(JSON.stringify({ steps: times.length, meanMs: +mean.toFixed(3), p99Ms: +sorted[Math.floor(sorted.length * 0.99)]!.toFixed(3), maxMs: +sorted.at(-1)!.toFixed(3), records: backend.lastFrame.records.length, slowest, doors }));
