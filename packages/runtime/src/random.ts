/**
 * Random numbers that repeat: a seeded generator (mulberry32) whose whole state is one number, so it lives in a component's state
 * or the game state, where saves, hot reload, rewind, `tse session` snapshots and replays keep it. The same seed and the same input
 * always play the same game, which `Math.random` cannot (the compiler warns about it).
 *
 *     const s = useMutable({ seed: 1, x: 0 });
 *     const r = rollBetween(s.seed, -8, 8);   // { value, seed }
 *     s.x += r.value;
 *     s.seed = r.seed;                         // the next roll starts from here
 *
 * Every roll returns the value and the seed to roll the next one from; keep that seed, or the next roll repeats this one.
 */

/** A roll: the value, and the seed the next roll starts from. */
export interface Rolled<T = number> {
  readonly value: T;
  readonly seed: number;
}

/** A number in [0, 1), and the next seed. Any number is a seed (it is taken as a 32-bit integer). */
export function roll(seed: number): Rolled {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/** A number in [min, max), and the next seed. */
export function rollBetween(seed: number, min: number, max: number): Rolled {
  const r = roll(seed);
  return { value: min + r.value * (max - min), seed: r.seed };
}

/** A whole number from `min` to `max`, both included (a die is `rollInt(seed, 1, 6)`), and the next seed. */
export function rollInt(seed: number, min: number, max: number): Rolled {
  const r = roll(seed);
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return { value: low + Math.floor(r.value * (high - low + 1)), seed: r.seed };
}

/** One item of a list, each as likely, and the next seed. An empty list gives `undefined`. */
export function rollPick<T>(seed: number, items: readonly T[]): Rolled<T | undefined> {
  const r = roll(seed);
  return { value: items[Math.floor(r.value * items.length)], seed: r.seed };
}

/** True with probability `chance` (0 to 1), and the next seed. */
export function rollChance(seed: number, chance: number): Rolled<boolean> {
  const r = roll(seed);
  return { value: r.value < chance, seed: r.seed };
}
