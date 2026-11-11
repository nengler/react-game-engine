import { Entity, Shape } from "@rge/runtime/jsx";

interface HealthBarProps {
  hp: number;
  maxHp: number;
}

/** A thin bar over an enemy that has been hurt: green for what is left on red. */
export function HealthBar({ hp, maxHp }: HealthBarProps) {
  return (
    <Entity name="HealthBar" transform={{ x: -6, y: -11 }}>
      <Shape kind="rect" width={12} height={2} color="#7a2030" />
      <Shape kind="rect" width={(12 * Math.max(hp, 0)) / maxHp} height={2} color="#7de37a" />
    </Entity>
  );
}
