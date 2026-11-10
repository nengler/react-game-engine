import { Camera, Entity, Fade, Flex, Game, Hud, Music, Screen, Text } from "@rge/runtime/jsx";
import { End } from "./End.tsx";
import { Gem } from "./Gem.tsx";
import { useGame } from "./GameState.ts";
import { Level } from "./Level.tsx";
import { Player } from "./Player.tsx";
import { Title } from "./Title.tsx";

/** What shows while playing: the rooms, the character in a camera that stays inside the room it is in, the gem, and the HUD. */
function Play() {
  const originX = useGame((s) => s.originX);
  const originY = useGame((s) => s.originY);
  const room = useGame((s) => s.room);
  const deaths = useGame((s) => s.deaths);
  const gems = useGame((s) => s.gems);
  const deathCount = useGame((s) => s.deathCount);
  const dead = useGame((s) => s.dead);

  return (
    <Entity name="Play">
      <Level />
      <Gem transform={{ x: 1542, y: -330 }} />
      {/* The camera follows the character and never leaves the room; a new room slides in. A death shakes it. */}
      <Camera
        bounds={[originX, originY, 320, 180]}
        slide={0.4}
        shake={deathCount}
        shakeStrength={3}
        shakeDuration={0.25}
      >
        <Player />
      </Camera>
      <Hud>
        {/* A row across the top: the room, the gem once it is picked up, the deaths. */}
        <Flex direction="row" justifyContent="space-between" width="grow" padding={5}>
          <Text font="font.png" size={8} color="#8e9ac2">
            {room + 1}/8
          </Text>
          <Text font="font.png" size={8} color="#7de3ff">
            {gems > 0 ? "GEM" : ""}
          </Text>
          <Text font="font.png" size={8} color="#ff7a59">
            X{deaths}
          </Text>
        </Flex>
        {/* Dying fades the screen to the background colour, and the new life fades it back. */}
        <Fade on={dead} duration={0.3} color="#12151f" />
      </Hud>
    </Entity>
  );
}

/** The game's root: a 320 × 180 screen showing the title, the level or the end, with the music playing under all of it. */
export default function Main() {
  const screen = useGame((s) => s.screen);

  return (
    <Game
      vsync={false}
      name="Main"
      state={useGame}
      title="Kite"
      width={960}
      height={540}
      background="#12151f"
      assets="assets"
      fixedStep={60}
    >
      <Screen width={320} height={180} fit="contain">
        {screen === "title" && <Title />}
        {screen === "play" && <Play />}
        {screen === "end" && <End />}
        {/* Music keeps playing across rooms and screens: it belongs to the root, which is never removed. */}
        <Music src="theme.wav" volume={0.45} fade={1} />
      </Screen>
    </Game>
  );
}
