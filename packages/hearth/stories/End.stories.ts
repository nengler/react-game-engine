import { stories, story } from "@rge/player";

import { End } from "../generated/End.ts";
import { useGame } from "../src/GameState.ts";

/** The end screen, after the battle's last wave or its last life. */
export default stories(End, { size: [320, 180], scale: 2 });

export const Won = story({ won: true }, { setup: () => useGame.setState({ endLives: 12, endWave: 10 }) });
export const Lost = story({ won: false }, { setup: () => useGame.setState({ endLives: 0, endWave: 6 }) });
