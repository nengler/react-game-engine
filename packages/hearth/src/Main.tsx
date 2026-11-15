import { Game, Music, Route, Router, Screen } from "@rge/runtime/jsx";

import { End } from "./End.tsx";
import { useGame } from "./GameState.ts";
import { Play } from "./Play.tsx";
import { controls } from "./rules/controls.ts";
import { Title } from "./Title.tsx";

/**
 * The game's root (its bitmap font is every text's): a 320 × 180 screen showing the title, the play screen, or the end, with the
 * music playing under all of it. 2× speed runs two fixed steps a frame (`timeScale`), and the pause stops every `useUpdate`.
 */
export default function Main() {
  const screen = useGame((s) => s.screen);
  const speed = useGame((s) => s.speed);
  const paused = useGame((s) => s.paused);

  return (
    <Game
      vsync={false}
      controls={controls}
      upscale="sharp"
      title="Hearth"
      width={960}
      height={540}
      background="#12151f"
      assets="assets"
      font="font.png"
      fixedStep={60}
      timeScale={speed}
      paused={paused}
    >
      <Screen width={320} height={180} fit="contain">
        <Router route={screen}>
          <Route name="title">
            <Title />
          </Route>
          <Route name="play">
            <Play />
          </Route>
          <Route name="won">
            <End won />
          </Route>
          <Route name="lost">
            <End won={false} />
          </Route>
        </Router>
        <Music src="theme.wav" volume={0.4} fade={1} />
      </Screen>
    </Game>
  );
}
