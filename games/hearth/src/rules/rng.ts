/**
 * A seeded random number generator (mulberry32), kept as a plain number so it lives in the battle's state: the same seed and
 * the same commands always play the same battle, which is what a test, a replay and the balance table rely on.
 */
export interface Rolled {
  /** A number in [0, 1). */
  readonly value: number;
  /** The seed to roll the next one from. */
  readonly seed: number;
}

export function roll(seed: number): Rolled {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/** A number in [-1, 1). */
export function rollSigned(seed: number): Rolled {
  const r = roll(seed);
  return { value: r.value * 2 - 1, seed: r.seed };
}
