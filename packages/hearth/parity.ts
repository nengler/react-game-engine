/**
 * Plays a short game (a build order of clicks and keys, then the first wave) against a recording backend and prints the battle's
 * state every 30 steps, with the sounds played and the number of draw records of the last frame, as one line of JSON (numbers
 * rounded to 1e-9). It runs unchanged under Node and, bundled, under the Rust host (QuickJS-ng): the two outputs must be identical,
 * which `rge check` checks.
 *
 *   node packages/hearth/parity.ts
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";
import { bindings, gameConfig, screen } from "./game.ts";
import { useGame } from "./src/GameState.ts";
import { MAP } from "./src/rules/map.ts";

const at = (i: number): string => `click@${MAP.pads[i]!.x},${MAP.pads[i]!.y}`;
const frames = parseInputScript(`confirm, _*3, ${at(4)}, _, one, _, ${at(9)}, _, two, _, fast, wave, _*600`, { bindings, screen });
const backend = new RecordingBackend({ keepFrames: 1 });
const warnings: string[] = [];
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, warn: (message) => warnings.push(message) });
const states: unknown[] = [];
for (let i = 0; i < frames.length + 1; i++) {
  player.step();
  if (i % 30 === 0) {
    const b = useGame.getState().battle;
    states.push({ i, gold: b.gold, lives: b.lives, wave: b.wave, enemies: b.enemies.map((e) => [e.id, e.dist, e.hp]), towers: b.pads.filter((p) => p.tower !== null).map((p) => [p.id, p.tower!.level, p.tower!.angle]) });
  }
}
const records = backend.lastFrame.records.length;
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(JSON.stringify({ states, plays: backend.plays, soundLoads: backend.soundLoads, textureLoads: backend.textureLoads, records, warnings }, round));
