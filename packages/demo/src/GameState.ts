import { createGameState } from "@rge/runtime";

/**
 * The game's state, in one place: the data, and the actions that change it. An action takes the state and writes it directly; a
 * component calls it without the state (`const { collect } = useGame.actions(); collect()`) and reads one value with a selector,
 * `useGame((s) => s.stats.coins)`. Only actions change the state. The compiler reads this file to check those selectors; generated
 * code imports it.
 */
export const useGame = createGameState(
  {
    stats: {
      /** Coins picked up. */
      coins: 0,
      /** Times the player has touched the spikes. */
      hits: 0,
    },
  },
  {
    collect(s) {
      s.stats.coins += 1;
    },
    hit(s) {
      s.stats.hits += 1;
    },
  }
);
