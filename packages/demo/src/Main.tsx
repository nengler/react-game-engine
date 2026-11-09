import { useSound, useState, Camera, Game, Pointer, Shape, Text } from "@rge/runtime/jsx";
import { Beacon } from "./Beacon.tsx";
import { Coin } from "./Coin.tsx";
import { useGame } from "./GameState.ts";
import { Hud } from "./Hud.tsx";
import { Ground } from "./Ground.tsx";
import { Player } from "./Player.tsx";
import { Spikes } from "./Spikes.tsx";

/**
 * The demo's root, and its configuration: the window's title, the background, the assets folder and the game state are
 * the props of <Game> (the window's size is the player's: see game.ts). Move the square with the arrow keys or WASD; the camera follows it. Click the grey
 * button to count clicks (it turns green at three) and hear a sound. The flickering square on the left is
 * an animation whose third frame is missing on purpose, to show the magenta fallback. Walk onto the coin to pick it
 * up, and onto the red spikes to turn red while you stand on them.
 */
export default function Main() {
  const [clicks, setClicks] = useState(0);
  const playClick = useSound("click.wav");

  return (
    <Game name="Main" state={useGame} title="rge demo" background="#10131c" assets="assets">
      <Ground />
      <Beacon transform={{ x: -120, y: -60 }} />
      <Spikes transform={{ x: 84, y: 10 }} />
      <Coin transform={{ x: 60, y: 8 }} />
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
      <Hud transform={{ x: 92, y: -56 }} />
      {/* A camera follows its children, so this keeps the view on the player. */}
      <Camera>
        <Player />
      </Camera>
    </Game>
  );
}
