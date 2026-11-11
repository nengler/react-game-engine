import * as K from "../constants.ts";
import { BODY_H, BODY_W, DUCK_H } from "../constants.ts";
import type { GameEvent } from "../events.ts";
import type { Body, Controls, SolidAt } from "./types.ts";

/**
 * One step's work: the body being changed (a copy; the caller's is left alone), the buttons, the room, the time, and where
 * what happens is reported. Every part of the body's rules takes this.
 */
export interface Step {
  readonly b: Body;
  readonly c: Controls;
  readonly solid: SolidAt;
  readonly dt: number;
  readonly events: GameEvent[];
  /** -1, 0 or 1: left and right held. A wall jump can force it for a moment. */
  moveX: number;
  /** -1 up, 1 down, 0 neither. */
  readonly moveY: number;
}

/** The hitbox's height now. */
export function heightOf(b: Body): number {
  return b.ducking ? DUCK_H : BODY_H;
}

/** Is any pixel of a hitbox `h` tall with its top left at (x, y) solid? */
export function hits(solid: SolidAt, x: number, y: number, h: number = BODY_H): boolean {
  // The hitbox is smaller than a tile on both axes, so its corners and the middles of its edges are enough.
  const right = x + BODY_W - 1;
  const bottom = y + h - 1;
  const midY = y + (h >> 1);
  const midX = x + (BODY_W >> 1);
  return (
    solid(x, y) || solid(right, y) || solid(x, bottom) || solid(right, bottom) || solid(x, midY) || solid(right, midY) || solid(midX, y) || solid(midX, bottom)
  );
}

/** Would the body's hitbox be in something solid if it were moved by (dx, dy)? */
export function hitsAt(s: Step, dx: number, dy: number, h: number = heightOf(s.b)): boolean {
  return hits(s.solid, s.b.x + dx, s.b.y + dy, h);
}

export function approach(value: number, target: number, amount: number): number {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

export const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Not ducking, or there is room to stand up. */
export function canUnDuck(s: Step): boolean {
  return !s.b.ducking || !hits(s.solid, s.b.x, s.b.y + DUCK_H - BODY_H, BODY_H);
}

/** Take the short hitbox; its bottom stays where it was. */
export function duck(s: Step): void {
  if (s.b.ducking) return;
  s.b.ducking = true;
  s.b.y += BODY_H - DUCK_H;
}

export function unDuck(s: Step): void {
  if (!s.b.ducking) return;
  s.b.ducking = false;
  s.b.y -= BODY_H - DUCK_H;
}

/** Dash pressed (just now or within the buffer), ready, and one left. */
export function canDash(s: Step): boolean {
  return s.b.dashBuffer > 0 && s.b.dashCooldown <= 0 && s.b.dashes > 0;
}

/** A wall close enough on side `dir` to jump off. */
export function wallJumpCheck(s: Step, dir: number): boolean {
  return hitsAt(s, dir * K.WALL_JUMP_CHECK_DIST, 0);
}

/** Where the body's feet are, in the room: where an event like a jump or a landing happens. */
export function feet(b: Body): { x: number; y: number } {
  return { x: b.x + BODY_W / 2, y: b.y + heightOf(b) };
}
