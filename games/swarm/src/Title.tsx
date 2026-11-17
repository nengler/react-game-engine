import { Flex, Hud, Text, useTime } from "@tsengine/runtime/jsx";

import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { keyLabel } from "./rules/controls.ts";
import { COLOR } from "./theme.ts";

/** The title screen: the name, how to play, and a prompt that waits for the confirm key or a click. */
export function Title() {
  const { begin } = useGame.actions();
  const time = useTime();
  return (
    <Hud>
      <Flex
        direction="column"
        alignItems="center"
        justifyContent="center"
        width="grow"
        height="grow"
        gap={10}
        pressKey="confirm"
        onPress={begin}
      >
        <Text size={40} color={COLOR.title}>
          SWARM
        </Text>
        <Label color={COLOR.dim}>LIVE TEN MINUTES</Label>
        <Label>ARROWS OR WASD MOVE. WEAPONS FIRE ON THEIR OWN</Label>
        <Label color={time % 1 < 0.66 ? COLOR.prompt : COLOR.background}>PRESS {keyLabel("confirm")} OR CLICK TO START</Label>
      </Flex>
    </Hud>
  );
}
