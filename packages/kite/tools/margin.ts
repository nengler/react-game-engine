/**
 * How forgiving a room's key move is: the character walks right to a spot, jumps (held) and dashes up at a frame; for each spot and
 * frame, did it end up standing on the ledge? Prints the grid. Used to check a move has a window of more than a frame or two.
 *   node packages/kite/tools/margin.ts
 */
import { NO_CONTROLS } from "../src/rules/body.ts";
import { newRun } from "../src/rules/level.ts";
import { playFrame, startPlayback } from "../src/rules/playback.ts";
import { ROOM_LIST } from "../src/rules/rooms.ts";

const room = ROOM_LIST[3]!;
const rows: string[] = [];
for (let walk = 0; walk <= 60; walk += 6) {
  let line = `walk ${String(walk).padStart(2)}: `;
  for (let dashAt = 0; dashAt <= 40; dashAt += 2) {
    let p = startPlayback({ ...newRun(), room: 3, originX: room.ox, originY: room.oy, player: { ...newRun().player, x: room.spawnX, y: room.spawnY } });
    let ok = false;
    for (let f = 0; f < 200 && !p.run.dead; f++) {
      const jf = f - walk;
      p = playFrame(p, { ...NO_CONTROLS, right: f < walk + 25, jumpPressed: jf === 0, jumpHeld: jf >= 0 && jf < 14, up: jf >= dashAt, dashPressed: jf === dashAt }, 1 / 60);
      if (p.run.player.onGround && p.run.player.y < 105) { ok = true; break; }
    }
    line += ok ? "#" : ".";
  }
  rows.push(line);
}
console.log("columns: dash at 0,2,..40 frames after the jump\n" + rows.join("\n"));
