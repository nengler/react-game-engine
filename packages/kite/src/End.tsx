import { useInput, Fade, Flex, Hud, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The end screen: how the climb went, and a way back to the title, in a centred column on the HUD layer. */
export function End() {
  const toTitle = useGame((s) => s.toTitle);
  const deaths = useGame((s) => s.deaths);
  const gems = useGame((s) => s.gems);
  const steps = useGame((s) => s.steps);
  const seconds = Math.floor(steps / 60);

  useInput((input) => {
    if (input.pressed("Enter") || input.pressed("Z") || input.pressed("Space") || input.pressed("PadA") || input.pressed("PadStart")) {
      toTitle();
    }
  });

  return (
    <Hud>
      <Flex direction="column" alignItems="center" justifyContent="center" width="grow" height="grow" gap={10}>
        <Text font="font.png" size={16} color="#ffb15e">
          YOU MADE IT
        </Text>
        <Text font="font.png" size={8} color="#8e9ac2">
          THE FOOTHILLS ARE BEHIND YOU
        </Text>
        <Flex direction="column" alignItems="center" gap={6}>
          <Text font="font.png" size={8} color="#fff1d6">
            DEATHS {deaths}
          </Text>
          <Text font="font.png" size={8} color="#fff1d6">
            TIME {Math.floor(seconds / 60)}:{seconds % 60 < 10 ? "0" : ""}{seconds % 60}
          </Text>
          <Text font="font.png" size={8} color="#7de3ff">
            GEM {gems}/1
          </Text>
        </Flex>
        <Text font="font.png" size={8} color="#8e9ac2">
          PRESS Z FOR THE TITLE
        </Text>
      </Flex>
      <Fade from={1} on={false} duration={0.6} color="#12151f" />
    </Hud>
  );
}
