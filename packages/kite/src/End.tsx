import { useInput, Flex, Hud } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";

/** The end screen: how the climb went, and a way back to the title, in a centred column on the HUD layer. */
export function End() {
  const { toTitle } = useGame.actions();
  const { deaths, time } = useGame((s) => s.run);
  const gems = useGame((s) => s.gems);
  const seconds = Math.floor(time);

  useInput((input) => {
    if (input.pressed("confirm")) {
      toTitle();
    }
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={10}>
        <Label text="YOU MADE IT" size={16} color="#ffb15e" />
        <Label text="THE FOOTHILLS ARE BEHIND YOU" color="#8e9ac2" />
        <Flex direction="column" alignItems="center" gap={6}>
          <Label text={`DEATHS ${deaths}`} />
          <Label text={`TIME ${Math.floor(seconds / 60)}:${seconds % 60 < 10 ? "0" : ""}${seconds % 60}`} />
          <Label text={`GEM ${gems}/1`} color="#7de3ff" />
        </Flex>
        <Label text="PRESS Z FOR THE TITLE" color="#8e9ac2" />
      </Flex>
    </Hud>
  );
}
