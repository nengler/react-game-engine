import { Camera, Entity, Hud, Layer, ParticleLayer, Sprite, Text, useInput, useUpdate } from "@rge/runtime/jsx";

import { Dialogue } from "./Dialogue.tsx";
import { fx } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { Notice } from "./Notice.tsx";
import { Pause } from "./Pause.tsx";
import { BELLS_NEEDED, MAX_HEARTS } from "./rules/constants.ts";
import { readInput } from "./rules/controls.ts";
import { mapPixels } from "./rules/maps.ts";
import { heroOf } from "./rules/view.ts";
import { World } from "./World.tsx";

/** The play screen: the map, the character in a camera that stays inside it, and the HUD. The one place the world is stepped. */
export function Play() {
  const run = useGame((s) => s.run);
  const paused = useGame((s) => s.paused);
  const { advance, togglePause } = useGame.actions();
  const { x, y, frame } = heroOf(run);
  const { width, height } = mapPixels(run.map);

  // While the pause screen is shown it is modal: this hears no keys, and the pause screen closes itself.
  useInput((input) => {
    if (input.pressed("back")) togglePause();
  });
  // The step reads the keys itself: useUpdate gets the same input as useInput, so nothing is carried between them.
  useUpdate((dt, input) => {
    if (paused) return; // not stepped while paused
    advance(readInput(input), dt);
  });

  return (
    <Entity>
      <World />
      <Camera bounds={[0, 0, width, height]} deadzone={[24, 16]} smoothing={0.12}>
        <Sprite
          image="things.png"
          frameWidth={16}
          frameHeight={16}
          frame={frame}
          tint={run.invuln > 0 ? "#ffffff99" : "#ffffffff"}
          x={x}
          y={y}
        />
      </Camera>
      <ParticleLayer particles={fx} />
      {/* The cave is dark: a layer of near-black multiplied over it, with the lantern's light added where the character is. */}
      {run.map === "cave" && (
        <Layer blend="multiply" clear="#16162c" childBlend="add">
          <Sprite image="light.png" originX={48} originY={48} x={x + 8} y={y + 8} />
        </Layer>
      )}
      <Hud>
        <Text x={4} y={3} color="#ff6b6b">{`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`}</Text>
        {run.notice !== null && <Notice text={run.notice} />}
        {run.talk !== null && !paused && <Dialogue />}
        {paused && <Pause />}
      </Hud>
    </Entity>
  );
}
