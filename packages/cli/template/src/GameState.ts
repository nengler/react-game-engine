import { createGameState } from "@rge/runtime";

interface State {
  /** How many times the hero has been told to step. */
  steps: number;
  step: () => void;
}

/** The game's state, in one place, shaped like a Zustand store. A component reads one leaf with `useGame((s) => s.steps)`. */
export const useGame = createGameState<State>()((set) => ({
  steps: 0,
  step: () => set((s) => ({ steps: s.steps + 1 })),
}));
