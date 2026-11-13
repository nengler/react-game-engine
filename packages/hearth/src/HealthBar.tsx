import { Entity, Shape } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

interface HealthBarProps {
  hp: number;
  maxHp: number;
}

/** A thin bar over an enemy that has been hurt: green for what is left on red. */
export function HealthBar({ hp, maxHp }: HealthBarProps) {
  return (
    <Entity transform={{ x: -6, y: -11 }}>
      <Shape kind="rect" width={12} height={2} color={COLOR.hurt} />
      <Shape kind="rect" width={(12 * Math.max(hp, 0)) / maxHp} height={2} color={COLOR.good} />
    </Entity>
  );
}
