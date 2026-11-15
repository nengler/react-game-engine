/**
 * Plays the first rooms of the level from their replays against a recording backend and prints everything the player
 * did as one line of JSON (numbers rounded to 1e-9). It runs unchanged under Node and, bundled, under the Rust host
 * (QuickJS-ng): the two outputs must be identical, which `tse check` and `test/parity.test.ts` check.
 *
 *   node packages/kite/parity.ts
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@tsengine/player";

import { bindings, gameConfig } from "./game.ts";
import { REPLAYS } from "./test/replays.ts";

const frames = parseInputScript(`Enter, _*3, ${REPLAYS.slice(0, 2).join(", ")}`, { bindings });
const backend = new RecordingBackend();
const warnings: string[] = [];
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: (message) => warnings.push(message) });
for (let i = 0; i < frames.length + 1; i++) player.step();
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(
  JSON.stringify(
    { frames: backend.frames, plays: backend.plays, soundLoads: backend.soundLoads, textureLoads: backend.textureLoads, warnings },
    round
  )
);
