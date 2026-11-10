import { useInput, Entity, Fade, Hud, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The end screen: how the climb went, and a way back to the title. */
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
    <Entity name="End">
      <Text font="font.png" size={16} color="#ffb15e" transform={{ x: 62, y: 34 }}>
        YOU MADE IT
      </Text>
      <Text font="font.png" size={8} color="#8e9ac2" transform={{ x: 76, y: 62 }}>
        THE FOOTHILLS ARE BEHIND YOU
      </Text>
      <Text font="font.png" size={8} color="#fff1d6" transform={{ x: 100, y: 92 }}>
        DEATHS {deaths}
      </Text>
      <Text font="font.png" size={8} color="#fff1d6" transform={{ x: 100, y: 106 }}>
        TIME {Math.floor(seconds / 60)}:{seconds % 60 < 10 ? "0" : ""}{seconds % 60}
      </Text>
      <Text font="font.png" size={8} color="#7de3ff" transform={{ x: 100, y: 120 }}>
        GEM {gems}/1
      </Text>
      <Text font="font.png" size={8} color="#8e9ac2" transform={{ x: 84, y: 150 }}>
        PRESS Z FOR THE TITLE
      </Text>
      <Hud>
        <Fade from={1} on={false} duration={0.6} color="#12151f" />
      </Hud>
    </Entity>
  );
}
