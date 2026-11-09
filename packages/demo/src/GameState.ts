import { createGameState } from "@rge/runtime";

/**
 * The game's state, in one place: a nested object. A component picks one leaf with a selector and gets a value and a
 * setter, exactly as `useState` gives them: `const [coins, setCoins] = useGame((s) => s.stats.coins)`. The compiler
 * reads this file to check those selectors; generated code imports it.
 */
export const useGame = createGameState({
  stats: {
    /** Coins picked up. */
    coins: 0,
    /** Times the player has touched the spikes. */
    hits: 0,
  },
});
