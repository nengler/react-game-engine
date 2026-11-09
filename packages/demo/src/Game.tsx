import { useSound, useState, Camera, Entity, Pointer, Shape, Text } from "@rge/runtime/jsx";
import { Beacon } from "./Beacon.tsx";
import { Ground } from "./Ground.tsx";
import { Player } from "./Player.tsx";

/**
 * The demo's root. Move the square with the arrow keys or WASD; the camera follows it. Click the grey
 * button to count clicks (it turns green at three) and hear a sound. The flickering square on the left is
 * an animation whose third frame is missing on purpose, to show the magenta fallback.
 */
export default function Game() {
  const [clicks, setClicks] = useState(0);
  const playClick = useSound("click.wav");

  return (
    <Entity name="Game">
      <Ground />
      <Beacon transform={{ x: -120, y: -60 }} />
      {/* The button is a Shape for the look and a Pointer for the click: both are placed the same. */}
      <Shape kind="rect" width={96} height={32} color={clicks >= 3 ? "seagreen" : "slategray"} transform={{ x: 80, y: -40 }} />
      <Pointer
        width={96}
        height={32}
        transform={{ x: 80, y: -40 }}
        onPress={() => {
          playClick();
          setClicks((clicks) => clicks + 1);
        }}
      />
      <Text size={16} color="white" transform={{ x: 92, y: -32 }}>
        Clicks: {clicks}
      </Text>
      {/* A camera follows its children, so this keeps the view on the player. */}
      <Camera>
        <Player />
      </Camera>
    </Entity>
  );
}
