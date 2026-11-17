/** The enemy kinds: how tough and fast each is, what it does to the player, what it drops, and its frames in `sprites.png`. */
export const ENEMIES = {
  bat: { hp: 5, speed: 44, damage: 4, xp: 1, size: 8, frame: 2, color: "#c8a2ff" },
  zombie: { hp: 14, speed: 28, damage: 8, xp: 2, size: 10, frame: 4, color: "#9be38a" },
  brute: { hp: 60, speed: 20, damage: 16, xp: 6, size: 14, frame: 6, color: "#ff9a7a" },
} as const;

export type EnemyKind = keyof typeof ENEMIES;

/** Enemies get tougher as the run goes on: their hit points at `time` seconds. */
export function hpAt(kind: EnemyKind, time: number): number {
  return Math.round(ENEMIES[kind].hp * (1 + time / 150));
}
