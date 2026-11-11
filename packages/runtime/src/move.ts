/**
 * Moving a box through a world of solid pixels, a pixel at a time, so it never ends a step inside something however fast it
 * goes, and pixel art stays on the pixel grid. Plain functions for a game's rules: what is solid (`blocked`) and what a
 * collision means (`onBlocked`) are the game's.
 */

/** A box's whole-pixel position (`x`, `y`) and what is left over below a pixel (`rx`, `ry`), carried to the next move. */
export interface PixelActor {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Would the box overlap something solid with its top left at (x, y)? */
export type Blocked = (x: number, y: number) => boolean;

/**
 * Move `actor` by `amount` pixels along x: the remainder is added up, and the whole pixels are taken one at a time while the
 * next one is clear. When the next pixel is blocked the remainder is dropped, `onBlocked(direction)` is called (it may move the
 * actor itself: around a corner, say) and the move stops there. Returns whether it was blocked.
 */
export function moveActorX(actor: PixelActor, amount: number, blocked: Blocked, onBlocked?: (direction: number) => void): boolean {
  actor.rx += amount;
  let steps = Math.round(actor.rx);
  actor.rx -= steps;
  const direction = steps < 0 ? -1 : 1;
  while (steps !== 0) {
    if (blocked(actor.x + direction, actor.y)) {
      actor.rx = 0;
      onBlocked?.(direction);
      return true;
    }
    actor.x += direction;
    steps -= direction;
  }
  return false;
}

/** `moveActorX` along y. */
export function moveActorY(actor: PixelActor, amount: number, blocked: Blocked, onBlocked?: (direction: number) => void): boolean {
  actor.ry += amount;
  let steps = Math.round(actor.ry);
  actor.ry -= steps;
  const direction = steps < 0 ? -1 : 1;
  while (steps !== 0) {
    if (blocked(actor.x, actor.y + direction)) {
      actor.ry = 0;
      onBlocked?.(direction);
      return true;
    }
    actor.y += direction;
    steps -= direction;
  }
  return false;
}
