/**
 * Plays the replay to the cave's door against a recording backend and prints everything the player did as one line of JSON
 * (numbers rounded to 1e-9). It runs unchanged under Node and, bundled, under the Rust host (QuickJS-ng): `rge check` requires the
 * two outputs to be identical, and two runs under Node to be identical too.
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";

import { bindings, gameConfig } from "./game.ts";
import { useGame } from "./src/GameState.ts";
import { route, TO_THE_CAVE } from "./test/replays.ts";

const { script } = route(TO_THE_CAVE.slice(0, -1));
const frames = parseInputScript(`Enter, _*3, ${script}, ${(TO_THE_CAVE.at(-1) as { raw: string }).raw}`, { bindings });
const backend = new RecordingBackend({ keepFrames: 1 });
const warnings: string[] = [];
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: (message) => warnings.push(message) });
const states: unknown[] = [];
for (let i = 0; i < frames.length + 1; i++) {
  player.step();
  if (i % 60 === 0) {
    const r = useGame.getState().run;
    states.push({ i, map: r.map, x: r.x, y: r.y, hearts: r.hearts, items: r.items, taken: r.taken });
  }
}
const records = backend.lastFrame.records.length;
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(JSON.stringify({ states, plays: backend.plays, textureLoads: backend.textureLoads, records, warnings }, round));
