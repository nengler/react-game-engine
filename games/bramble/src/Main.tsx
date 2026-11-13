import { Game, Music, Route, Router, Screen } from "@rge/runtime/jsx";
import { End } from "./End.tsx";
import { useGame } from "./GameState.ts";
import { Play } from "./Play.tsx";
import { Settings } from "./Settings.tsx";
import { controls } from "./rules/controls.ts";
import { Title } from "./Title.tsx";

/** The root: a 320 × 180 screen showing the title, the world or the end. */
export default function Main() {
  const screen = useGame((s) => s.screen);

  return (
    <Game id="bramble" controls={controls} upscale="sharp" title="Bramble" width={960} height={540} background="#10131c" assets="assets" fixedStep={60} textSize={10} textColor="#e8d9a8">
      <Screen width={320} height={180} fit="contain">
        <Router route={screen}>
          <Route name="title">
            <Title />
          </Route>
          <Route name="settings">
            <Settings />
          </Route>
          <Route name="play">
            <Play />
          </Route>
          <Route name="end">
            <End />
          </Route>
        </Router>
        {/* The theme keeps playing across screens: it belongs to the root. */}
        <Music src="theme.wav" volume={0.5} fade={1} />
      </Screen>
    </Game>
  );
}
