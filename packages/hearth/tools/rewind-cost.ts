/**
 * What rewind costs while playing (REACT_FEEL_PLAN.md D1): Hearth's good build played to the end of wave 10 with and without
 * `tse dev`'s recording (each frame's input and state hash, a snapshot each second), on a recording backend. Prints the mean and
 * 99th-percentile script time of a frame during wave 10 for each, the time a snapshot takes, and how long going back a few
 * seconds takes.
 *
 *   node packages/hearth/tools/rewind-cost.ts
 */
import { createPlayer, parseInputScript, RecordingBackend, Rewind, type Backend, type Player } from "@tsengine/player";

import { bindings, gameConfig, screen } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { battleOf, findPlay } from "../test/battle-state.ts";
import { REPLAYS } from "../test/replays.ts";

const now = (): number => performance.now();
const frames = parseInputScript(REPLAYS.good, { bindings, screen });
const stores = new Map([["src/GameState.ts#useGame", useGame.store]]);

function measure(withRewind: boolean): { mean: number; p99: number; rewind: Rewind | null; player: Player; wave10: number[] } {
  const backend = new RecordingBackend({ keepFrames: 1 });
  for (const f of frames) backend.queueInput(f);
  const rewind = withRewind ? new Rewind(backend, { config: () => gameConfig, stores: () => stores }) : null;
  const player = createPlayer((rewind?.backend ?? backend) as Backend, { ...gameConfig, warn: () => {} });
  rewind?.attach(player);
  const times: number[] = [];
  const wave10: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const start = now();
    if (rewind !== null) rewind.step();
    else player.step();
    const elapsed = now() - start;
    const play = findPlay();
    if (play !== null && battleOf(play).wave === 10) {
      times.push(elapsed);
      wave10.push(i + 1);
    }
  }
  times.sort((a, b) => a - b);
  return {
    mean: times.reduce((a, b) => a + b, 0) / Math.max(1, times.length),
    p99: times[Math.floor(times.length * 0.99)] ?? 0,
    rewind,
    player,
    wave10,
  };
}

const plain = measure(false);
plain.player.close();
const recorded = measure(true);
const rewind = recorded.rewind!;
// Into the busiest part of wave 10, half a second after a snapshot (the most a seek replays is a second).
const middle = recorded.wave10[Math.floor(recorded.wave10.length / 2)] ?? rewind.range.to;
rewind.pause();
const started = now();
rewind.seek(middle - (middle % 60) + 30);
const back = now() - started;
let worst = 0;
for (const at of [middle - (middle % 60) + 59, middle - (middle % 60) + 119]) {
  const t0 = now();
  rewind.seek(at);
  worst = Math.max(worst, now() - t0);
}
recorded.player.close();
console.log(
  JSON.stringify({
    plain: { meanMs: +plain.mean.toFixed(3), p99Ms: +plain.p99.toFixed(3) },
    recording: { meanMs: +recorded.mean.toFixed(3), p99Ms: +recorded.p99.toFixed(3) },
    seekHalfSecondMs: +back.toFixed(1),
    seekFullSecondMs: +worst.toFixed(1),
    divergence: rewind.divergence,
    framesKept: rewind.range.to - rewind.range.from,
  })
);
