import { Entity, Shape } from "@rge/runtime/jsx";
import { COLOR } from "./theme.ts";

/** The three pips' places, one for each level a tower can have. */
const PIPS = [0, 1, 2];

interface LevelPipsProps {
  level: number;
}

/** A dot under the tower for each level it has (one at level 1, three at the top). */
export function LevelPips({ level }: LevelPipsProps) {
  return (
    <Entity transform={{ x: -5, y: 6 }}>
      {PIPS.filter((i) => i <= level).map((i) => (
        <Shape key={i} kind="rect" width={2} height={2} color={COLOR.text} transform={{ x: i * 4, y: 0 }} />
      ))}
    </Entity>
  );
}
