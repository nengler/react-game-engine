import { createGameState } from "@rge/runtime";

/**
 * The game's state, in one place: a nested object, and the actions that change it. Components import `useGame` and
 * read one leaf with a selector (`useGame((s) => s.stats.coins)`), or bind an action to call in a handler
 * (`useGame((s) => s.collect)`). The compiler reads this file to check those selectors; generated code imports it.
 *
 * An action is written as if it mutates its state: the store runs it on a copy, so a component re-renders only for
 * the leaves it actually changed.
 */
export const useGame = createGameState({
  state: {
    stats: {
      /** Coins picked up. */
      coins: 0,
      /** Times the player has touched the spikes. */
      hits: 0,
    },
  },
  actions: {
    collect(s) {
      s.stats.coins += 1;
    },
    hit(s) {
      s.stats.hits += 1;
    },
  },
});
