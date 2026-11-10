import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, runScript } from "@rge/player";
import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { NO_CONTROLS } from "../src/rules/body.ts";
import { ROOM_COLS, ROOM_ROWS } from "../src/rules/constants.ts";
import { newRun } from "../src/rules/level.ts";
import { playFrame, startPlayback } from "../src/rules/playback.ts";
import { ROOM_LIST, tilesOf } from "../src/rules/rooms.ts";
import { ROOM_SPECS } from "../tools/rooms.ts";
import { GEM_REPLAY } from "./gem-replay.ts";
import { REPLAYS } from "./replays.ts";

describe("rooms", () => {
  it("are all the same size, each with one start and an exit, and laid out so each exit meets the next room", () => {
    assert.equal(ROOM_LIST.length, 8);
    for (const room of ROOM_LIST) {
      assert.equal(room.rows.length, ROOM_ROWS);
      assert.ok(room.rows.every((row) => row.length === ROOM_COLS));
      assert.equal(tilesOf(room, "@").length, 1, `room ${room.index + 1} has one start`);
      assert.ok(tilesOf(room, "E").length > 0, `room ${room.index + 1} has an exit`);
    }
    // An exit at the right edge opens onto the left edge of the next room at the same rows; one in the ceiling, onto its floor opening.
    for (const room of ROOM_LIST.slice(0, -1)) {
      const next = ROOM_LIST[room.index + 1]!;
      if (room.exit === "right") {
        assert.equal(next.ox, room.ox + 320);
        const rows = tilesOf(room, "E").map(([, r]) => r);
        assert.ok(rows.every((r) => next.rows[r]![0] === "."), `room ${room.index + 1}'s exit rows are open on the left of room ${room.index + 2}`);
      } else {
        assert.equal(next.oy, room.oy - 180);
        const cols = tilesOf(room, "E").map(([c]) => c);
        assert.ok(cols.every((c) => next.rows[15]![c] !== "#"), `room ${room.index + 1}'s exit columns are open at the bottom of room ${room.index + 2}`);
      }
    }
    assert.equal(ROOM_LIST.at(-1)?.exit, "end");
  });

  it("are the Tiled maps in scenes/, which still agree with the drafts they were made from (until someone edits a map)", () => {
    assert.equal(ROOM_SPECS.length, ROOM_LIST.length);
    for (const spec of ROOM_SPECS) {
      const room = ROOM_LIST[ROOM_SPECS.indexOf(spec)]!;
      assert.deepEqual(room.rows, spec.rows, `room ${room.index + 1}`);
      assert.equal(room.exit, spec.exit);
    }
  });
});

describe("replays", () => {
  it("has one per room", () => assert.equal(REPLAYS.length, ROOM_LIST.length));

  it("finish every room, one after the other, without dying (the rules alone, no drawing)", () => {
    let play = startPlayback(newRun());
    let previous: string[] = [];
    REPLAYS.forEach((script, index) => {
      for (const frame of parseInputScript(script, { bindings })) {
        const has = (key: string): boolean => frame.down.includes(key);
        play = playFrame(play, { ...NO_CONTROLS, left: has("ArrowLeft"), right: has("ArrowRight"), up: has("ArrowUp"), down: has("ArrowDown"), jumpHeld: has("Z"), jumpPressed: has("Z") && !previous.includes("Z"), dashPressed: has("X") && !previous.includes("X") }, 1 / 60);
        previous = frame.down;
      }
      assert.equal(play.run.deaths, 0, `room ${index + 1}: no deaths`);
      assert.ok(play.run.finished || play.run.room === index + 1, `room ${index + 1} was finished (now in room ${play.run.room + 1})`);
    });
    assert.ok(play.run.finished, "the last exit ends the level");
  });

  it("also finish the whole level through the game itself, with its input, state and components", () => {
    const frames = parseInputScript(`Enter, _*3, ${REPLAYS.join(", ")}`, { bindings });
    const result = runScript(gameConfig, frames, () => {
      const s = useGame.getState();
      return { room: s.room, deaths: s.deaths, finished: s.finished, screen: s.screen };
    });
    const last = result.states.at(-1);
    assert.deepEqual(last, { room: 7, deaths: 0, finished: true, screen: "end" });
    const rooms = result.states.map((s) => s.room);
    assert.deepEqual([...new Set(rooms)], [0, 1, 2, 3, 4, 5, 6, 7], "the rooms came in order");
    assert.equal(result.states[0]?.screen, "play", "the first button, on the title screen, starts the run");
  });

  it("give the same result at any frame rate, because the game runs on a fixed timestep", () => {
    const script = `Enter, _*3, ${REPLAYS.slice(0, 3).join(", ")}`;
    const final = (frames: ReturnType<typeof parseInputScript>) => runScript(gameConfig, frames, () => ({ ...useGame.getState().player })).states.at(-1);
    const at60 = parseInputScript(script, { bindings });
    // The same inputs drawn at 120 and at 30 frames a second: every frame twice with half the time, or two frames' keys in one frame.
    const at120 = at60.flatMap((frame) => [{ ...frame, dt: 1 / 120 }, { ...frame, dt: 1 / 120 }]);
    const reference = final(at60);
    assert.deepEqual(final(at120), reference);
  });

  it("reach the optional gem in room 7 by a detour, through the game: its collider and the character's collider meet", () => {
    const script = `Enter, _*3, ${REPLAYS.slice(0, 6).join(", ")}, ${GEM_REPLAY}, _*4`;
    const result = runScript(gameConfig, parseInputScript(script, { bindings }), () => ({ gems: useGame.getState().gems, room: useGame.getState().room }));
    assert.deepEqual(result.states.at(-1), { gems: 1, room: 6 });
    assert.equal(result.states.find((s) => s.room === 6 && s.gems === 0) !== undefined, true, "it was not already picked up on arrival");
  });
});

describe("the dash moves have room to spare", () => {
  /** Walk right `walk` frames, jump (held) and dash `dash` frames later; did `done` hold at any frame? */
  function attempt(room: number, walk: number, dash: number, direction: { up?: boolean; right?: boolean }, done: (p: ReturnType<typeof startPlayback>) => boolean): boolean {
    const r = ROOM_LIST[room]!;
    let p = startPlayback({ ...newRun(), room, originX: r.ox, originY: r.oy, player: { ...newRun().player, x: r.spawnX, y: r.spawnY } });
    for (let f = 0; f < 220 && !p.run.dead; f++) {
      const j = f - walk;
      p = playFrame(p, { ...NO_CONTROLS, right: f < walk + 25 || direction.right === true, jumpPressed: j === 0, jumpHeld: j >= 0 && j < 14, up: direction.up === true && j >= dash, dashPressed: j === dash }, 1 / 60);
      if (done(p)) return true;
    }
    return false;
  }

  it("room 4: reaching the first ledge works for a dash timed anywhere in a quarter of a second, from several places to jump", () => {
    for (const walk of [18, 24, 30]) {
      let window = 0;
      for (let dash = 0; dash <= 40; dash++) if (attempt(3, walk, dash, { up: true }, (p) => p.run.player.onGround && p.run.player.y < 105)) window++;
      assert.ok(window >= 12, `walking ${walk} frames, ${window} frames of dash timing work`);
    }
  });

  it("room 3: crossing the gap works for a dash timed anywhere in a tenth of a second or more, jumping from the edge", () => {
    let best = 0;
    for (let walk = 40; walk <= 70; walk += 2) {
      let window = 0;
      for (let dash = 0; dash <= 40; dash++) if (attempt(2, walk, dash, { right: true }, (p) => p.run.room === 3 || p.run.player.x > 175)) window++;
      best = Math.max(best, window);
    }
    assert.ok(best >= 6, `at best ${best} frames of dash timing work`);
  });
});
