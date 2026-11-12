import { Camera, Entity, Hud, ParticleLayer, Shape, Sprite, Text, useInput, useRef, useUpdate } from "@rge/runtime/jsx";
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
  const { advance, togglePause } = useGame((s) => s);
  // What the keys said this step: refs hold values that must not cause a render. A press is kept until the update takes it.
  const dx = useRef(0);
  const dy = useRef(0);
  const action = useRef(false);
  const { x, y, frame } = heroOf(run);
  const { width, height } = mapPixels(run.map);

  // While the pause screen is shown it is modal: this hears no keys (the held ones read as released), and it closes itself.
  useInput((input) => {
    if (input.pressed("back")) {
      togglePause();
      return;
    }
    const held = readInput(input);
    dx.current = held.dx;
    dy.current = held.dy;
    if (held.action) action.current = true;
  });
  useUpdate((dt) => {
    if (paused) return;
    advance({ dx: dx.current, dy: dy.current, action: action.current }, dt);
    action.current = false;
  });

  return (
    <Entity name="Play">
      <World />
      <Camera bounds={[0, 0, width, height]} deadzone={[24, 16]} smoothing={0.12}>
        <Sprite image="things.png" frameWidth={16} frameHeight={16} frame={frame} tint={run.invuln > 0 ? "#ffffff99" : "#ffffffff"} transform={{ x, y }} />
      </Camera>
      <ParticleLayer particles={fx} />
      <Hud>
        <Text transform={{ x: 4, y: 3 }} size={10} color="#ff6b6b" text={`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`} />
        {run.notice !== null && (
          <Entity name="Card" transform={{ x: 0, y: 18 }}>
            <Shape kind="rect" width={320} height={14} color="#10131ccc" />
            <Text transform={{ x: 0, y: 2 }} width={320} align="center" size={10} color="#fff1d6" text={run.notice} />
          </Entity>
        )}
        {run.talk !== null && !paused && <Dialogue />}
        {paused && <Pause />}
      </Hud>
    </Entity>
  );
}
