/**
 * A seeded random number generator (mulberry32), kept as a plain number so it lives in the run's state: the same seed and the same
 * input always play the same run, which is what the replays and the frame-time tool rely on.
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

/** A hash of two integers to [0, 1): which ground tile a cell shows, the same every time it comes into view. */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
