import { createGameState } from "@tsengine/runtime";

/**
 * The game's state, in one place: the data, and the actions that change it. A component reads one value with
 * `useGame((s) => s.jumps)` and takes the actions it calls with `const { jumped } = useGame.actions()`.
 */
export const useGame = createGameState(
  {
    /** How many times the hero has jumped. */
    jumps: 0,
  },
  {
    jumped(s) {
      s.jumps += 1;
    },
  }
);
