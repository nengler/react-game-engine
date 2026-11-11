import { SELL_SHARE } from "./constants.ts";
import { MAX_LEVEL, TOWERS, upgradeCost, type TowerKind } from "./towers.ts";
import type { Pad, Tower } from "./battle.ts";

/** Why a command did nothing. */
export type Denied = "gold" | "occupied" | "empty" | "maxed" | "busy";

export type Deal = { readonly ok: true; readonly gold: number; readonly pad: Pad } | { readonly ok: false; readonly reason: Denied };

export function buy(gold: number, pad: Pad, kind: TowerKind): Deal {
  if (pad.tower !== null) return { ok: false, reason: "occupied" };
  const cost = TOWERS[kind].cost;
  if (gold < cost) return { ok: false, reason: "gold" };
  const tower: Tower = { kind, level: 0, cooldown: 0.2, angle: -Math.PI / 2, flash: 0, spent: cost };
  return { ok: true, gold: gold - cost, pad: { ...pad, tower } };
}

export function upgrade(gold: number, pad: Pad): Deal {
  const t = pad.tower;
  if (t === null) return { ok: false, reason: "empty" };
  const cost = upgradeCost(t.kind, t.level);
  if (cost === null || t.level >= MAX_LEVEL) return { ok: false, reason: "maxed" };
  if (gold < cost) return { ok: false, reason: "gold" };
  return { ok: true, gold: gold - cost, pad: { ...pad, tower: { ...t, level: t.level + 1, spent: t.spent + cost } } };
}

/** What selling a tower returns. */
export function refundOf(tower: Tower): number {
  return Math.floor(tower.spent * SELL_SHARE);
}

export function sell(gold: number, pad: Pad): Deal {
  if (pad.tower === null) return { ok: false, reason: "empty" };
  return { ok: true, gold: gold + refundOf(pad.tower), pad: { ...pad, tower: null } };
}
