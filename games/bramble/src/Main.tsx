import { Game, Route, Router, Screen } from "@rge/runtime/jsx";
import { End } from "./End.tsx";
import { useGame } from "./GameState.ts";
import { Play } from "./Play.tsx";
import { controls } from "./rules/controls.ts";
import { Title } from "./Title.tsx";

/** The root: a 320 × 180 screen showing the title, the world or the end. */
export default function Main() {
  const screen = useGame((s) => s.screen);

  return (
    <Game name="Main" controls={controls} upscale="sharp" title="Bramble" width={960} height={540} background="#10131c" assets="assets" fixedStep={60}>
      <Screen width={320} height={180} fit="contain">
        <Router route={screen}>
          <Route name="title">
            <Title />
          </Route>
          <Route name="play">
            <Play />
          </Route>
          <Route name="end">
            <End />
          </Route>
        </Router>
      </Screen>
    </Game>
  );
}
