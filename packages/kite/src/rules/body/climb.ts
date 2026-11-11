import * as K from "../constants.ts";
import { BODY_W } from "../constants.ts";
import { startDash } from "./dash.ts";
import { climbJump, wallJump } from "./jumps.ts";
import { approach, canDash, canUnDuck, hitsAt, sign, type Step } from "./step.ts";

/**
 * Holding onto a wall: climb up or down at a set speed on stamina (more going up, a little holding still), slip down where the
 * wall's top is beside the hands, hop over the top, jump up the wall or away from it, or let go.
 */

/** A wall close enough on side `dir` to grab, `yAdd` pixels up or down. */
export function climbCheck(s: Step, dir: number, yAdd = 0): boolean {
  return hitsAt(s, dir * K.CLIMB_CHECK_DIST, yAdd);
}

/** Is the wall's top beside the body clear, so a climb up there would go over it? */
function slipCheck(s: Step, addY = 0): boolean {
  const b = s.b;
  const px = b.facing > 0 ? b.x + BODY_W : b.x - 1;
  const py = b.y + 4 + addY;
  return !s.solid(px, py) && !s.solid(px, py - 4 + addY);
}

/** Grab the wall the body faces: stop, keep a little of the fall, and step up to the wall. */
export function climbBegin(s: Step): void {
  const b = s.b;
  b.state = "climb";
  b.autoJump = false;
  b.vx = 0;
  b.vy *= K.CLIMB_GRAB_Y_MULT;
  b.wallSlideTimer = K.WALL_SLIDE_TIME;
  b.climbNoMove = K.CLIMB_NO_MOVE_TIME;
  b.wallBoostTimer = 0;
  b.lastClimbMove = 0;
  for (let i = 0; i < K.CLIMB_CHECK_DIST; i++) {
    if (!hitsAt(s, b.facing, 0)) b.x += b.facing;
    else break;
  }
}

/** One step of the climb state. */
export function climbUpdate(s: Step): void {
  const { b, c, dt, moveY } = s;
  b.climbNoMove -= dt;
  if (b.onGround) b.stamina = K.CLIMB_MAX_STAMINA;
  if (b.buffer > 0 && canUnDuck(s)) {
    b.state = "normal";
    if (s.moveX === -b.facing) wallJump(s, -b.facing);
    else climbJump(s);
    return;
  }
  if (canDash(s)) return startDash(s);
  if (!c.grab) {
    b.state = "normal";
    return;
  }
  if (!hitsAt(s, b.facing, 0)) {
    // The wall ended beside the body: going up, hop over its top.
    if (b.vy < 0) climbHop(s);
    b.state = "normal";
    return;
  }
  let target = 0;
  let trySlip = false;
  if (b.climbNoMove <= 0) {
    if (moveY === -1) {
      target = -K.CLIMB_UP_SPEED;
      if (hitsAt(s, 0, -1) || (hitsAt(s, 0, -6) && slipCheck(s, -1))) {
        if (b.vy < 0) b.vy = 0;
        target = 0;
        trySlip = true;
      } else if (slipCheck(s)) {
        climbHop(s);
        b.state = "normal";
        return;
      }
    } else if (moveY === 1) {
      target = K.CLIMB_DOWN_SPEED;
      if (b.onGround) {
        if (b.vy > 0) b.vy = 0;
        target = 0;
      }
    } else trySlip = true;
  } else trySlip = true;
  b.lastClimbMove = sign(target);
  // Holding on where the wall's top is beside the hands: the hands slip down to it.
  if (trySlip && slipCheck(s)) target = K.CLIMB_SLIP_SPEED;
  b.vy = approach(b.vy, target, K.CLIMB_ACCEL * dt);
  // Not climbing down off the bottom of a wall.
  if (moveY !== 1 && b.vy > 0 && !hitsAt(s, b.facing, 1)) b.vy = 0;
  if (b.climbNoMove <= 0) {
    if (b.lastClimbMove === -1) b.stamina -= K.CLIMB_UP_COST * dt;
    else if (b.lastClimbMove === 0) b.stamina -= K.CLIMB_STILL_COST * dt;
  }
  if (b.stamina <= 0) b.state = "normal";
}

/** Over the top of a wall: up first, and across once the top is passed. */
function climbHop(s: Step): void {
  const b = s.b;
  if (hitsAt(s, b.facing, 0)) {
    b.hopWaitX = b.facing;
    b.hopWaitXSpeed = b.facing * K.CLIMB_HOP_X;
  } else {
    b.hopWaitX = 0;
    b.vx = b.facing * K.CLIMB_HOP_X;
  }
  b.vy = Math.min(b.vy, -K.CLIMB_HOP_Y);
  b.forceMoveX = 0;
  b.forceMoveTime = K.CLIMB_HOP_FORCE_TIME;
}
