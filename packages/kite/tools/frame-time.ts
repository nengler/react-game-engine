/**
 * Script time of one frame of the level (Node, V8), over a scripted run of the whole game on a recording backend: the mean, the
 * 99th percentile and the slowest step. Drawing in librge is not in it. `node packages/kite/tools/frame-time.ts`.
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";

import { bindings, gameConfig } from "../game.ts";
import { REPLAYS } from "../test/replays.ts";
const frames = parseInputScript(`Enter, _*3, ${REPLAYS.join(", ")}`, { bindings });
const b = new RecordingBackend({
  textureSizes: {
    "assets/tiles.png": { width: 80, height: 20 },
    "assets/hero.png": { width: 96, height: 24 },
    "assets/font.png": { width: 80, height: 48 },
  },
});
for (const f of frames) b.queueInput(f);
const p = createPlayer(b, { ...gameConfig, warn: () => {} });
const t: number[] = [];
for (let i = 0; i < frames.length + 1; i++) {
  const s = performance.now();
  p.step();
  t.push(performance.now() - s);
}
t.sort((a, c) => a - c);
const mean = t.reduce((a, c) => a + c, 0) / t.length;
console.log(
  JSON.stringify({
    steps: t.length,
    meanMs: +mean.toFixed(3),
    p99Ms: +t[Math.floor(t.length * 0.99)]!.toFixed(3),
    maxMs: +t.at(-1)!.toFixed(3),
    records: b.lastFrame.records.length,
  })
);
