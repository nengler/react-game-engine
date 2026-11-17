/**
 * Who comes, and how many: the number of enemies the run wants alive at each moment, and which kind the next one is. The spawner
 * in `Play` tops the crowd up to `targetAt(time)` each step (at most `SPAWN_PER_STEP` at once).
 */
import { ENEMY_CAP } from "./constants.ts";
import type { EnemyKind } from "./enemies.ts";
import { roll } from "./rng.ts";

/**
 * How many enemies the run wants alive at `time` seconds: a few at first, about 300 at two minutes, 1,500 by six and the cap
 * before the end. A swarm game's whole difficulty curve, and what makes this one a test of the engine.
 */
export function targetAt(time: number, cap = ENEMY_CAP): number {
  const minutes = time / 60;
  return Math.min(cap, Math.floor(12 + 100 * minutes + 25 * minutes * minutes));
}

/** The kind of the next enemy, rolled from `seed`: bats at first, zombies from half a minute, brutes from two minutes. */
export function kindAt(time: number, seed: number): { kind: EnemyKind; seed: number } {
  const r = roll(seed);
  const zombies = time < 30 ? 0 : Math.min(0.45, 0.15 + time / 600);
  const brutes = time < 120 ? 0 : Math.min(0.15, 0.03 + time / 3000);
  const kind: EnemyKind = r.value < brutes ? "brute" : r.value < brutes + zombies ? "zombie" : "bat";
  return { kind, seed: r.seed };
}

/** Where on the ring around (px, py) the next enemy comes in, rolled from `seed`. */
export function ringAt(px: number, py: number, radius: number, seed: number): { x: number; y: number; seed: number } {
  const r = roll(seed);
  const angle = r.value * Math.PI * 2;
  return { x: px + Math.cos(angle) * radius, y: py + Math.sin(angle) * radius, seed: r.seed };
}
