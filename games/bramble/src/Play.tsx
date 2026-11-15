import { Camera, Entity, Hud, Light, Lighting, ParticleLayer, Sprite, Text, useInput, useMutable, useUpdate } from "@tsengine/runtime/jsx";

import { caveIntro, noCutscene } from "./cutscenes.ts";
import { Dialogue } from "./Dialogue.tsx";
import { fx } from "./effects.ts";
import { useGame } from "./GameState.ts";
import { Notice } from "./Notice.tsx";
import { Pause } from "./Pause.tsx";
import { BELLS_NEEDED, MAX_HEARTS } from "./rules/constants.ts";
import { readInput } from "./rules/controls.ts";
import { mapPixels } from "./rules/maps.ts";
import { glowsOf, heroOf } from "./rules/view.ts";
import { World } from "./World.tsx";

/** The play screen: the map, the character in a camera that stays inside it, and the HUD. The one place the world is stepped. */
export function Play() {
  const run = useGame((s) => s.run);
  const paused = useGame((s) => s.paused);
  const { advance, togglePause } = useGame.actions();
  const { x, y, frame } = heroOf(run);
  const { width, height } = mapPixels(run.map);
  // The cave's first visit plays a short cutscene (cutscenes.ts): the world waits while it runs.
  const s = useMutable({ intro: noCutscene(), sawCave: false, reach: 1, line: "" });

  // While the pause screen is shown it is modal: this hears no keys, and the pause screen closes itself.
  useInput((input) => {
    if (input.pressed("back")) togglePause();
  });
  // The step reads the keys itself: useUpdate gets the same input as useInput, so nothing is carried between them.
  useUpdate((dt, input) => {
    if (run.map === "cave" && !s.sawCave) {
      s.sawCave = true;
      s.intro = caveIntro(
        (reach) => {
          s.reach = reach;
        },
        (line) => {
          s.line = line;
        }
      );
    }
    if (s.intro.step(dt)) return; // the world waits while a cutscene plays
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
      {/* The cave is dark: lit only by the lantern, by the items still lying there and by the wisps, through a shader that makes the
          light flicker and the edges darker (the software renderer, in tests, draws it without). */}
      {run.map === "cave" && (
        <Lighting ambient="#16162c" shader="cave.glsl" params={[0.12]}>
          <Light radius={56 * s.reach} color="#ffe2b0" x={x + 8} y={y + 8} />
          {glowsOf(run).map((g) => (
            <Light key={g.id} radius={g.radius} color={g.color} intensity={g.intensity} x={g.x} y={g.y} />
          ))}
        </Lighting>
      )}
      <Hud>
        <Text x={4} y={3} color="#ff6b6b">{`Hearts ${run.hearts}/${MAX_HEARTS}   Bells ${run.items.bell ?? 0}/${BELLS_NEEDED}`}</Text>
        {run.notice !== null && <Notice text={run.notice} />}
        {s.line !== "" && <Notice text={s.line} />}
        {run.talk !== null && !paused && <Dialogue />}
        {paused && <Pause />}
      </Hud>
    </Entity>
  );
}
