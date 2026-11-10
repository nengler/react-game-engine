import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, runScript } from "@rge/player";
import { bindings, gameConfig } from "../game.ts";
import { useGame } from "../src/GameState.ts";
import { NO_CONTROLS } from "../src/rules/body.ts";
import { ROOM_COLS, ROOM_ROWS } from "../src/rules/constants.ts";
import { newRun, stepRun } from "../src/rules/level.ts";
import { ROOM_LIST, ROOM_SPECS, tilesOf } from "../src/rules/rooms.ts";
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
    assert.equal(ROOM_SPECS.at(-1)?.exit, "end");
  });
});

describe("replays", () => {
  it("has one per room", () => assert.equal(REPLAYS.length, ROOM_LIST.length));

  it("finish every room, one after the other, without dying (the rules alone, no drawing)", () => {
    let run = newRun();
    let previous: string[] = [];
    REPLAYS.forEach((script, index) => {
      for (const frame of parseInputScript(script, { bindings })) {
        const has = (key: string): boolean => frame.down.includes(key);
        run = stepRun(run, { ...NO_CONTROLS, left: has("ArrowLeft"), right: has("ArrowRight"), up: has("ArrowUp"), down: has("ArrowDown"), jumpHeld: has("Z"), jumpPressed: has("Z") && !previous.includes("Z"), dashPressed: has("X") && !previous.includes("X") }, 1 / 60);
        previous = frame.down;
      }
      assert.equal(run.deaths, 0, `room ${index + 1}: no deaths`);
      assert.ok(run.finished || run.room === index + 1, `room ${index + 1} was finished (now in room ${run.room + 1})`);
    });
    assert.ok(run.finished, "the last exit ends the level");
  });

  it("also finish the whole level through the game itself, with its input, state and components", () => {
    const frames = parseInputScript(REPLAYS.join(", "), { bindings });
    const result = runScript(gameConfig, frames, () => {
      const s = useGame.getState();
      return { room: s.room, deaths: s.deaths, finished: s.finished };
    });
    const last = result.states.at(-1);
    assert.deepEqual(last, { room: 7, deaths: 0, finished: true });
    const rooms = result.states.map((s) => s.room);
    assert.deepEqual([...new Set(rooms)], [0, 1, 2, 3, 4, 5, 6, 7], "the rooms came in order");
  });
});
