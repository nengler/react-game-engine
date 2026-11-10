import { useInput, useState, Entity, Fade, Hud, Text } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The title screen: the name, how to move, and a prompt that waits for a button. */
export function Title() {
  const begin = useGame((s) => s.begin);
  const [blink, setBlink] = useState(0);

  useInput((input) => {
    if (input.pressed("Enter") || input.pressed("Z") || input.pressed("C") || input.pressed("Space") || input.pressed("PadA") || input.pressed("PadStart")) {
      begin();
    }
    setBlink((b) => b + 1);
  });

  return (
    <Entity name="Title">
      <Text font="font.png" size={40} color="#ffb15e" transform={{ x: 76, y: 38 }}>
        KITE
      </Text>
      <Text font="font.png" size={8} color="#8e9ac2" transform={{ x: 86, y: 82 }}>
        THE FOOTHILLS
      </Text>
      <Text font="font.png" size={8} color="#fff1d6" transform={{ x: 40, y: 112 }}>
        ARROWS MOVE   Z JUMP   X DASH
      </Text>
      {blink % 60 < 40 && (
        <Text font="font.png" size={8} color="#7de3ff" transform={{ x: 94, y: 138 }}>
          PRESS Z TO START
        </Text>
      )}
      <Hud>
        <Fade from={1} on={false} duration={0.5} color="#12151f" />
      </Hud>
    </Entity>
  );
}
