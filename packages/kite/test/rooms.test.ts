import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript, runScript } from "@rge/player";
import type { GameObject } from "@rge/runtime";
import { bindings, gameConfig } from "../game.ts";
import { fx, sfx } from "../src/effects.ts";
import { useGame } from "../src/GameState.ts";
import { NO_CONTROLS, type Body } from "../src/rules/body.ts";
import { ROOM_COLS, ROOM_ROWS } from "../src/rules/constants.ts";
import { newSim, type Sim } from "../src/rules/level.ts";
import { playFrame, startPlayback } from "../src/rules/playback.ts";
import { ROOM_LIST, tilesOf } from "../src/rules/rooms.ts";
import { ROOM_SPECS } from "../tools/rooms.ts";
import { GEM_REPLAY } from "./gem-replay.ts";
import { REPLAYS } from "./replays.ts";

/** A run in room `room` with the character's body changed by `body` (somewhere other than the start, standing). */
function simAt(room: number, body: Partial<Body>): Sim {
  const sim = newSim(room);
  return { ...sim, player: { ...sim.player, body: { ...sim.player.body, ...body } } };
}

/** The character in the game's world: its entity, found by name. */
function heroIn(root: GameObject): GameObject | undefined {
  if ((root as { name?: string }).name === "Player") return root;
  for (const child of root.children) {
    const found = heroIn(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

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
    let play = startPlayback(newSim());
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
      return { room: s.run.room, deaths: s.run.deaths, finished: s.run.finished, screen: s.screen };
    });
    const last = result.states.at(-1);
    assert.deepEqual(last, { room: 7, deaths: 0, finished: true, screen: "end" });
    const rooms = result.states.map((s) => s.room);
    assert.deepEqual([...new Set(rooms)], [0, 1, 2, 3, 4, 5, 6, 7], "the rooms came in order");
    assert.equal(result.states[0]?.screen, "play", "the first button, on the title screen, starts the run");
  });

  it("answer what happens with the effect stores: sounds, dust and no death on a clean run", () => {
    const before = { dust: fx.bursts["dust"] ?? 0, kick: fx.bursts["kick"] ?? 0, jump: sfx.plays("jump"), dash: sfx.plays("dash"), start: sfx.plays("start"), death: sfx.plays("death") };
    runScript(gameConfig, parseInputScript(`Enter, _*3, ${REPLAYS.slice(0, 3).join(", ")}`, { bindings }), () => null);
    assert.equal(sfx.plays("start") - before.start, 1, "the title's button");
    assert.ok(sfx.plays("jump") > before.jump, "jumps are heard");
    assert.ok(sfx.plays("dash") > before.dash, "room 3 needs a dash");
    assert.ok((fx.bursts["dust"] ?? 0) > before.dust && (fx.bursts["kick"] ?? 0) > before.kick, "landings and jumps raise dust");
    assert.equal(sfx.plays("death"), before.death);
  });

  it("give the same result at any frame rate, because the game runs on a fixed timestep", () => {
    const script = `Enter, _*3, ${REPLAYS.slice(0, 3).join(", ")}`;
    const final = (frames: ReturnType<typeof parseInputScript>) =>
      runScript(gameConfig, frames, (player) => {
        const hero = heroIn(player.world.root);
        return { room: useGame.getState().run.room, x: hero?.transform.x, y: hero?.transform.y };
      }).states.at(-1);
    const at60 = parseInputScript(script, { bindings });
    // The same inputs drawn at 120 and at 30 frames a second: every frame twice with half the time, or two frames' keys in one frame.
    const at120 = at60.flatMap((frame) => [{ ...frame, dt: 1 / 120 }, { ...frame, dt: 1 / 120 }]);
    const reference = final(at60);
    assert.equal(typeof reference?.x, "number", "the character is in the world");
    assert.deepEqual(final(at120), reference);
  });

  it("reach the optional gem in room 7 by a detour, through the game: its collider and the character's collider meet", () => {
    const script = `Enter, _*3, ${REPLAYS.slice(0, 6).join(", ")}, ${GEM_REPLAY}, _*4`;
    const result = runScript(gameConfig, parseInputScript(script, { bindings }), () => ({ gems: useGame.getState().gems, room: useGame.getState().run.room }));
    assert.deepEqual(result.states.at(-1), { gems: 1, room: 6 });
    assert.equal(result.states.find((s) => s.room === 6 && s.gems === 0) !== undefined, true, "it was not already picked up on arrival");
  });
});

describe("the dash moves have room to spare", () => {
  /** Walk right `walk` frames, jump (held) and dash `dash` frames later; did `done` hold at any frame? */
  function attempt(room: number, walk: number, dash: number, direction: { up?: boolean; right?: boolean }, done: (p: ReturnType<typeof startPlayback>) => boolean): boolean {
    let p = startPlayback(newSim(room));
    for (let f = 0; f < 220 && !p.run.dead; f++) {
      const j = f - walk;
      p = playFrame(p, { ...NO_CONTROLS, right: f < walk + 25 || direction.right === true, jumpPressed: j === 0, jumpHeld: j >= 0 && j < 14, up: direction.up === true && j >= dash, dashPressed: j === dash }, 1 / 60);
      if (done(p)) return true;
    }
    return false;
  }

  /** From standing at (x, y) in room 4, with `hold` held, a jump (held) and a dash up `dash` frames later: did `done` hold? */
  function climb(x: number, y: number, hold: "left" | "right" | null, dash: number, done: (p: ReturnType<typeof startPlayback>) => boolean): boolean {
    let p = startPlayback(simAt(3, { x, y, onGround: true }));
    for (let f = 0; f < 150 && !p.run.dead; f++) {
      p = playFrame(p, { ...NO_CONTROLS, left: hold === "left", right: hold === "right", jumpPressed: f === 1, jumpHeld: f >= 1 && f < 15, up: f >= 1 + dash, dashPressed: f === 1 + dash }, 1 / 60);
      if (done(p)) return true;
    }
    return false;
  }
  const windowOf = (x: number, y: number, hold: "left" | "right", done: (p: ReturnType<typeof startPlayback>) => boolean): number => {
    let n = 0;
    for (let dash = 0; dash <= 30; dash++) if (climb(x, y, hold, dash, done)) n++;
    return n;
  };

  it("room 4, first ledge: from the floor, a dash up timed anywhere in more than a tenth of a second, from a spread of places to jump", () => {
    for (const walk of [70, 80, 90]) {
      let window = 0;
      for (let dash = 0; dash <= 30; dash++) if (attempt(3, walk, dash, { up: true }, (p) => p.player.body.onGround && p.player.body.y < 105 && p.player.body.x > 185)) window++;
      // With Celeste's dash (straight up cancels the run), jumping from the far left (70) leaves 7 frames; from 80 and 90, 16 and 17.
      assert.ok(window >= 7, `walking ${walk} frames: ${window} frames of dash timing work`);
    }
  });

  it("room 4, second ledge: from the first, jumping and dashing up while holding left, from anywhere along it", () => {
    for (const x of [198, 210, 222]) {
      const window = windowOf(x, 99, "left", (p) => p.player.body.onGround && p.player.body.y < 55 && p.player.body.x < 165);
      assert.ok(window >= 10, `from x ${x}: ${window} frames of dash timing work`);
    }
  });

  it("room 4, the exit: from the second ledge a plain jump (with a step toward the opening) reaches it", () => {
    for (const x of [110, 130, 150]) {
      let reached = false;
      let p = startPlayback(simAt(3, { x, y: 49, onGround: true }));
      for (let f = 0; f < 80 && !p.run.dead; f++) {
        p = playFrame(p, { ...NO_CONTROLS, jumpPressed: f === 1, jumpHeld: f >= 1 && f < 15, right: x < 140 && f > 5 }, 1 / 60);
        if (p.run.room !== 3) reached = true;
      }
      assert.ok(reached, `from x ${x}`);
    }
  });

  it("room 6: a person's way (climb the right wall, wall jump onto the ledge, rest, climb the left wall) works from a stretch of heights", () => {
    /** The route, wall jumping across once the climb reaches `jumpAt`; how it ended. */
    const route = (jumpAt: number): "out" | "dead" | "stuck" => {
      let p = startPlayback(newSim(5));
      let phase = "walk";
      let wait = 0;
      let held = false;
      for (let f = 0; f < 900; f++) {
        const b = p.player.body;
        let c: Partial<typeof NO_CONTROLS> = {};
        let press = false;
        if (phase === "walk") {
          c = { right: true };
          if (b.x >= 168) phase = "climb";
        } else if (phase === "climb") {
          c = { right: true, grab: true, up: true };
          if (b.y <= jumpAt) phase = "jump";
        } else if (phase === "jump") {
          c = { left: true, grab: true };
          press = true;
          phase = "across";
        } else if (phase === "across") {
          c = { left: true, jumpHeld: b.vy < 0 };
          if (b.onGround) [phase, wait] = ["rest", 10];
        } else if (phase === "rest") {
          if (--wait <= 0) phase = "hop";
        } else if (phase === "hop") {
          c = { left: true };
          press = true;
          phase = "grab";
        } else if (phase === "grab") {
          c = { left: true, grab: true, up: true, jumpHeld: true };
          if (b.state === "climb") [phase, wait] = ["up", 0];
        } else if (phase === "up") {
          // Climb jumps while there is stamina for one, climbing in between.
          press = b.state === "climb" && --wait <= 0 && b.stamina > 35;
          if (press) wait = 24;
          c = { left: true, grab: true, up: true };
          if (b.y <= 15) phase = "out";
        } else {
          c = { right: true };
          press = phase === "out";
          phase = "run";
        }
        const jumpHeld = press || (c.jumpHeld ?? false);
        p = playFrame(p, { ...NO_CONTROLS, ...c, jumpPressed: press && !held, jumpHeld }, 1 / 60);
        held = jumpHeld;
        if (p.run.dead) return "dead";
        if (p.run.room !== 5) return "out";
      }
      return "stuck";
    };
    const heights = [110, 105, 100, 95, 90, 85, 80];
    const works = heights.filter((y) => route(y) === "out");
    assert.ok(works.length >= 5, `the wall jump across works from ${works.join(", ")}: at least 20 pixels of the climb (half a second)`);
  });

  it("room 3: crossing the gap works for a dash timed anywhere in a tenth of a second or more, jumping from the edge", () => {
    let best = 0;
    for (let walk = 40; walk <= 70; walk += 2) {
      let window = 0;
      for (let dash = 0; dash <= 40; dash++) if (attempt(2, walk, dash, { right: true }, (p) => p.run.room === 3 || p.player.body.x > 175)) window++;
      best = Math.max(best, window);
    }
    assert.ok(best >= 6, `at best ${best} frames of dash timing work`);
  });
});
