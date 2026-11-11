export type EnemyKind = "runner" | "grunt" | "brute";

export interface EnemyDef {
  readonly kind: EnemyKind;
  readonly name: string;
  readonly hp: number;
  /** Pixels a second along the path. */
  readonly speed: number;
  readonly gold: number;
  /** Lives it takes when it reaches the hearth. */
  readonly lives: number;
}

export const ENEMIES: Readonly<Record<EnemyKind, EnemyDef>> = {
  runner: { kind: "runner", name: "RUNNER", hp: 14, speed: 40, gold: 4, lives: 1 },
  grunt: { kind: "grunt", name: "GRUNT", hp: 30, speed: 25, gold: 6, lives: 1 },
  brute: { kind: "brute", name: "BRUTE", hp: 120, speed: 14, gold: 15, lives: 3 },
};
