import { Game, Music, Route, Router, Screen } from "@rge/runtime/jsx";
import { End } from "./End.tsx";
import { useGame } from "./GameState.ts";
import { Play } from "./Play.tsx";
import { Title } from "./Title.tsx";
import { controls } from "./rules/controls.ts";

/** The game's root (its bitmap font is every text's): a 320 × 180 screen showing the title, the play screen, or the end, with the music playing under all of it. */
export default function Main() {
  const screen = useGame((s) => s.screen);

  return (
    <Game vsync={false} name="Main" controls={controls} upscale="sharp" title="Hearth" width={960} height={540} background="#12151f" assets="assets" font="font.png" fixedStep={60}>
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
