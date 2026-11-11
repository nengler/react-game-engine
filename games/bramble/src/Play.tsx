import { Camera, Entity, Hud, Shape, Text, useInput, useRef, useUpdate } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { BELLS_NEEDED, BODY, MAX_HEARTS } from "./rules/constants.ts";
import { DIALOGUE } from "./rules/dialogue.ts";
import { mapPixels } from "./rules/maps.ts";
import { readInput } from "./rules/controls.ts";
import { pagesOf } from "./rules/run.ts";
import { World } from "./World.tsx";

/** The play screen: the map, the character in a camera that stays inside it, and the HUD. The one place the world is stepped. */
export function Play() {
  const run = useGame((s) => s.run);
  const advance = useGame((s) => s.advance);
  // What the keys said this step: refs hold values that must not cause a render. A press is kept until the update takes it.
  const dx = useRef(0);
  const dy = useRef(0);
  const action = useRef(false);

  useInput((input) => {
    const held = readInput(input);
    dx.current = held.dx;
    dy.current = held.dy;
    if (held.action) action.current = true;
  });
  useUpdate((dt) => {
    advance({ dx: dx.current, dy: dy.current, action: action.current }, dt);
    action.current = false;
  });

  const size = mapPixels(run.map);
  const talk = run.talk;
  return (
    <Entity name="Play">
      <World />
      <Camera bounds={[0, 0, size.width, size.height]} deadzone={[24, 16]} smoothing={0.12}>
        <Entity name="Hero" transform={{ x: run.x, y: run.y }}>
          <Shape kind="rect" width={BODY} height={BODY} color="#f28b3c" />
        </Entity>
      </Camera>
      <Hud>
        <Text transform={{ x: 4, y: 3 }} size={10} color="#ff6b6b" text={`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`} />
        {run.notice !== null && <Text transform={{ x: 0, y: 20 }} width={320} align="center" size={10} color="#fff1d6" text={run.notice} />}
        {talk !== null && (
          <Entity name="Dialogue">
            <Shape kind="rect" width={312} height={44} color="#10131ce6" transform={{ x: 4, y: 130 }} />
            <Text transform={{ x: 10, y: 134 }} size={10} color="#e8d9a8" text={DIALOGUE[talk.npc].name} />
            <Text transform={{ x: 10, y: 148 }} width={300} size={10} color="#ffffff" text={pagesOf(run, talk.npc)[talk.page] ?? ""} />
          </Entity>
        )}
      </Hud>
    </Entity>
  );
}
