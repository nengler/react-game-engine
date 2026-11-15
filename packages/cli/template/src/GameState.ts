import { createGameState } from "@tsengine/runtime";

/**
 * The game's state, in one place: the data, and the actions that change it. A component reads one value with
 * `useGame((s) => s.steps)` and takes the actions it calls with `const { step } = useGame.actions()`.
 */
export const useGame = createGameState(
  {
    /** How many times the hero has been told to step. */
    steps: 0,
  },
  {
    step(s) {
      s.steps += 1;
    },
  }
);
