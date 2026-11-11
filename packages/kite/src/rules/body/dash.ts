import * as K from "../constants.ts";
import { BODY_W } from "../constants.ts";
import { superJump, superWallJump, wallJump } from "./jumps.ts";
import { canUnDuck, duck, heightOf, sign, unDuck, wallJumpCheck, type Step } from "./step.ts";

/**
 * The dash: started from the normal or climb state, it waits a step to read its direction (after the world's freeze), goes at
 * DASH_SPEED for DASH_TIME with no gravity, and ends slower (except downward). A jump during it is a super jump on the ground,
 * a wall bounce going straight up beside a wall, or a wall jump.
 */

export function startDash(s: Step): void {
  const b = s.b;
  b.dashes = Math.max(0, b.dashes - 1);
  b.dashBuffer = 0;
  b.state = "dash";
  b.dashStarting = true;
  b.dashStartedOnGround = b.onGround;
  b.dashCooldown = K.DASH_COOLDOWN;
  b.dashRefillCooldown = K.DASH_REFILL_COOLDOWN;
  b.wallSlideTimer = K.WALL_SLIDE_TIME;
  b.dashAttack = K.DASH_ATTACK_TIME;
  b.beforeDashX = b.vx;
  b.vx = 0;
  b.vy = 0;
  b.dashX = 0;
  b.dashY = 0;
  if (!b.onGround && b.ducking && canUnDuck(s)) unDuck(s);
  s.events.push({ type: "dash", x: b.x + BODY_W / 2, y: b.y + heightOf(b) / 2 });
}

/** One step of the dash state. */
export function dashUpdate(s: Step): void {
  const b = s.b;
  // Jumps out of a dash: a super jump on the ground, a wall bounce going straight up, a wall jump otherwise.
  if (b.buffer > 0 && canUnDuck(s)) {
    if (b.dashY === 0) {
      if (b.coyote > 0) {
        superJump(s);
        return endDash(s);
      }
    } else {
      const up = b.dashX === 0 && b.dashY === -1;
      for (const side of [1, -1]) {
        if (!wallJumpCheck(s, side)) continue;
        if (up) superWallJump(s, -side);
        else wallJump(s, -side);
        return endDash(s);
      }
    }
  }

  if (b.dashStarting) {
    // The direction is read now, after the freeze: eight ways from what is held, the way the body faces when nothing is.
    b.dashStarting = false;
    let dx = s.moveX;
    let dy = s.moveY;
    if (dx === 0 && dy === 0) dx = b.facing;
    const length = Math.hypot(dx, dy);
    dx /= length;
    dy /= length;
    b.vx = dx * K.DASH_SPEED;
    b.vy = dy * K.DASH_SPEED;
    if (sign(b.vx) === sign(b.beforeDashX) && Math.abs(b.beforeDashX) > Math.abs(b.vx)) b.vx = b.beforeDashX;
    b.dashX = dx;
    b.dashY = dy;
    if (dx !== 0) b.facing = sign(dx);
    // Dashing down at an angle on the ground slides along it, ducked: the start of a wavedash.
    if (b.onGround && dx !== 0 && dy > 0 && b.vy > 0) dashSlide(s);
    b.dashTime = K.DASH_TIME;
    return;
  }
  b.dashTime -= s.dt;
  if (b.dashTime <= 0) {
    // The dash ends: up or sideways it slows to END_DASH_SPEED (less going up); down it keeps its speed.
    b.autoJump = true;
    if (b.dashY <= 0) {
      b.vx = b.dashX * K.END_DASH_SPEED;
      b.vy = b.dashY * K.END_DASH_SPEED;
      if (b.vy < 0) b.vy *= K.END_DASH_UP_MULT;
    }
    endDash(s);
  }
}

/** A dash down at an angle meeting the ground becomes a slide along it, ducked, a little faster: a jump from it is a hyper. */
export function dashSlide(s: Step): void {
  const b = s.b;
  b.dashX = sign(b.dashX);
  b.dashY = 0;
  b.vy = 0;
  b.vx *= 1.2;
  duck(s);
}

export function endDash(s: Step): void {
  s.b.state = "normal";
  s.b.dashStarting = false;
  s.b.dashTime = 0;
}
