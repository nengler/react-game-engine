import { useInput, useState, useUpdate, Flex, Hud } from "@rge/runtime/jsx";
import { sfx } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";

/** The title screen: the name, how to move, and a prompt that waits for a button. Laid out by a column on the HUD layer, which centres it whatever the screen's size. */
export function Title() {
  const begin = useGame((s) => s.begin);
  const [clock, setClock] = useState(0);

  useUpdate((dt) => {
    setClock((t) => t + dt);
  });

  useInput((input) => {
    if (input.pressed("Enter") || input.pressed("Z") || input.pressed("C") || input.pressed("Space") || input.pressed("PadA") || input.pressed("PadStart")) {
      sfx.play("start");
      begin();
    }
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={12}>
        <Label text="KITE" size={40} color="#ffb15e" />
        <Label text="THE FOOTHILLS" color="#8e9ac2" />
        <Label text="ARROWS MOVE   Z JUMP   X DASH" />
        {/* The prompt blinks by changing colour, not by leaving, so the column does not move. */}
        <Label text="PRESS Z TO START" color={clock % 1 < 0.66 ? "#7de3ff" : "#12151f"} />
      </Flex>
    </Hud>
  );
}
