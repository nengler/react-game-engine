import { stories, story } from "@tsengine/player";

import { Play } from "../generated/Play.ts";
import { useGame } from "../src/GameState.ts";
import { newRun } from "../src/rules/run.ts";

/** The play screen. In the cave, the dark and the lights over the world; on the first visit, a cutscene. */
export default stories(Play, { size: [320, 180], scale: 2 });

const inCave = (): void => useGame.setState({ run: { ...newRun(), map: "cave", x: 240, y: 216, items: { lantern: 1 } } });

/** The cave once its first-visit cutscene has played: lit by the lantern. */
export const Cave = story({}, { setup: inCave, input: "_*220" });
/** Part-way through that cutscene: the lantern's light growing, the world waiting. */
export const CaveIntro = story({}, { setup: inCave, input: "_*45" });
export const Valley = story({});
