import * as K from "../constants.ts";
import { BODY_H, BODY_W, DUCK_H } from "../constants.ts";
import { climbBegin, climbCheck } from "./climb.ts";
import { startDash } from "./dash.ts";
import { climbJump, jump, superWallJump, wallJump } from "./jumps.ts";
import { approach, canDash, canUnDuck, duck, hitsAt, sign, unDuck, wallJumpCheck, type Step } from "./step.ts";

/**
 * The normal state: grabbing a wall, starting a dash, ducking, running, falling (with a wall slide), and jumping. In that
 * order, as Celeste does it: a grab or a dash ends the step's normal work at once.
 */
export function normalUpdate(s: Step): void {
  const { b, c, dt, moveX, moveY } = s;

  // Grab a wall: beside it now, or just below its edge.
  if (c.grab && b.stamina >= K.CLIMB_TIRED_THRESHOLD && !b.ducking) {
    if (b.vy >= 0 && sign(b.vx) !== -b.facing) {
      if (climbCheck(s, b.facing)) return climbBegin(s);
      if (moveY < 1) {
        for (let i = 1; i <= K.CLIMB_UP_CHECK_DIST; i++) {
          if (!hitsAt(s, 0, -i) && climbCheck(s, b.facing, -i)) {
            b.y -= i;
            return climbBegin(s);
          }
        }
      }
    }
  }
  if (canDash(s)) return startDash(s);

  // Ducking: holding down on the ground, and standing up when let go where there is room.
  if (b.ducking) {
    if (b.onGround && moveY !== 1 && canUnDuck(s)) {
      unDuck(s);
      s.events.push({ type: "stand", x: b.x + BODY_W / 2, y: b.y + BODY_H });
    }
  } else if (b.onGround && moveY === 1 && b.vy >= 0) {
    duck(s);
    s.events.push({ type: "duck", x: b.x + BODY_W / 2, y: b.y + DUCK_H });
  }

  // Running, and slowing toward the run speed when faster (a super jump, a dash) in the direction held.
  if (b.ducking && b.onGround) b.vx = approach(b.vx, 0, K.DUCK_FRICTION * dt);
  else {
    const mult = b.onGround ? 1 : K.AIR_MULT;
    if (Math.abs(b.vx) > K.RUN_SPEED && sign(b.vx) === moveX) b.vx = approach(b.vx, K.RUN_SPEED * moveX, K.RUN_REDUCE * mult * dt);
    else b.vx = approach(b.vx, K.RUN_SPEED * moveX, K.RUN_ACCEL * mult * dt);
  }

  // The fall cap: holding down raises it gradually.
  if (moveY === 1 && b.vy >= K.MAX_FALL) b.maxFall = approach(b.maxFall, K.FAST_MAX_FALL, K.FAST_MAX_ACCEL * dt);
  else b.maxFall = approach(b.maxFall, K.MAX_FALL, K.FAST_MAX_ACCEL * dt);

  // Gravity, halved near the top of a held jump; a wall slide starts slow and speeds up the longer it lasts.
  if (!b.onGround) {
    let max = b.maxFall;
    if ((moveX === b.facing || (moveX === 0 && c.grab)) && moveY !== 1) {
      if (b.vy >= 0 && b.wallSlideTimer > 0 && hitsAt(s, b.facing, 0) && canUnDuck(s)) {
        unDuck(s);
        b.sliding = true;
      }
    }
    if (b.sliding) max = K.MAX_FALL + (K.WALL_SLIDE_START_MAX - K.MAX_FALL) * (b.wallSlideTimer / K.WALL_SLIDE_TIME);
    const mult = Math.abs(b.vy) < K.HALF_GRAV_THRESHOLD && (c.jumpHeld || b.autoJump) ? 0.5 : 1;
    b.vy = approach(b.vy, max, K.GRAVITY * mult * dt);
  }

  // A held jump keeps its speed for a while; letting go ends that.
  if (b.varJump > 0) {
    if (b.autoJump || c.jumpHeld) b.vy = Math.min(b.vy, b.varJumpSpeed);
    else b.varJump = 0;
  }

  // Jumping: from the ground (or just after leaving it), else off a wall within reach (a climb jump if holding it, a wall
  // bounce out of a dash straight up).
  if (b.buffer > 0) {
    if (b.coyote > 0) jump(s);
    else if (canUnDuck(s)) {
      for (const side of [1, -1]) {
        if (!wallJumpCheck(s, side)) continue;
        if (b.facing === side && c.grab && b.stamina > 0) climbJump(s);
        else if (b.dashAttack > 0 && b.dashX === 0 && b.dashY === -1) superWallJump(s, -side);
        else wallJump(s, -side);
        break;
      }
    }
  }
}
