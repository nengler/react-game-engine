import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newBody, NO_CONTROLS, stepBody, type Body, type Controls, type SolidAt } from "../src/rules/body.ts";
import type { GameEvent } from "../src/rules/events.ts";
import { createInputState } from "@rge/runtime";
import { readControls } from "../src/rules/controls.ts";
import { BODY_H, COYOTE, DASH_SPEED, JUMP_BUFFER, TILE, WALL_SLIDE_SPEED } from "../src/rules/constants.ts";

const DT = 1 / 60;
const FLOOR = 100;
const flat: SolidAt = (_x, y) => y >= FLOOR;
const STAND_Y = FLOOR - BODY_H;

/** Bodies after each frame (index i is after frame i), and what happened in each frame (`events[i]`). */
type Played = Body[] & { events: GameEvent[][] };

/** Step a body through `frames` frames of a controls function. */
function play(controls: (frame: number, body: Body) => Partial<Controls>, frames: number, start: Partial<Body> = {}, solid: SolidAt = flat): Played {
  let body: Body = { ...newBody(100, STAND_Y), ...start };
  const out = Object.assign([] as Body[], { events: [] as GameEvent[][] });
  for (let i = 0; i < frames; i++) {
    const events: GameEvent[] = [];
    body = stepBody(body, { ...NO_CONTROLS, ...controls(i, body) }, solid, DT, events);
    out.push(body);
    out.events.push(events);
  }
  return out;
}

/** How many `type` events happened up to and including frame `last`. */
const happened = (played: Played, type: GameEvent["type"], last = Infinity): number => played.events.slice(0, last + 1).flat().filter((e) => e.type === type).length;

const rise = (bodies: Body[]): number => STAND_Y - Math.min(...bodies.map((b) => b.y));
const landing = (bodies: Body[], after: number): number => bodies.findIndex((b, i) => i > after && b.onGround);

describe("running", () => {
  it("stands still on the ground with nothing held", () => {
    const bodies = play(() => ({}), 30);
    assert.ok(bodies.every((b) => b.x === 100 && b.y === STAND_Y && b.onGround));
  });

  it("speeds up to the run speed and no further, and stops again when released", () => {
    const bodies = play((i) => ({ right: i < 40 }), 70);
    assert.equal(bodies[39]?.vx, 90);
    assert.equal(bodies[69]?.vx, 0);
    assert.ok((bodies[69]?.x ?? 0) > 100 + 40, "it ran a good way");
  });

  it("is stopped by a wall, and ends the step outside it however fast it was going", () => {
    const wall: SolidAt = (x, y) => y >= FLOOR || x >= 150;
    const bodies = play((i) => ({ right: true, dashPressed: i === 3 }), 60, {}, wall);
    assert.ok(bodies.every((b) => b.x + 8 <= 150), "never inside the wall");
    assert.equal(bodies.at(-1)?.x, 142);
  });
});

describe("jumping", () => {
  it("rises about two and three quarter tiles when the button is held, and about one when tapped", () => {
    const held = rise(play((i) => ({ jumpPressed: i === 1, jumpHeld: i >= 1 }), 80));
    const tapped = rise(play((i) => ({ jumpPressed: i === 1, jumpHeld: i >= 1 && i < 4 }), 80));
    assert.ok(held >= 27 && held <= 30, `held jump rises ${held}`);
    assert.ok(tapped >= 6 && tapped <= 14, `tapped jump rises ${tapped}`);
    assert.ok(held > 2 * TILE, "clears a two-tile ledge");
    assert.ok(held < 3 * TILE, "but not a three-tile one: ledges of three tiles are the dash's job");
  });

  it("covers about six tiles from a run, so a gap of four has a wide margin and one of eight cannot be jumped", () => {
    const bodies = play((i) => ({ right: true, jumpPressed: i === 40, jumpHeld: i >= 40 && i < 100 }), 140);
    const down = landing(bodies, 41);
    const distance = (bodies[down]?.x ?? 0) - (bodies[39]?.x ?? 0);
    assert.ok(distance >= 58 && distance <= 66, `a running jump covers ${distance}px`);
    assert.ok(distance > 4 * TILE * 1.4, "a four-tile gap (the first room) has a margin of more than 40%");
    // Crossing a gap of g pixels from its last floor pixel to its first takes a body travelling g - 6 (it is 8 wide and stands on one pixel).
    assert.ok(distance < 8 * TILE - 6, "an eight-tile gap (the dash room) cannot be crossed by a jump");
  });

  it("jumps when the button is pressed up to the coyote time after leaving a ledge, and not after", () => {
    const ledge: SolidAt = (x, y) => y >= FLOOR && x < 120;
    // Walk right off the ledge, then press jump `late` frames after the body stops being on the ground.
    const jumpAfterLeaving = (late: number): boolean => {
      let body = newBody(100, STAND_Y);
      let left = -1;
      for (let i = 0; i < 80; i++) {
        if (left < 0 && !body.onGround && i > 2) left = i;
        const press = left >= 0 && i === left + late;
        body = stepBody(body, { ...NO_CONTROLS, right: i < left + late || left < 0, jumpPressed: press, jumpHeld: press }, ledge, DT);
        if (press) return body.vy < 0;
      }
      throw new Error("never left the ledge");
    };
    const frames = Math.round(COYOTE / DT);
    assert.equal(jumpAfterLeaving(Math.max(0, frames - 2)), true, "just inside the window");
    assert.equal(jumpAfterLeaving(frames + 3), false, "after the window");
  });

  it("buffers a jump pressed shortly before landing, and drops one pressed too early", () => {
    // Fall from a height, pressing jump `before` frames before the landing step.
    const jumpedOnLanding = (before: number): boolean => {
      let body = newBody(100, STAND_Y - 40);
      body.vy = 0;
      let landed = -1;
      const dry = (): number => {
        let probe = body;
        for (let i = 0; i < 100; i++) {
          probe = stepBody(probe, NO_CONTROLS, flat, DT);
          if (probe.onGround) return i;
        }
        return -1;
      };
      const total = dry();
      const events: GameEvent[] = [];
      const jumped = (): boolean => events.some((e) => e.type === "jump");
      for (let i = 0; i < total + 30; i++) {
        const press = i === total - before;
        body = stepBody(body, { ...NO_CONTROLS, jumpPressed: press, jumpHeld: press || body.vy < 0 }, flat, DT, events);
        if (body.onGround && landed < 0) landed = i;
        if (landed >= 0 && i > landed) return jumped();
      }
      return jumped();
    };
    const window = Math.round(JUMP_BUFFER / DT);
    assert.equal(jumpedOnLanding(window - 2), true);
    assert.equal(jumpedOnLanding(window + 6), false);
  });

  it("slides past a ceiling corner it clips by a few pixels instead of stopping", () => {
    const corner: SolidAt = (x, y) => y >= FLOOR || (y < 70 && x >= 108 - 2 && x < 140);
    const bodies = play((i) => ({ jumpPressed: i === 1, jumpHeld: i >= 1 }), 40, { x: 100 }, corner);
    assert.ok(rise(bodies) >= 27, "the jump was not cut short by the corner");
  });
});

describe("the dash", () => {
  it("goes about five tiles along the ground, and eight ways (diagonals are not faster)", () => {
    const right = play((i) => ({ right: i === 1, dashPressed: i === 1 }), 30);
    assert.ok((right.at(-1)?.x ?? 0) - 100 >= 42, "reaches about five tiles");
    const dist = (c: Partial<Controls>): number => {
      const bodies = play((i) => (i === 1 ? { ...c, dashPressed: true } : {}), 10, { y: 20 }, () => false);
      const last = bodies.at(-1) as Body;
      return Math.hypot(last.x - 100, last.y - 20);
    };
    const straight = dist({ right: true });
    const diagonal = dist({ right: true, up: true });
    assert.ok(Math.abs(straight - diagonal) < 4, `straight ${straight}, diagonal ${diagonal}`);
    assert.ok(Math.abs(dist({ left: true }) - straight) < 2 && Math.abs(dist({ up: true }) - straight) < 2 && Math.abs(dist({ down: true, left: true }) - straight) < 4);
    assert.equal(play((i) => (i === 1 ? { dashPressed: true } : {}), 3, { facing: -1 })[2]?.vx, -DASH_SPEED, "with nothing held it goes the way the character faces");
  });

  it("is used up in the air and comes back on the ground", () => {
    const bodies = play((i) => ({ jumpPressed: i === 1, jumpHeld: i >= 1 && i < 30, right: true, dashPressed: i === 10 || i === 30 || i === 60 }), 140);
    assert.equal(bodies[9]?.dashes, 1);
    assert.equal(bodies[10]?.dashes, 0);
    assert.equal(happened(bodies, "dash", 10), 1);
    assert.equal(happened(bodies, "dash", 31), 1, "a second press in the air does nothing");
    assert.ok(bodies.slice(-20).every((b) => b.onGround && b.dashes === 1), "refilled on landing, and the third press never started before that");
  });

  it("with a jump first, reaches what neither can alone: a ledge over six tiles up, and a gap of eight", () => {
    const up = play((i) => ({ jumpPressed: i === 1, jumpHeld: i >= 1 && i < 20, up: i === 18, dashPressed: i === 18 }), 90);
    assert.ok(rise(up) >= 65, `a jump then a dash up rises ${rise(up)}`);
    const across = play((i) => ({ right: true, jumpPressed: i === 1, jumpHeld: i >= 1 && i < 14, dashPressed: i === 14 }), 120);
    const down = landing(across, 3);
    assert.ok((across[down]?.x ?? 0) - 100 >= 8 * TILE - 6 + 8, `a jump then a dash covers ${(across[down]?.x ?? 0) - 100}, 8px more than the gap needs`);
  });

  it("cannot start again for a moment after it starts", () => {
    const bodies = play((i) => ({ right: true, dashPressed: i === 1 || i === 8 }), 30, { y: 20 }, () => false);
    assert.equal(happened(bodies, "dash"), 1);
  });
});

describe("walls", () => {
  const WALL_X = 140;
  const wall: SolidAt = (x, y) => y >= FLOOR || x >= WALL_X;
  const atWall = { x: WALL_X - 8 - 1, y: 40 };

  it("slides down slowly while held toward it, and falls freely otherwise", () => {
    const sliding = play(() => ({ right: true }), 40, { ...atWall, vy: 100 }, wall);
    assert.equal(sliding.at(-1)?.vy, WALL_SLIDE_SPEED);
    assert.ok(sliding.at(-1)?.sliding);
    const falling = play(() => ({}), 40, { ...atWall, vy: 100 }, (x) => x >= WALL_X);
    assert.ok((falling.at(-1)?.vy ?? 0) > WALL_SLIDE_SPEED);
  });

  it("jumps away from the wall, with the speed away from it, and ignores steering back into it for a moment", () => {
    const bodies = play((i) => ({ right: true, jumpPressed: i === 2, jumpHeld: i >= 2 }), 20, { ...atWall, vy: 20 }, wall);
    assert.equal(happened(bodies, "wallJump", 2), 1);
    assert.ok((bodies[2]?.vx ?? 0) < 0 && (bodies[2]?.vy ?? 0) < 0);
    assert.ok((bodies[6]?.x ?? 999) < atWall.x, "still moving away while the player holds toward the wall");
    assert.equal(bodies[6]?.facing, -1);
  });

  it("jumps off a wall just after leaving it (within reach), not from far away", () => {
    const far = play((i) => ({ jumpPressed: i === 2 }), 6, { x: WALL_X - 8 - 6, y: 40, vy: 20 }, wall);
    assert.equal(happened(far, "wallJump"), 0);
    const near = play((i) => ({ jumpPressed: i === 2 }), 6, { x: WALL_X - 8 - 2, y: 40, vy: 20 }, wall);
    assert.equal(happened(near, "wallJump"), 1);
  });
});

describe("controls", () => {
  const input = (down: string[], pressed: string[] = []) => createInputState({ down, pressed });

  it("read keyboard, gamepad and d-pad alike, and tell a press from a hold", () => {
    assert.deepEqual(readControls(input(["ArrowLeft"])), { ...NO_CONTROLS, left: true });
    assert.deepEqual(readControls(input(["PadRight", "PadUp"])), { ...NO_CONTROLS, right: true, up: true });
    assert.deepEqual(readControls(input(["D", "S"])), { ...NO_CONTROLS, right: true, down: true });
    assert.deepEqual(readControls(input(["PadA"], ["PadA"])), { ...NO_CONTROLS, jumpHeld: true, jumpPressed: true });
    assert.deepEqual(readControls(input(["Space"])), { ...NO_CONTROLS, jumpHeld: true }, "held, not pressed");
    for (const key of ["X", "Shift", "PadX", "PadB", "PadRB"]) assert.equal(readControls(input([key], [key])).dashPressed, true, key);
    assert.equal(readControls(input(["X"])).dashPressed, false, "a dash is a press");
  });
});
