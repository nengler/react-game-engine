import { Entity, Shape } from "@rge/runtime/jsx";
import { PIPS } from "./rules/view.ts";

interface LevelPipsProps {
  level: number;
}

/** A dot under the tower for each level it has (one at level 1, three at the top). */
export function LevelPips({ level }: LevelPipsProps) {
  return (
    <Entity name="LevelPips" transform={{ x: -5, y: 6 }}>
      {PIPS.filter((i) => i <= level).map((i) => (
        <Shape key={i} kind="rect" width={2} height={2} color="#fff1d6" transform={{ x: i * 4, y: 0 }} />
      ))}
    </Entity>
  );
}
