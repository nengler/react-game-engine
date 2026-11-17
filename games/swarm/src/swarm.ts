/**
 * The shapes the run's components hand each other: what `Play` keeps in its lists (an enemy that came, a bolt in the air, a gem
 * on the ground) and what the colliders carry and are sent. Where each thing is and how hurt it is are its own component's.
 */
import type { EnemyKind } from "./rules/enemies.ts";

/** An enemy that came: where it came in, and its hit points then. */
export interface Foe {
  readonly id: number;
  readonly kind: EnemyKind;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
}

/** A bolt the wand fired: from (x, y) at (vx, vy) pixels a second. */
export interface Bolt {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly damage: number;
  readonly pierce: number;
}

/** Experience on the ground. */
export interface Drop {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/** What hurts an enemy: how much, and from where (it is shoved away from that point by `knock` pixels a second). */
export interface Hit {
  readonly damage: number;
  readonly x: number;
  readonly y: number;
  readonly knock: number;
}

declare global {
  interface ColliderData {
    /** An enemy, as the player and the wand see it. */
    enemy: { readonly id: number; readonly damage: number };
    /** A bolt or a blade: what an enemy it touches takes. */
    shot: Hit;
    blade: Hit;
  }
  interface ColliderMessages {
    /** The aura's pulse. */
    enemy: Hit;
  }
}
