/**
 * What a level-up offers: three weapons and four passives, each with levels. The run's build is a level per upgrade (0: not
 * taken); the stats functions turn a build into what each weapon does now.
 */
import { roll } from "./rng.ts";

export const UPGRADES = {
  wand: { name: "WAND", text: "BOLTS AT THE NEAREST", max: 6 },
  blades: { name: "BLADES", text: "KNIVES THAT CIRCLE YOU", max: 6 },
  aura: { name: "AURA", text: "HURTS ALL CLOSE BY", max: 6 },
  might: { name: "MIGHT", text: "+20% DAMAGE", max: 5 },
  haste: { name: "HASTE", text: "-10% COOLDOWNS", max: 4 },
  boots: { name: "BOOTS", text: "+12% SPEED", max: 4 },
  magnet: { name: "MAGNET", text: "+40% PICKUP RANGE", max: 4 },
  heart: { name: "HEART", text: "+25 MAX HP, HEAL", max: 4 },
} as const;

export type UpgradeId = keyof typeof UPGRADES;
export type Build = Readonly<Record<UpgradeId, number>>;

export const UPGRADE_IDS = Object.keys(UPGRADES) as readonly UpgradeId[];

/** A run starts with the wand and nothing else. */
export const START_BUILD: Build = { wand: 1, blades: 0, aura: 0, might: 0, haste: 0, boots: 0, magnet: 0, heart: 0 };

/** Experience needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return 5 + level * 7 + Math.floor(level * level * 0.6);
}

const might = (b: Build): number => 1 + 0.2 * b.might;
const haste = (b: Build): number => 1 - 0.1 * b.haste;

/** The wand: every `cooldown` seconds, `count` bolts at the nearest enemies, each going through `pierce` of them. */
export function wandStats(b: Build): { cooldown: number; damage: number; count: number; pierce: number; speed: number; range: number } {
  const l = b.wand;
  return {
    cooldown: Math.max(0.15, (0.8 - 0.07 * l) * haste(b)),
    damage: (6 + 3 * l) * might(b),
    count: 1 + Math.floor(l / 2),
    pierce: 1 + Math.floor((l - 1) / 3),
    speed: 220,
    range: 170,
  };
}

/** The blades: `count` knives circling at `radius`, a turn every `period` seconds, each hitting what it passes through. */
export function bladeStats(b: Build): { count: number; radius: number; period: number; damage: number } {
  const l = b.blades;
  return {
    count: l === 0 ? 0 : 1 + l,
    radius: 34 + 3 * l,
    period: Math.max(0.6, 1.4 - 0.1 * l) * haste(b),
    damage: (8 + 3 * l) * might(b),
  };
}

/** The aura: every `every` seconds, `damage` to each enemy within `radius`, and a shove. */
export function auraStats(b: Build): { radius: number; damage: number; every: number } {
  const l = b.aura;
  return { radius: l === 0 ? 0 : 26 + 6 * l, damage: (3 + 1.5 * l) * might(b), every: 0.5 * haste(b) };
}

export function speedOf(b: Build): number {
  return 1 + 0.12 * b.boots;
}

export function magnetOf(b: Build): number {
  return 1 + 0.4 * b.magnet;
}

export function maxHpOf(b: Build, base: number): number {
  return base + 25 * b.heart;
}

/** Up to three different upgrades not yet at their last level, rolled from `seed`, in the order rolled. */
export function offersFor(b: Build, seed: number): { offers: UpgradeId[]; seed: number } {
  const open = UPGRADE_IDS.filter((id) => b[id] < UPGRADES[id].max);
  const offers: UpgradeId[] = [];
  let s = seed;
  while (offers.length < 3 && open.length > 0) {
    const r = roll(s);
    s = r.seed;
    offers.push(open.splice(Math.floor(r.value * open.length), 1)[0]!);
  }
  return { offers, seed: s };
}

/** The build with `id` a level higher. */
export function raise(b: Build, id: UpgradeId): Build {
  const next = { ...b };
  next[id] = b[id] + 1;
  return next;
}

/** Every upgrade at its last level: the stress scenes' armed player. */
export const FULL_BUILD: Build = { wand: 6, blades: 6, aura: 6, might: 5, haste: 4, boots: 0, magnet: 4, heart: 4 };
