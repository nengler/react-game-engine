import { Sprite } from "@rge/runtime/jsx";
import { Barrel } from "./Barrel.tsx";
import { LevelPips } from "./LevelPips.tsx";
import { MuzzleFlash } from "./MuzzleFlash.tsx";
import { RangeRing } from "./RangeRing.tsx";
import { rangeOf } from "./rules/view.ts";

/** Each kind's row in `tower_bases.png` and `barrels.png`: three levels to a row. */
const ROW = { bolt: 0, mortar: 1, frost: 2 } as const;

interface TowerProps {
  kind: "bolt" | "mortar" | "frost";
  level: number;
  angle: number;
  /** Seconds the muzzle flash still shows. */
  flash: number;
  /** Show how far it reaches. */
  ring: boolean;
}

/** A tower, drawn at its pad's middle: the base, the barrel turning toward its target, the pips, the flash of a shot, and its range. */
export function Tower({ kind, level, angle, flash, ring }: TowerProps) {
  const frame = ROW[kind] * 3 + level;

  return (
    <>
      {ring && <RangeRing range={rangeOf(kind, level)} />}
      <Sprite image="tower_bases.png" frameWidth={12} frameHeight={12} frame={frame} originX={6} originY={6} />
      <Barrel frame={frame} angle={angle} />
      <LevelPips level={level} />
      <MuzzleFlash on={flash > 0} angle={angle} />
    </>
  );
}
