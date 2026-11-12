import { Camera, Entity, Hud, ParticleLayer, Shape, Sprite, Text, useInput, useRef, useState, useUpdate } from "@rge/runtime/jsx";
import { fx } from "./effects.ts";
import { Dialogue } from "./Dialogue.tsx";
import { useGame } from "./GameState.ts";
import { Inventory } from "./Inventory.tsx";
import { Menu } from "./Menu.tsx";
import { BELLS_NEEDED, MAX_HEARTS } from "./rules/constants.ts";
import { mapPixels } from "./rules/maps.ts";
import { pauseRows, wrap } from "./rules/menu.ts";
import { readInput } from "./rules/controls.ts";
import { heroOf } from "./rules/view.ts";
import { World } from "./World.tsx";

/** The play screen: the map, the character in a camera that stays inside it, and the HUD. The one place the world is stepped. */
export function Play() {
  const run = useGame((s) => s.run);
  const paused = useGame((s) => s.paused);
  const advance = useGame((s) => s.advance);
  const togglePause = useGame((s) => s.togglePause);
  const choosePaused = useGame((s) => s.choosePaused);
  /** The pause screen's cursor. */
  const [cursor, setCursor] = useState(0);
  // What the keys said this step: refs hold values that must not cause a render. A press is kept until the update takes it.
  const dx = useRef(0);
  const dy = useRef(0);
  const action = useRef(false);
  const hero = heroOf(run);
  const size = mapPixels(run.map);
  const rows = pauseRows();

  useInput((input) => {
    if (input.pressed("back")) {
      togglePause();
      setCursor(0);
      return;
    }
    if (paused) {
      if (input.pressed("up")) setCursor((c) => wrap(c - 1, rows.length));
      if (input.pressed("down")) setCursor((c) => wrap(c + 1, rows.length));
      if (input.pressed("confirm")) choosePaused(rows[cursor]?.id ?? "");
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
      <Camera bounds={[0, 0, size.width, size.height]} deadzone={[24, 16]} smoothing={0.12}>
        <Sprite image="things.png" frameWidth={16} frameHeight={16} frame={hero.frame} tint={run.invuln > 0 ? "#ffffff99" : "#ffffffff"} transform={{ x: hero.x, y: hero.y }} />
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
        {paused && (
          <Entity name="Pause">
            <Shape kind="rect" width={320} height={180} color="#10131cd9" />
            <Text transform={{ x: 12, y: 8 }} size={10} color="#e8d9a8" text="PAUSED" />
            <Inventory />
            <Menu top={120} rows={rows} cursor={cursor} />
          </Entity>
        )}
      </Hud>
    </Entity>
  );
}
