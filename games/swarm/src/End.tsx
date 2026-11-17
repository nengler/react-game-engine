import { Flex, Hud, Text } from "@tsengine/runtime/jsx";

import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { keyLabel } from "./rules/controls.ts";
import { COLOR } from "./theme.ts";

/** How the run ended: lived or not, for how long, the kills and the level. Confirm goes back to the title. */
export function End() {
  const survived = useGame((g) => g.survived);
  const time = useGame((g) => g.endTime);
  const kills = useGame((g) => g.endKills);
  const level = useGame((g) => g.endLevel);
  const { toTitle } = useGame.actions();
  const seconds = Math.floor(time);
  return (
    <Hud>
      <Flex
        direction="column"
        alignItems="center"
        justifyContent="center"
        width="grow"
        height="grow"
        gap={8}
        pressKey="confirm"
        onPress={toTitle}
      >
        <Text size={32} color={survived ? COLOR.xp : COLOR.hp}>
          {survived ? "SURVIVED" : "OVERRUN"}
        </Text>
        <Label>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} KILLS {kills} LEVEL {level}
        </Label>
        <Label color={COLOR.prompt}>PRESS {keyLabel("confirm")} FOR THE TITLE</Label>
      </Flex>
    </Hud>
  );
}
