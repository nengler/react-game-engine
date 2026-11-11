import type { Battle, Pad, Tower } from "./battle.ts";
import { refundOf } from "./economy.ts";
import type { TowerKind } from "./towers.ts";
import { statsOf, TOWERS, upgradeCost } from "./towers.ts";

/** The pictures components pick, by name: components cannot hold constants or index a table in an expression, so the tables live here. */
const TOWER_INDEX: Record<TowerKind, number> = { bolt: 0, mortar: 1, frost: 2 };

/** A tower's frame in `tower_bases.png` and `barrels.png`: three levels to a row, a row per kind. */
export function towerFrame(kind: TowerKind, level: number): number {
  return TOWER_INDEX[kind] * 3 + level;
}

/** A tower's icon in `icons.png`. */
export function iconOf(kind: TowerKind): number {
  return TOWER_INDEX[kind];
}

/** How far a tower of this kind and level reaches. */
export function rangeOf(kind: TowerKind, level: number): number {
  return statsOf(kind, level).range;
}

/** The three pips under a tower, one for each level it has. */
export const PIPS: readonly number[] = [0, 1, 2];

/** What the panel needs to know about the pad the cursor is on, worked out once per step so no component indexes the battle. */
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

/** A tower on its pad, flat, as a component takes it. */
export interface TowerView extends Tower {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** The pads split by whether they hold a tower. WORKAROUND(tier3-cond-map): the play screen draws a pad as an empty pad or a tower with `pads.map(p => p.tower ? … : …)` once conditionals are allowed in a list's map. */
export function splitPads(pads: readonly Pad[]): { towers: TowerView[]; empty: Pad[] } {
  const towers: TowerView[] = [];
  const empty: Pad[] = [];
  for (const p of pads) {
    if (p.tower === null) empty.push(p);
    else towers.push({ ...p.tower, id: p.id, x: p.x, y: p.y });
  }
  return { towers, empty };
}
