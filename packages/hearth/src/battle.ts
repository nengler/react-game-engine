/**
 * The shapes the battle's components hand each other: what `Play` keeps in its lists (an enemy that has come, a tower that was
 * built, a shot in the air) and what the colliders carry. The battle itself is in the components: `Play` keeps the gold, the lives
 * and the wave, an `Enemy` walks and takes its hits, a `Tower` aims and fires, a `Shot` flies and lands.
 */
import { HP_PER_WAVE } from "./rules/constants.ts";
import { ENEMIES, type EnemyKind } from "./rules/enemies.ts";
import type { TowerKind } from "./rules/towers.ts";

/** An enemy that has come: what `Play` knows of it. Where it is and how hurt it is are the `Enemy`'s own. */
export interface Foe {
  readonly id: number;
  readonly kind: EnemyKind;
  /** Sideways offset from the path in pixels, from the seeded generator, so a crowd is not one line. */
  readonly lane: number;
  readonly maxHp: number;
}

/** A tower on a pad: what is bought, upgraded and sold. Its aim and its cooldown are the `Tower`'s own. */
export interface Built {
  readonly kind: TowerKind;
  readonly level: number;
  /** Gold put into it: the price and its upgrades. */
  readonly spent: number;
}

/** What a tower fires: a `Shot` flies from (x, y) to (tx, ty) over `flight` seconds and lands as a blast. */
export interface Fired {
  readonly kind: TowerKind;
  readonly x: number;
  readonly y: number;
  readonly tx: number;
  readonly ty: number;
  readonly flight: number;
  /** The one enemy a bolt hits, by id; -1 for a blast that hits everything within `radius`. */
  readonly target: number;
  readonly damage: number;
  readonly radius: number;
  /** Seconds of slow it gives (frost). */
  readonly slow: number;
}

/** A shot in `Play`'s list. */
export interface InFlight extends Fired {
  readonly id: number;
}

/** What Hearth's colliders carry (`<Collider data>`), by tag. */
declare global {
  interface ColliderData {
    /** An enemy, as a tower sees it: who it is, how far along the path, where, and whether it still stands. */
    enemy: { readonly id: number; readonly dist: number; readonly x: number; readonly y: number; readonly hp: number };
    /** A shot landing: what an enemy it touches takes. */
    blast: { readonly target: number; readonly x: number; readonly y: number; readonly radius: number; readonly damage: number; readonly slow: number };
  }
}

/** HP of an enemy of this kind in this wave (0-based). */
export function hpOf(kind: EnemyKind, wave: number): number {
  return Math.round(ENEMIES[kind].hp * (1 + HP_PER_WAVE * wave));
}
