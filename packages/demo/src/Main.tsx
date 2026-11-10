import { useSound, useState, Camera, Entity, Flex, Game, Hud, Pointer, Text } from "@rge/runtime/jsx";
import { Beacon } from "./Beacon.tsx";
import { Coin } from "./Coin.tsx";
import { useGame } from "./GameState.ts";
import { CoinCounter } from "./CoinCounter.tsx";
import { Ground } from "./Ground.tsx";
import { Player } from "./Player.tsx";
import { Spikes } from "./Spikes.tsx";

/**
 * The demo's root, and its configuration: the window (its title and size), the background, the assets folder and the
 * game state are the props of <Game>. Move the square with the arrow keys or WASD; the camera follows it. Click the grey
 * button to count clicks (it turns green at three) and hear a sound. The flickering square on the left is
 * an animation whose third frame is missing on purpose, to show the magenta fallback. Walk onto the coin to pick it
 * up, and onto the red spikes to turn red while you stand on them.
 */
export default function Main() {
  const [clicks, setClicks] = useState(0);
  const playClick = useSound("click.wav");

  return (
    <Game name="Main" state={useGame} title="rge demo" width={640} height={360} background="#10131c" assets="assets">
      <Ground />
      <Beacon transform={{ x: -120, y: -60 }} />
      <Spikes transform={{ x: 84, y: 10 }} />
      <Coin transform={{ x: 60, y: 8 }} />
      {/* The HUD stays where it is while the camera follows the player, and is laid out, not placed by hand: a column holding the coin count and the button. */}
      <Hud transform={{ x: 16, y: 16 }}>
        <Flex direction="column" gap={8}>
          <CoinCounter />
          {/* The button is a Flex for the look (its label is centred by layout) and a Pointer for the click, both 96 × 32 at the Entity's origin. */}
          <Entity name="Button">
            <Flex width={96} height={32} alignItems="center" justifyContent="center" background={clicks >= 3 ? "seagreen" : "slategray"}>
              <Text size={16} color="white">
                Clicks: {clicks}
              </Text>
            </Flex>
            <Pointer
              width={96}
              height={32}
              onPress={() => {
                playClick();
                setClicks((clicks) => clicks + 1);
              }}
            />
          </Entity>
        </Flex>
      </Hud>
      {/* A camera follows its children, so this keeps the view on the player. */}
      <Camera>
        <Player />
      </Camera>
    </Game>
  );
}
