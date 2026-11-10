import { useInput, useSound, useState, Fade, Flex, Hud, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The title screen: the name, how to move, and a prompt that waits for a button. Laid out by a column on the HUD layer, which centres it whatever the screen's size. */
export function Title() {
  const begin = useGame((s) => s.begin);
  const playStart = useSound("start.wav");
  const [blink, setBlink] = useState(0);

  useInput((input) => {
    if (input.pressed("Enter") || input.pressed("Z") || input.pressed("C") || input.pressed("Space") || input.pressed("PadA") || input.pressed("PadStart")) {
      playStart();
      begin();
    }
    setBlink((b) => b + 1);
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={12}>
        <Text font="font.png" size={40} color="#ffb15e">
          KITE
        </Text>
        <Text font="font.png" size={8} color="#8e9ac2">
          THE FOOTHILLS
        </Text>
        <Text font="font.png" size={8} color="#fff1d6">
          ARROWS MOVE   Z JUMP   X DASH
        </Text>
        {/* The prompt blinks by changing colour, not by leaving, so the column does not move. */}
        <Text font="font.png" size={8} color={blink % 60 < 40 ? "#7de3ff" : "#12151f"}>
          PRESS Z TO START
        </Text>
      </Flex>
      <Fade from={1} on={false} duration={0.5} color="#12151f" />
    </Hud>
  );
}
