import { Entity, Pointer, Sprite, useState } from "@rge/runtime/jsx";
import { Barrel } from "./Barrel.tsx";
import { useGame } from "./GameState.ts";
import { LevelPips } from "./LevelPips.tsx";
import { MuzzleFlash } from "./MuzzleFlash.tsx";
import { RangeRing } from "./RangeRing.tsx";
import { rangeOf } from "./rules/view.ts";

/** Each kind's row in `tower_bases.png` and `barrels.png`: three levels to a row. */
const ROW = { bolt: 0, mortar: 1, frost: 2 } as const;

interface TowerProps {
  id: number;
  x: number;
  y: number;
  kind: "bolt" | "mortar" | "frost";
  level: number;
  angle: number;
  /** Seconds the muzzle flash still shows. */
  flash: number;
}

/** A tower on its pad: the base, the barrel turning toward its target, the pips, the flash of a shot, and its range while the cursor or the mouse is on it. */
export function Tower({ id, x, y, kind, level, angle, flash }: TowerProps) {
  const selected = useGame((s) => s.cursor === id);
  const select = useGame((s) => s.select);
  const [hovered, setHovered] = useState(false);
  const frame = ROW[kind] * 3 + level;

  return (
    <Entity name="Tower" transform={{ x, y }}>
      {(selected || hovered) && <RangeRing range={rangeOf(kind, level)} />}
      <Sprite image="tower_bases.png" frameWidth={12} frameHeight={12} frame={frame} originX={6} originY={6} />
      <Barrel frame={frame} angle={angle} />
      <LevelPips level={level} />
      <MuzzleFlash on={flash > 0} angle={angle} />
      <Pointer width={10} height={10} transform={{ x: -5, y: -5 }} onPress={() => select(id)} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} />
      {selected && <Sprite image="cursor.png" originX={7} originY={7} />}
    </Entity>
  );
}
