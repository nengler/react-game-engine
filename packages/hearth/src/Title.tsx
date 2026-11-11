import { Flex, Hud, useInput, useState, useUpdate } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { COLOR } from "./theme.ts";

/** The title screen: the name, how to play, and a prompt that waits for a button or a click. */
export function Title() {
  const begin = useGame((s) => s.begin);
  const [clock, setClock] = useState(0);

  useUpdate((dt) => {
    setClock((t) => t + dt);
  });

  useInput((input) => {
    if (input.pressed("confirm") || input.pressed("wave")) {
      begin();
    }
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={10} onPress={begin}>
        <Label text="HEARTH" size={40} color={COLOR.title} />
        <Label text="HOLD THE ROAD TEN WAVES" color={COLOR.dim} />
        <Label text="CLICK A PAD TO BUILD  SPACE STARTS A WAVE" />
        <Label text="ARROWS MOVE  Z BUYS  1 2 3 TOWERS" />
        <Label text="PRESS Z OR CLICK TO START" color={clock % 1 < 0.66 ? COLOR.prompt : COLOR.background} />
      </Flex>
    </Hud>
  );
}
