import type { EnemyKind } from "./enemies.ts";

/** A group of one kind of enemy: `count` of them, `gap` seconds apart, the first `delay` seconds after the wave starts. */
export interface Group {
  readonly kind: EnemyKind;
  readonly count: number;
  readonly gap: number;
  readonly delay: number;
}

/** The ten waves, hand-written. The player starts each with a button; wave 10 is the last. */
export const WAVES: readonly (readonly Group[])[] = [
  [{ kind: "runner", count: 8, gap: 1.0, delay: 0 }],
  [{ kind: "grunt", count: 10, gap: 0.9, delay: 0 }],
  [{ kind: "runner", count: 10, gap: 0.6, delay: 0 }, { kind: "grunt", count: 8, gap: 1.0, delay: 6 }],
  [{ kind: "grunt", count: 15, gap: 0.7, delay: 0 }, { kind: "brute", count: 1, gap: 1, delay: 12 }],
  [{ kind: "runner", count: 20, gap: 0.4, delay: 0 }, { kind: "grunt", count: 10, gap: 0.8, delay: 10 }],
  [{ kind: "brute", count: 3, gap: 3, delay: 0 }, { kind: "grunt", count: 20, gap: 0.6, delay: 4 }],
  [{ kind: "runner", count: 30, gap: 0.35, delay: 0 }, { kind: "brute", count: 4, gap: 2.5, delay: 8 }],
  [{ kind: "grunt", count: 40, gap: 0.45, delay: 0 }, { kind: "brute", count: 5, gap: 2, delay: 5 }],
  [{ kind: "runner", count: 30, gap: 0.3, delay: 0 }, { kind: "grunt", count: 30, gap: 0.4, delay: 5 }, { kind: "brute", count: 8, gap: 1.5, delay: 14 }],
  [{ kind: "grunt", count: 50, gap: 0.3, delay: 0 }, { kind: "runner", count: 30, gap: 0.3, delay: 6 }, { kind: "brute", count: 10, gap: 1.5, delay: 10 }],
];

export interface Spawn {
  /** Seconds after the wave starts. */
  readonly at: number;
  readonly kind: EnemyKind;
}

/** Every enemy of a wave (0-based) with the time it comes in, earliest first (groups keep their order for the same time). */
export function spawnsOf(wave: number, table: readonly (readonly Group[])[] = WAVES): readonly Spawn[] {
  const out: Spawn[] = [];
  for (const g of table[wave] ?? []) for (let i = 0; i < g.count; i++) out.push({ at: g.delay + i * g.gap, kind: g.kind });
  return out.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i).map(({ s }) => s);
}

/** How many waves there are (a component cannot read `WAVES.length`). */
export const WAVE_COUNT = WAVES.length;
