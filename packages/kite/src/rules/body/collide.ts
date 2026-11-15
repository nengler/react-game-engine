import { moveActorX, moveActorY } from "@tsengine/runtime";

import * as K from "../constants.ts";
import { BODY_H, DUCK_H } from "../constants.ts";
import { dashSlide } from "./dash.ts";
import { duck, feet, hits, hitsAt, heightOf, type Step } from "./step.ts";

/**
 * Moving the body a pixel at a time (the engine's mover), with Celeste's rules for what happens when it is blocked: a dash
 * ducks into a low gap or slides past a corner, a jump slides past a ceiling's corner, a dash landing by a ledge slides off
 * it, and otherwise the blocked speed stops (sideways, it is kept a moment in case the way clears).
 */

/** Move by the step's speed, sideways then up or down, and see where the body stands after. */
export function move(s: Step, wasOnGround: boolean): void {
  const b = s.b;
  const fall = b.vy;
  const blocked = (x: number, y: number): boolean => hits(s.solid, x, y, heightOf(b));
  moveActorX(b, b.vx * s.dt, blocked, (dir) => onCollideH(s, dir));
  moveActorY(b, b.vy * s.dt, blocked, (dir) => onCollideV(s, dir));
  // Where the body stands now, and a landing.
  b.onGround = b.vy >= 0 && hitsAt(s, 0, 1);
  if (b.onGround && !wasOnGround && fall > 0 && b.state !== "climb") s.events.push({ type: "land", ...feet(b), speed: fall });
  if (b.onGround) b.sliding = false;
}

/** Blocked moving sideways. */
function onCollideH(s: Step, dir: number): void {
  const b = s.b;
  if (b.state === "dash") {
    // A dash along the ground into a gap too low to stand in ducks into it.
    if (b.onGround && !b.ducking && !hits(s.solid, b.x + dir, b.y + BODY_H - DUCK_H, DUCK_H)) {
      duck(s);
      return;
    }
    // A level dash into a corner a few pixels off slides past it.
    if (b.vy === 0 && b.vx !== 0) {
      for (let i = 1; i <= K.DASH_CORNER_CORRECTION; i++) {
        for (const j of [1, -1]) {
          if (!hitsAt(s, dir, i * j)) {
            b.y += i * j;
            b.x += dir;
            return;
          }
        }
      }
    }
  }
  if (b.wallSpeedTimer <= 0) {
    b.wallSpeedRetained = b.vx;
    b.wallSpeedTimer = K.WALL_SPEED_RETENTION_TIME;
  }
  b.vx = 0;
  b.dashAttack = 0;
}

/** Blocked moving up or down. */
function onCollideV(s: Step, dir: number): void {
  const b = s.b;
  if (dir > 0) {
    // A dash landing just past a ledge slides off it instead of landing on its corner.
    if (b.state === "dash" && !b.dashStartedOnGround) {
      for (const side of b.vx <= 0 ? [-1] : [1]) {
        for (let i = 1; i <= K.DASH_CORNER_CORRECTION; i++) {
          if (!hitsAt(s, side * i, 1) && !hitsAt(s, side * i, 0)) {
            b.x += side * i;
            b.y += 1;
            return;
          }
        }
      }
    }
    // Landing in a dash down at an angle: slide along the ground, ducked (a wavedash).
    if (b.state === "dash" && b.dashX !== 0 && b.dashY > 0) dashSlide(s);
  } else {
    // Moving up into a corner: slide past it, the way the body is moving.
    const sides = b.vx < 0 ? [-1] : b.vx > 0 ? [1] : [-1, 1];
    for (const side of sides) {
      for (let i = 1; i <= K.UPWARD_CORNER_CORRECTION; i++) {
        if (!hitsAt(s, side * i, -1)) {
          b.x += side * i;
          b.y -= 1;
          return;
        }
      }
    }
    // A ceiling ends a held jump (unless it was hit straight away: the corner may have been corrected).
    if (b.varJump < K.VAR_JUMP_TIME - K.CEILING_VAR_JUMP_GRACE) b.varJump = 0;
  }
  b.vy = 0;
  b.dashAttack = 0;
}
