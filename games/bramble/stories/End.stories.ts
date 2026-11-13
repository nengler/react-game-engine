import { stories, story } from "@rge/player";
import { End } from "../generated/End.ts";
import { useGame } from "../src/GameState.ts";
import { newRun } from "../src/rules/run.ts";

/** The end screen, with the run's time. */
export default stories(End, { size: [320, 180], scale: 2 });

export const Done = story({}, { setup: () => useGame.setState({ run: { ...newRun(), time: 754.2 } }) });
