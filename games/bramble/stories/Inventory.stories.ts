import { stories, story } from "@rge/player";

import { Inventory } from "../generated/Inventory.ts";
import { useGame } from "../src/GameState.ts";
import { newRun } from "../src/rules/run.ts";

/** The pause screen's eight slots. */
export default stories(Inventory, { size: [320, 120], scale: 2 });

export const Empty = {};
/** Most of the game's things, and two of the bells. */
export const Full = story(
  {},
  { setup: () => useGame.setState({ run: { ...newRun(), items: { lantern: 1, key: 1, shears: 1, bell: 2 } } }) }
);
