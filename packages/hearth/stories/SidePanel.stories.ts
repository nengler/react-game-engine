import { stories, story } from "@tsengine/player";

import { SidePanel } from "../generated/SidePanel.ts";
import { useGame } from "../src/GameState.ts";

/** The panel on the right of the play screen: the stats, the menu for the pad under the cursor, and the three buttons. */
export default stories(SidePanel, { size: [80, 180], scale: 3 });

const idle = { onStartWave: () => {}, onBuild: () => {}, onUpgrade: () => {}, onSell: () => {} };

/** Before a pad is chosen. */
export const Start = { gold: 120, lives: 20, wave: 0, active: false, tower: null, ...idle };

/** An empty pad chosen: the build menu, with one tower too dear. `input` lets its slide-in finish. */
export const Build = story(
  { gold: 60, lives: 20, wave: 2, active: false, tower: null, ...idle },
  { setup: () => useGame.setState({ open: true }), input: "_*60" }
);

/** A tower chosen: its upgrade and its price back. */
export const Upgrade = story(
  { gold: 200, lives: 14, wave: 5, active: false, tower: { kind: "mortar", level: 1, spent: 110 }, ...idle },
  { setup: () => useGame.setState({ open: true }), input: "_*60" }
);

/** A wave on, at double speed: the wave button is dimmed. */
export const WaveOn = story(
  { gold: 35, lives: 3, wave: 9, active: true, tower: null, ...idle },
  { setup: () => useGame.setState({ speed: 2 }) }
);
