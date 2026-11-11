/**
 * Finds a replay that takes the gem: play the level's replays to the start of room 7, then search from there for a way to touch
 * the gem. Writes `test/gem-replay.ts`. The gem's place is `GEM` in `rules/rooms.ts`.
 *
 *   node packages/kite/tools/solve-gem.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInputScript } from "@rge/player";
import { NO_CONTROLS } from "../src/rules/body.ts";
import { newRun } from "../src/rules/level.ts";
import { playFrame, startPlayback } from "../src/rules/playback.ts";
import { GEM } from "../src/rules/rooms.ts";
import { REPLAYS } from "../test/replays.ts";
import { solve } from "./solve.ts";

const bindings = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", jump: "Z", dash: "X" };
const down = (keys: readonly string[], k: string): boolean => keys.includes(k);

if (import.meta.url === `file://${process.argv[1]}`) {
  let play = startPlayback(newRun());
  let prev: readonly string[] = [];
  for (const script of REPLAYS.slice(0, 6)) {
    for (const f of parseInputScript(script, { bindings })) {
      play = playFrame(play, { ...NO_CONTROLS, left: down(f.down, "ArrowLeft"), right: down(f.down, "ArrowRight"), up: down(f.down, "ArrowUp"), down: down(f.down, "ArrowDown"), jumpHeld: down(f.down, "Z"), jumpPressed: down(f.down, "Z") && !down(prev, "Z"), dashPressed: down(f.down, "X") && !down(prev, "X") }, 1 / 60);
      prev = f.down;
    }
  }
  console.log("arrived in room", play.run.room + 1);
  const found = solve(6, { dash: true }, 800_000, play, GEM);
  if (found === null) {
    console.log("NO WAY TO THE GEM");
    process.exit(1);
  }
  console.log(found.script);
  const header = "/**\n * From the start of room 7 (after REPLAYS[0..5]), a way to the gem. Found by tools/solve-gem.ts; test/rooms.test.ts plays it.\n */\n";
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "../test/gem-replay.ts"), `${header}export const GEM_REPLAY = ${JSON.stringify(found.script)};\n`);
}
