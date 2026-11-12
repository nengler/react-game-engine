import { Camera, Entity, Hud, Shape, Text, useInput, useRef, useUpdate } from "@rge/runtime/jsx";
import { Dialogue } from "./Dialogue.tsx";
import { useGame } from "./GameState.ts";
import { Inventory } from "./Inventory.tsx";
import { Menu } from "./Menu.tsx";
import { BELLS_NEEDED, BODY, MAX_HEARTS } from "./rules/constants.ts";
import { mapPixels } from "./rules/maps.ts";
import { readInput } from "./rules/controls.ts";
import { World } from "./World.tsx";

/** The play screen: the map, the character in a camera that stays inside it, and the HUD. The one place the world is stepped. */
export function Play() {
  const run = useGame((s) => s.run);
  const paused = useGame((s) => s.paused);
  const talking = useGame((s) => s.run.talk !== null);
  const advance = useGame((s) => s.advance);
  const togglePause = useGame((s) => s.togglePause);
  const moveCursor = useGame((s) => s.moveCursor);
  const activate = useGame((s) => s.activate);
  // What the keys said this step: refs hold values that must not cause a render. A press is kept until the update takes it.
  const dx = useRef(0);
  const dy = useRef(0);
  const action = useRef(false);

  useInput((input) => {
    if (input.pressed("back")) {
      togglePause();
      return;
    }
    if (paused) {
      if (input.pressed("up")) moveCursor(-1);
      if (input.pressed("down")) moveCursor(1);
      if (input.pressed("confirm")) activate();
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

  const size = mapPixels(run.map);
  return (
    <Entity name="Play">
      <World />
      <Camera bounds={[0, 0, size.width, size.height]} deadzone={[24, 16]} smoothing={0.12}>
        <Entity name="Hero" transform={{ x: run.x, y: run.y }}>
          <Shape kind="rect" width={BODY} height={BODY} color={run.invuln > 0 ? "#fbd2a8" : "#f28b3c"} />
        </Entity>
      </Camera>
      <Hud>
        <Text transform={{ x: 4, y: 3 }} size={10} color="#ff6b6b" text={`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`} />
        {run.notice !== null && (
          <Entity name="Card" transform={{ x: 0, y: 18 }}>
            <Shape kind="rect" width={320} height={14} color="#10131ccc" />
            <Text transform={{ x: 0, y: 2 }} width={320} align="center" size={10} color="#fff1d6" text={run.notice} />
          </Entity>
        )}
        {talking && !paused && <Dialogue />}
        {paused && (
          <Entity name="Pause">
            <Shape kind="rect" width={320} height={180} color="#10131cd9" />
            <Text transform={{ x: 12, y: 8 }} size={10} color="#e8d9a8" text="PAUSED" />
            <Inventory />
            <Menu top={120} />
          </Entity>
        )}
      </Hud>
    </Entity>
  );
}
