/**
 * Script time of one frame of the busiest part of the game, over a scripted run of the good build on a recording backend: the mean
 * and the slowest frame (two steps: the replay plays at 2×) while wave 10 is on (the most enemies on the path), and with how many enemies, towers and shots that is.
 * Drawing in librge is not in it. Runs under Node and, bundled, under the Rust host (QuickJS), where it reports the same way:
 *
 *   node packages/hearth/tools/frame-time.ts
 *   npm run bundle -- packages/hearth/tools/frame-time.ts host/dist/hearth-frames.js && host/target/release/rge-host host/dist/hearth-frames.js
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";

import { bindings, gameConfig, screen } from "../game.ts";
import { battleOf, findPlay } from "../test/battle-state.ts";
import { REPLAYS } from "../test/replays.ts";

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
const frames = parseInputScript(REPLAYS.good, { bindings, screen });
const backend = new RecordingBackend({
  keepFrames: 1,
  textureSizes: {
    "assets/enemies.png": { width: 56, height: 42 },
    "assets/tiles.png": { width: 80, height: 40 },
    "assets/font.png": { width: 80, height: 48 },
    "assets/tower_bases.png": { width: 36, height: 36 },
    "assets/barrels.png": { width: 36, height: 36 },
    "assets/icons.png": { width: 60, height: 10 },
    "assets/shots.png": { width: 32, height: 8 },
  },
});
for (const f of frames) backend.queueInput(f);
const player = createPlayer(backend, { ...gameConfig, warn: () => {} });
const times: number[] = [];
let busiest = { enemies: 0, towers: 0, shots: 0 };
for (let i = 0; i < frames.length + 1; i++) {
  const start = now();
  player.step();
  const elapsed = now() - start;
  const play = findPlay();
  const b = play === null ? null : battleOf(play);
  if (b !== null && b.wave === 10) {
    times.push(elapsed);
    if (b.enemies > busiest.enemies) busiest = { enemies: b.enemies, towers: b.towers, shots: b.shots };
  }
}
player.close();
times.sort((a, c) => a - c);
const mean = times.reduce((a, c) => a + c, 0) / Math.max(1, times.length);
console.log(
  JSON.stringify({
    steps: times.length,
    meanMs: +mean.toFixed(3),
    p99Ms: +(times[Math.floor(times.length * 0.99)] ?? 0).toFixed(3),
    maxMs: +(times[times.length - 1] ?? 0).toFixed(3),
    busiest,
  })
);
