/**
 * Plays a short game (a build order of clicks and keys, then the first wave) against a recording backend and prints the battle's
 * state every 30 frames (its components' own state: `Play`'s numbers, each enemy's and tower's), with the sounds played and the number of draw records of the last frame, as one line of JSON (numbers
 * rounded to 1e-9). It runs unchanged under Node and, bundled, under the Rust host (QuickJS-ng): the two outputs must be identical,
 * which `rge check` checks.
 *
 *   node packages/hearth/parity.ts
 */
import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";

import { bindings, gameConfig, screen } from "./game.ts";
import { Enemy } from "./generated/Enemy.ts";
import { Pad } from "./generated/Pad.ts";
import { Tower } from "./generated/Tower.ts";
import { MAP } from "./src/rules/map.ts";
import { findPlay } from "./test/battle-state.ts";

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
    // The battle's own state, read from its components: `Play`'s numbers, each enemy's walk and hit points, each tower's aim.
    const play = findPlay();
    if (play !== null) {
      const enemies = play.children.flatMap((c) => (c instanceof Enemy ? [[c.props.id, c.dist, c.hp]] : []));
      const towers = play.children.flatMap((c) =>
        c instanceof Pad ? c.children.flatMap((t) => (t instanceof Tower ? [[c.props.id, t.props.level, t.angle]] : [])) : []
      );
      states.push({ i, gold: play.gold, lives: play.lives, wave: play.wave, enemies, towers });
    }
  }
}
const records = backend.lastFrame.records.length;
player.close();

const round = (_key: string, value: unknown): unknown => (typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value);
console.log(
  JSON.stringify(
    { states, plays: backend.plays, soundLoads: backend.soundLoads, textureLoads: backend.textureLoads, records, warnings },
    round
  )
);
