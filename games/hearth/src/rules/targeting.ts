/** An enemy as a tower sees it (its collider's data). */
export interface Seen {
  readonly id: number;
  readonly dist: number;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

/** The enemy in range that is furthest along the path (ties go to the lower id), or null. */
export function pickTarget(x: number, y: number, range: number, enemies: readonly Seen[]): Seen | null {
  let best: Seen | null = null;
  for (const e of enemies) {
    if (e.hp <= 0 || Math.hypot(e.x - x, e.y - y) > range) continue;
    if (best === null || e.dist > best.dist || (e.dist === best.dist && e.id < best.id)) best = e;
  }
  return best;
}
