/** Plain rules, in plain TypeScript, so a test can call them without a window. */
export const SPEED = 120;

/** Where something at `pos` ends up after `dt` seconds of holding `dir` (-1, 0 or 1) at SPEED. */
export function moveBy(pos: number, dir: number, dt: number): number {
  return pos + dir * SPEED * dt;
}
