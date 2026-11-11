import { Camera, Entity, Fade, Flex, Game, Hud, Music, ParticleLayer, Particles, Route, Router, Screen, useShake } from "@rge/runtime/jsx";
import { DashTrail } from "./DashTrail.tsx";
import { fx } from "./effects.ts";
import { End } from "./End.tsx";
import { Gem } from "./Gem.tsx";
import { useGame } from "./GameState.ts";
import { Label } from "./Label.tsx";
import { Level } from "./Level.tsx";
import { Player } from "./Player.tsx";
import { controls } from "./rules/controls.ts";
import { GEM_AT } from "./rules/rooms.ts";
import { Title } from "./Title.tsx";
import { fadeThrough } from "./transitions.ts";

/** What shows while playing: the rooms, the character in a camera that stays inside the room it is in, the gem, the bursts the game makes, and the HUD. */
function Play() {
  const { originX, originY, room, deaths, dead } = useGame((s) => s.run);
  const gems = useGame((s) => s.gems);
  const [shake, setShake] = useShake();

  return (
    <Entity name="Play">
      {/* Dust hanging in the room's air (behind the rock, so only the air shows it), drifting up: it is there when the room is, and it stops when the world freezes (a dash,
          a death), which is how a freeze is felt. In the world, so a room change leaves the old room's dust behind it. */}
      <Particles
        rate={10}
        lifetime={6}
        speed={5}
        angle={270}
        spread={60}
        gravity={-1}
        size={1}
        fade
        color="#a9b6dcc8"
        width={320}
        height={180}
        prewarm
        space="world"
        max={64}
        transform={{ x: originX, y: originY }}
      />
      <Level />
      <Gem transform={{ x: GEM_AT.x, y: GEM_AT.y }} />
      {/* Copies of the character a dash leaves, under it, in the world. */}
      <DashTrail />
      {/* The camera follows the character and never leaves the room; a new room slides in. A death shakes it. */}
      <Camera bounds={[originX, originY, 320, 180]} slide={0.4} shake={shake}>
        <Player onDie={() => setShake({ strength: 3, duration: 0.25 })} />
      </Camera>
      {/* Where dust and sparks are drawn, in the world, over the character: effects.ts makes them. */}
      <ParticleLayer particles={fx} />
      <Hud>
        {/* A row across the top: the room, the gem once it is picked up, the deaths. */}
        <Flex direction="row" justifyContent="space-between" width="grow" padding={5}>
          <Label text={`${room + 1}/8`} color="#8e9ac2" />
          <Label text={gems > 0 ? "GEM" : ""} color="#7de3ff" />
          <Label text={`X${deaths}`} color="#ff7a59" />
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
     
      controls={controls}
      upscale="sharp"
      title="Kite"
      width={960}
      height={540}
      background="#12151f"
      assets="assets"
      fixedStep={60}
    >
      <Screen width={320} height={180} fit="contain">
        {/* The screens: only the one the game state names is in the world, and changing it fades through the background colour. */}
        <Router route={screen} transition={fadeThrough} duration={0.5} coverColor="#12151f">
          <Route name="title">
            <Title />
          </Route>
          <Route name="play">
            <Play />
          </Route>
          <Route name="end">
            <End />
          </Route>
        </Router>
        {/* Music keeps playing across rooms and screens: it belongs to the root, which is never removed. */}
        <Music src="theme.wav" volume={0.45} fade={1} />
      </Screen>
    </Game>
  );
}
