import { createGameState } from "@rge/runtime";

interface State {
  stats: {
    /** Coins picked up. */
    coins: number;
    /** Times the player has touched the spikes. */
    hits: number;
  };
  collect: () => void;
  hit: () => void;
}

/**
 * The game's state, in one place, shaped like a Zustand store: the state, and actions that call `set`. A component reads
 * one leaf with a selector that returns the value, `useGame((s) => s.stats.coins)`, and takes the actions it calls in
 * handlers with `const { collect } = useGame.actions()`. The compiler reads this file to check those selectors; generated
 * code imports it. As in Zustand, `set` merges shallowly, so a nested object is replaced whole.
 */
export const useGame = createGameState<State>()((set) => ({
  stats: { coins: 0, hits: 0 },
  collect: () => set((s) => ({ stats: { ...s.stats, coins: s.stats.coins + 1 } })),
  hit: () => set((s) => ({ stats: { ...s.stats, hits: s.stats.hits + 1 } })),
}));
