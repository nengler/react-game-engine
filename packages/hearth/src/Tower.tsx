import { Entity, Pointer, Sprite } from "@rge/runtime/jsx";
import { Barrel } from "./Barrel.tsx";
import { useGame } from "./GameState.ts";
import { LevelPips } from "./LevelPips.tsx";
import { MuzzleFlash } from "./MuzzleFlash.tsx";
import { RangeRing } from "./RangeRing.tsx";
import { rangeOf, towerFrame } from "./rules/view.ts";

interface TowerProps {
  id: number;
  x: number;
  y: number;
  kind: "bolt" | "mortar" | "frost";
  level: number;
  angle: number;
  firedAt: number;
}

/** A tower on its pad: the base, the barrel turning toward its target, the pips, the flash of a shot, and its range while the cursor is on it. */
export function Tower({ id, x, y, kind, level, angle, firedAt }: TowerProps) {
  const cursor = useGame((s) => s.cursor);
  const select = useGame((s) => s.select);

  return (
    <Entity name="Tower" transform={{ x, y }}>
      {cursor === id && <RangeRing range={rangeOf(kind, level)} />}
      <Sprite image="tower_bases.png" frameWidth={12} frameHeight={12} frame={towerFrame(kind, level)} originX={6} originY={6} />
      <Barrel frame={towerFrame(kind, level)} angle={angle} />
      <LevelPips level={level} />
      <MuzzleFlash firedAt={firedAt} angle={angle} />
      <Pointer width={10} height={10} transform={{ x: -5, y: -5 }} onPress={() => select(id)} />
      {cursor === id && <Sprite image="cursor.png" originX={7} originY={7} />}
    </Entity>
  );
}
