/**
 * Plays thirty seconds of the walking replay against a recording backend and prints the run as one line of JSON (numbers rounded to
 * 1e-9). It runs unchanged under Node and, bundled, under the Rust host (QuickJS-ng): `tse check` requires the two outputs to be
 * identical, and two runs under Node to be identical too.
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@tsengine/player";

import { bindings, gameConfig, screen } from "./game.ts";
import { walk } from "./test/replays.ts";
import { findPlay, runOf } from "./test/run-state.ts";

const frames = parseInputScript(walk(30), { bindings, screen });
const backend = new RecordingBackend({ keepFrames: 1 });
const warnings: string[] = [];
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: (message) => warnings.push(message) });
const states: unknown[] = [];
for (let i = 0; i < frames.length + 1; i++) {
  player.step();
  if (i % 120 === 0) {
    const p = findPlay();
    if (p !== null) states.push({ i, ...runOf(p) });
  }
}
const records = backend.lastFrame.records.length;
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(JSON.stringify({ states, plays: backend.plays, textureLoads: backend.textureLoads, records, warnings }, round));
