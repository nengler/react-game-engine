export type TowerKind = "bolt" | "mortar" | "frost";

export interface TowerDef {
  readonly kind: TowerKind;
  readonly name: string;
  readonly cost: number;
  /** Pixels. */
  readonly range: number;
  /** Seconds between shots. */
  readonly rate: number;
  readonly damage: number;
  /** Splash or frost radius in pixels; 0 for a single target. */
  readonly radius: number;
  /** Seconds a mortar shell flies. */
  readonly flight: number;
  /** Frost: the share of speed taken away, and for how long. */
  readonly slow: number;
  readonly slowFor: number;
  /** The key that buys it from the keyboard. */
  readonly key: string;
}

export const TOWERS: Readonly<Record<TowerKind, TowerDef>> = {
  bolt: { kind: "bolt", name: "BOLT", cost: 50, range: 40, rate: 0.4, damage: 6, radius: 0, flight: 0, slow: 0, slowFor: 0, key: "1" },
  mortar: { kind: "mortar", name: "MORTAR", cost: 80, range: 55, rate: 1.6, damage: 18, radius: 14, flight: 0.5, slow: 0, slowFor: 0, key: "2" },
  frost: { kind: "frost", name: "FROST", cost: 60, range: 35, rate: 1.0, damage: 2, radius: 35, flight: 0, slow: 0.4, slowFor: 1.5, key: "3" },
};

/** The towers in the build menu's order. */
export const TOWER_LIST: readonly TowerDef[] = [TOWERS.bolt, TOWERS.mortar, TOWERS.frost];

export const MAX_LEVEL = 2;
/** Each level adds this much damage and range. */
export const DAMAGE_PER_LEVEL = 0.4;
export const RANGE_PER_LEVEL = 0.1;
/** What the upgrade to level 1 and to level 2 cost, as a share of the base cost. */
export const UPGRADE_COST_SHARE: readonly [number, number] = [0.6, 1];

/** What a tower of this kind at this level does. */
export interface TowerStats {
  readonly range: number;
  readonly damage: number;
  readonly radius: number;
}

export function statsOf(kind: TowerKind, level: number): TowerStats {
  const def = TOWERS[kind];
  const range = def.range * (1 + RANGE_PER_LEVEL * level);
  return {
    range,
    damage: def.damage * (1 + DAMAGE_PER_LEVEL * level),
    // A frost pulse covers its whole range, so its radius grows with it.
    radius: kind === "frost" ? range : def.radius,
  };
}

/** Gold to take a tower from `level` to the next, or null at the top. */
export function upgradeCost(kind: TowerKind, level: number): number | null {
  if (level >= MAX_LEVEL) return null;
  return Math.round(TOWERS[kind].cost * (UPGRADE_COST_SHARE[level] as number));
}
