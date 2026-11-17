import { Entity, Flex, Shape, Text } from "@tsengine/runtime/jsx";

import { SCREEN_WIDTH } from "./rules/constants.ts";
import { COLOR } from "./theme.ts";

interface TopBarProps {
  xp: number;
  need: number;
  level: number;
  time: number;
  kills: number;
  /** How many enemies are alive: shown, as this game is a test of how many the engine can keep up with. */
  enemies: number;
}

/** The experience bar across the top, and under it the level, the clock, the kills and the size of the crowd. */
export function TopBar({ xp, need, level, time, kills, enemies }: TopBarProps) {
  const seconds = Math.floor(time);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Entity>
      <Shape kind="rect" width={SCREEN_WIDTH} height={4} color={COLOR.xpBack} />
      <Shape kind="rect" width={(SCREEN_WIDTH * Math.min(xp, need)) / need} height={4} color={COLOR.xp} />
      <Flex x={0} y={6} width={SCREEN_WIDTH} direction="row" justifyContent="space-between" paddingX={4}>
        <Text color={COLOR.xp}>LV {level}</Text>
        <Text color={COLOR.text}>{clock}</Text>
        <Text color={COLOR.dim}>
          KILLS {kills} FOES {enemies}
        </Text>
      </Flex>
    </Entity>
  );
}
