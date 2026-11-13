import { Camera, Entity, Hud, ParticleLayer, Shape, Sprite, Text, useInput, useUpdate } from "@rge/runtime/jsx";
import { fx } from "./effects.ts";
import { Dialogue } from "./Dialogue.tsx";
import { useGame } from "./GameState.ts";
import { Pause } from "./Pause.tsx";
import { BELLS_NEEDED, MAX_HEARTS } from "./rules/constants.ts";
import { mapPixels } from "./rules/maps.ts";
import { readInput } from "./rules/controls.ts";
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
        <Sprite image="things.png" frameWidth={16} frameHeight={16} frame={frame} tint={run.invuln > 0 ? "#ffffff99" : "#ffffffff"} transform={{ x, y }} />
      </Camera>
      <ParticleLayer particles={fx} />
      <Hud>
        <Text transform={{ x: 4, y: 3 }} color="#ff6b6b">{`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`}</Text>
        {run.notice !== null && (
          <Entity name="Card" transform={{ x: 0, y: 18 }}>
            <Shape kind="rect" width={320} height={14} color="#10131ccc" />
            <Text transform={{ x: 0, y: 2 }} width={320} align="center" color="#fff1d6">{run.notice}</Text>
          </Entity>
        )}
        {run.talk !== null && !paused && <Dialogue />}
        {paused && <Pause />}
      </Hud>
    </Entity>
  );
}
