import * as K from "./constants.ts";
import type { GameEvent } from "./events.ts";
import { climbUpdate } from "./body/climb.ts";
import { move } from "./body/collide.ts";
import { dashUpdate } from "./body/dash.ts";
import { normalUpdate } from "./body/normal.ts";
import { canUnDuck, hitsAt, sign, unDuck, type Step } from "./body/step.ts";
import type { Body, Controls, SolidAt } from "./body/types.ts";

/**
 * The character's body: the whole of how it moves, as a plain function of its state, the buttons held, the room's solid
 * pixels and the time step. It draws nothing and keeps nothing between steps, so a test or the solver steps it directly; what
 * happens in a step (a jump, a landing) is pushed onto the `events` the caller passes, for sound and dust to answer.
 *
 * It follows Celeste's player (`Player.cs`, Maddy Thorson and Noel Berry): the same numbers (`constants.ts`) and the same
 * order each step, which `stepBody` below reads as:
 *
 * 1. timers and buffers count down, and the ground gives back the jump's grace, stamina and the dash;
 * 2. what carries over from earlier steps: input held away after a wall jump, a climb jump turned into a wall jump, speed
 *    kept into a wall, a hop over a wall's top;
 * 3. the state's own rules: `normal.ts` (run, fall, jump, grab, duck), `dash.ts` or `climb.ts`, with every kind of jump in
 *    `jumps.ts`;
 * 4. moving a pixel at a time, with what happens when blocked (`collide.ts`).
 *
 * Left out: everything that needs things Kite's rooms do not have (springs, moving blocks, water, wind, holdables).
 */

export { heightOf, hits } from "./body/step.ts";
export { NO_CONTROLS, newBody, type Body, type BodyState, type Controls, type SolidAt } from "./body/types.ts";

/** One step of `dt` seconds. Returns the next body; `body` is not changed. What happened is pushed onto `events`. */
export function stepBody(body: Body, c: Controls, solid: SolidAt, dt: number, events: GameEvent[] = []): Body {
  const b: Body = { ...body };
  const s: Step = { b, c, solid, dt, events, moveX: (c.right ? 1 : 0) - (c.left ? 1 : 0), moveY: (c.down ? 1 : 0) - (c.up ? 1 : 0) };

  // 1. Timers and buffers; the ground.
  b.buffer = c.jumpPressed ? K.JUMP_BUFFER : b.buffer - dt;
  b.dashBuffer = c.dashPressed ? K.DASH_BUFFER : b.dashBuffer - dt;
  if (b.varJump > 0) b.varJump -= dt;
  b.dashCooldown -= dt;
  b.dashRefillCooldown -= dt;
  b.dashAttack -= dt;
  const wasOnGround = b.onGround;
  b.onGround = b.vy >= 0 && hitsAt(s, 0, 1);
  if (b.onGround) {
    b.coyote = K.COYOTE;
    if (b.state !== "climb") {
      b.autoJump = false;
      b.stamina = K.CLIMB_MAX_STAMINA;
      b.wallSlideTimer = K.WALL_SLIDE_TIME;
    }
  } else b.coyote -= dt;
  if (b.dashRefillCooldown <= 0 && b.onGround) b.dashes = K.DASH_COUNT;

  // 2. What carries over from earlier steps.
  carryOver(s);

  // 3. The state's own rules.
  if (b.state === "dash") dashUpdate(s);
  else if (b.state === "climb") climbUpdate(s);
  else normalUpdate(s);

  // Before moving: a level dash just above the floor meets it; a falling duck stands up where there is room.
  if (!b.onGround && b.dashAttack > 0 && b.state === "dash" && b.dashY === 0 && !b.dashStarting) {
    if (hitsAt(s, 0, K.DASH_V_FLOOR_SNAP_DIST)) for (let i = 0; i < K.DASH_V_FLOOR_SNAP_DIST && !hitsAt(s, 0, 1); i++) b.y++;
  }
  if (b.vy > 0 && b.ducking && canUnDuck(s) && !b.onGround) unDuck(s);

  // 4. Move.
  move(s, wasOnGround);
  return b;
}

/** The parts of earlier steps that act on this one. */
function carryOver(s: Step): void {
  const { b, dt } = s;
  // Input held away from a wall after a wall jump.
  if (b.forceMoveTime > 0) {
    b.forceMoveTime -= dt;
    s.moveX = b.forceMoveX;
  }
  // A climb jump turned into a wall jump by pushing away.
  if (b.wallBoostTimer > 0) {
    b.wallBoostTimer -= dt;
    if (s.moveX === b.wallBoostDir) {
      b.vx = K.WALL_JUMP_H_SPEED * s.moveX;
      b.stamina += K.CLIMB_JUMP_COST;
      b.wallBoostTimer = 0;
    }
  }
  // The wall slide's time runs while sliding; whether it still slides is this step's to say.
  if (b.sliding) b.wallSlideTimer = Math.max(b.wallSlideTimer - dt, 0);
  b.sliding = false;
  if (s.moveX !== 0 && b.state !== "climb") b.facing = s.moveX;
  // Speed into a wall kept a moment: taken back up if the way clears.
  if (b.wallSpeedTimer > 0) {
    if (sign(b.vx) === -sign(b.wallSpeedRetained)) b.wallSpeedTimer = 0;
    else if (!hitsAt(s, sign(b.wallSpeedRetained), 0)) {
      b.vx = b.wallSpeedRetained;
      b.wallSpeedTimer = 0;
    } else b.wallSpeedTimer -= dt;
  }
  // The hop over a wall's top: across once the top is passed.
  if (b.hopWaitX !== 0) {
    if (sign(b.vx) === -b.hopWaitX || b.vy > 0) b.hopWaitX = 0;
    else if (!hitsAt(s, b.hopWaitX, 0)) {
      b.vx = b.hopWaitXSpeed;
      b.hopWaitX = 0;
    }
  }
}

/** Which animation of the character's sheet shows this body (`dead`: the run's, not the body's). */
export function animationOf(b: Body, dead: boolean): string {
  if (dead) return "die";
  if (b.state === "dash") return "dash";
  if (b.state === "climb" || b.sliding) return "wall";
  if (!b.onGround) return b.vy < 0 ? "jump" : "fall";
  return Math.abs(b.vx) > 12 && !b.ducking ? "run" : "idle";
}
