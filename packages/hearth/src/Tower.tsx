import { Entity, Sprite, useBody, useMutable, useUpdate } from "@rge/runtime/jsx";

import { Barrel } from "./Barrel.tsx";
import type { Fired } from "./battle.ts";
import { sfx } from "./effects.ts";
import { LevelPips } from "./LevelPips.tsx";
import { MuzzleFlash } from "./MuzzleFlash.tsx";
import { RangeRing } from "./RangeRing.tsx";
import { MUZZLE, TRACER } from "./rules/constants.ts";
import { rollSigned } from "./rules/rng.ts";
import { pickTarget } from "./rules/targeting.ts";
import { MAX_LEVEL, statsOf, TOWERS } from "./rules/towers.ts";

/** Each kind's row in `tower_bases.png` and `barrels.png`: three levels to a row. */
const ROW = { bolt: 0, mortar: 1, frost: 2 } as const;

interface TowerProps {
  /** What the scatter of its mortar shells is rolled from. */
  seed: number;
  kind: "bolt" | "mortar" | "frost";
  level: number;
  /** Where it stands on the field (its pad's middle). */
  x: number;
  y: number;
  /** Show how far it reaches. */
  ring: boolean;
  onFire: (shot: Fired) => void;
}

/**
 * A tower: it cools down, turns toward the enemy in range that is furthest along the path, and fires at it. A bolt hits that enemy;
 * a mortar shell lands where it was, a little off, and hits everything near; a frost pulse hits and slows everything in range.
 * It finds the enemies near it by asking what overlaps a box as big as its longest reach (`overlapping("enemy")`), and reads where
 * each one is from its collider's data. It draws the base, the barrel, the pips, the flash of a shot, and its range.
 */
export function Tower({ seed, kind, level, x, y, ring, onFire }: TowerProps) {
  const s = useMutable({ cooldown: 0.2, angle: -Math.PI / 2, flash: 0, scatter: seed });
  const stats = statsOf(kind, level);
  const reach = statsOf(kind, MAX_LEVEL).range;
  const { overlapping } = useBody({ x: -reach, y: -reach, width: reach * 2, height: reach * 2 });
  const frame = ROW[kind] * 3 + level;

  useUpdate((dt) => {
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
    s.cooldown = Math.max(0, s.cooldown - dt);
    const target = pickTarget(
      x,
      y,
      stats.range,
      overlapping("enemy").map((enemy) => enemy.data)
    );
    if (target === null) return;
    s.angle = Math.atan2(target.y - y, target.x - x);
    if (s.cooldown > 0) return;
    s.cooldown = TOWERS[kind].rate;
    s.flash = MUZZLE;
    sfx.play(kind);
    if (kind === "bolt") {
      onFire({ kind, x, y, tx: target.x, ty: target.y, flight: TRACER, target: target.id, damage: stats.damage, radius: 0, slow: 0 });
    } else if (kind === "frost") {
      onFire({
        kind,
        x,
        y,
        tx: x,
        ty: y,
        flight: TRACER,
        target: -1,
        damage: stats.damage,
        radius: stats.radius,
        slow: TOWERS.frost.slowFor,
      });
    } else {
      // The shell lands where the target is now, a little off.
      const rx = rollSigned(s.scatter);
      const ry = rollSigned(rx.seed);
      s.scatter = ry.seed;
      onFire({
        kind,
        x,
        y,
        tx: target.x + rx.value * 3,
        ty: target.y + ry.value * 3,
        flight: TOWERS.mortar.flight,
        target: -1,
        damage: stats.damage,
        radius: stats.radius,
        slow: 0,
      });
    }
  });

  return (
    <Entity>
      {ring && <RangeRing range={stats.range} />}
      <Sprite image="tower_bases.png" frameWidth={12} frameHeight={12} frame={frame} originX={6} originY={6} />
      <Barrel frame={frame} angle={s.angle} />
      <LevelPips level={level} />
      <MuzzleFlash on={s.flash > 0} angle={s.angle} />
    </Entity>
  );
}
