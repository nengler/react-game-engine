import type { Battle } from "./battle.ts";
import { refundOf } from "./economy.ts";
import type { TowerKind } from "./towers.ts";
import { statsOf, TOWERS, upgradeCost } from "./towers.ts";

/** How far a tower of this kind and level reaches. */
export function rangeOf(kind: TowerKind, level: number): number {
  return statsOf(kind, level).range;
}

/** What the panel shows about the pad the cursor is on: `useGame((s) => focusOf(s.battle, s.cursor))`. */
export interface Focus {
  readonly occupied: boolean;
  readonly title: string;
  readonly damage: number;
  readonly range: number;
  /** Gold for the next upgrade, or -1 at the top level. */
  readonly upgrade: number;
  readonly refund: number;
}

export const NO_FOCUS: Focus = { occupied: false, title: "", damage: 0, range: 0, upgrade: -1, refund: 0 };

export function focusOf(battle: Battle, cursor: number): Focus {
  const tower = battle.pads[cursor]?.tower ?? null;
  if (tower === null) return NO_FOCUS;
  const stats = statsOf(tower.kind, tower.level);
  return {
    occupied: true,
    title: `${TOWERS[tower.kind].name} L${tower.level + 1}`,
    damage: Math.round(stats.damage * 10) / 10,
    range: Math.round(stats.range),
    upgrade: upgradeCost(tower.kind, tower.level) ?? -1,
    refund: refundOf(tower),
  };
}
