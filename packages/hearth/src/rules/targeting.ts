import type { Enemy } from "./battle.ts";

/** The enemy in range that is furthest along the path (ties go to the lower id), or null. */
export function pickTarget(x: number, y: number, range: number, enemies: readonly Enemy[]): Enemy | null {
  let best: Enemy | null = null;
  for (const e of enemies) {
    if (e.hp <= 0 || Math.hypot(e.x - x, e.y - y) > range) continue;
    if (best === null || e.dist > best.dist || (e.dist === best.dist && e.id < best.id)) best = e;
  }
  return best;
}
