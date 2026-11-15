import { stories, story } from "@rge/player";

import { Play } from "../generated/Play.ts";
import { useGame } from "../src/GameState.ts";
import { newRun } from "../src/rules/run.ts";

/** The play screen. In the cave, the dark layer and the lantern's light over the world. */
export default stories(Play, { size: [320, 180], scale: 2 });

export const Cave = story(
  {},
  { setup: () => useGame.setState({ run: { ...newRun(), map: "cave", x: 240, y: 216, items: { lantern: 1 } } }) }
);
export const Valley = story({});
