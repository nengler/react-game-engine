import { stories, story } from "@tsengine/player";

import { Pause } from "../generated/Pause.ts";
import { useGame } from "../src/GameState.ts";
import { newRun } from "../src/rules/run.ts";

/** The pause screen over the world: the inventory and its menu. Down moves the cursor. */
export default stories(Pause, { size: [320, 180], scale: 2 });

export const Open = story({}, { setup: () => useGame.setState({ run: { ...newRun(), items: { lantern: 1, bell: 1 } } }) });
export const SecondRow = story({}, { input: "down, _" });
