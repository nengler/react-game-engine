import * as K from "../constants.ts";
import { BODY_W } from "../constants.ts";
import { feet, heightOf, unDuck, type Step } from "./step.ts";

/**
 * Every kind of jump: from the ground, a super jump out of a dash (a hyper when ducking), off a wall, a wall bounce out of a
 * dash straight up, and a climb jump up a wall held onto. Each sets the speed and how long a held button keeps it.
 */

/** What every jump resets: the buffer and grace are used up, and a held jump keeps its speed for `varJump`. */
function jumpResets(s: Step, varJump: number): void {
  const b = s.b;
  b.buffer = 0;
  b.coyote = 0;
  b.varJump = varJump;
  b.autoJump = false;
  b.dashAttack = 0;
  b.wallSlideTimer = K.WALL_SLIDE_TIME;
  b.wallBoostTimer = 0;
}

export function jump(s: Step): void {
  const b = s.b;
  jumpResets(s, K.VAR_JUMP_TIME);
  b.vx += K.JUMP_H_BOOST * s.moveX;
  b.vy = -K.JUMP_SPEED;
  b.varJumpSpeed = b.vy;
  s.events.push({ type: "jump", ...feet(b) });
}

/** A jump during a horizontal dash on the ground: long and low, longer and lower ducking (a hyper). */
export function superJump(s: Step): void {
  const b = s.b;
  jumpResets(s, K.VAR_JUMP_TIME);
  b.vx = K.SUPER_JUMP_H * b.facing;
  b.vy = -K.JUMP_SPEED;
  if (b.ducking) {
    unDuck(s);
    b.vx *= K.DUCK_SUPER_JUMP_X_MULT;
    b.vy *= K.DUCK_SUPER_JUMP_Y_MULT;
  }
  b.varJumpSpeed = b.vy;
  s.events.push({ type: "jump", ...feet(b) });
}

/** Off a wall: `dir` is away from it. With a direction held, it is held away for a moment. */
export function wallJump(s: Step, dir: number): void {
  const b = s.b;
  unDuck(s);
  jumpResets(s, K.VAR_JUMP_TIME);
  if (s.moveX !== 0) {
    b.forceMoveX = dir;
    b.forceMoveTime = K.WALL_JUMP_FORCE_TIME;
  }
  b.vx = K.WALL_JUMP_H_SPEED * dir;
  b.vy = -K.JUMP_SPEED;
  b.varJumpSpeed = b.vy;
  s.events.push({ type: "wallJump", x: dir > 0 ? b.x : b.x + BODY_W, y: b.y + heightOf(b), wall: -dir });
}

/** A jump off a wall during a dash straight up: the wall bounce. */
export function superWallJump(s: Step, dir: number): void {
  const b = s.b;
  unDuck(s);
  jumpResets(s, K.SUPER_WALL_JUMP_VAR_TIME);
  b.vx = K.SUPER_WALL_JUMP_H * dir;
  b.vy = -K.SUPER_WALL_JUMP_SPEED;
  b.varJumpSpeed = b.vy;
  s.events.push({ type: "wallJump", x: dir > 0 ? b.x : b.x + BODY_W, y: b.y + heightOf(b), wall: -dir });
}

/** A jump straight up a wall held onto. Costs stamina in the air; push away just after to make it a wall jump. */
export function climbJump(s: Step): void {
  const b = s.b;
  if (!b.onGround) b.stamina -= K.CLIMB_JUMP_COST;
  jump(s);
  if (s.moveX === 0) {
    b.wallBoostDir = -b.facing;
    b.wallBoostTimer = K.CLIMB_JUMP_BOOST_TIME;
  }
}
