import { Game, Route, Router, Screen } from "@tsengine/runtime/jsx";

import { End } from "./End.tsx";
import { useGame } from "./GameState.ts";
import { Play } from "./Play.tsx";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./rules/constants.ts";
import { controls } from "./rules/controls.ts";
import { Title } from "./Title.tsx";

/** The game's root: a 480 × 270 screen showing the title, the run or how it ended. A level-up and the pause menu both stop the run. */
export default function Main() {
  const screen = useGame((g) => g.screen);
  const paused = useGame((g) => g.paused);
  const choosing = useGame((g) => g.choosing);
  return (
    <Game
      vsync={false}
      controls={controls}
      upscale="sharp"
      title="Swarm"
      width={960}
      height={540}
      background="#16131f"
      assets="assets"
      font="tse:small"
      fixedStep={60}
      paused={paused || choosing}
    >
      <Screen width={SCREEN_WIDTH} height={SCREEN_HEIGHT} fit="contain">
        <Router route={screen}>
          <Route name="title">
            <Title />
          </Route>
          <Route name="play">
            <Play />
          </Route>
          <Route name="over">
            <End />
          </Route>
        </Router>
      </Screen>
    </Game>
  );
}
