import { createGameState } from "@rge/runtime";
import "./tilemaps.ts";
import { viewOf, type View } from "./rules/view.ts";
import { newRun, step, type GameEvent, type Input, type Run } from "./rules/run.ts";

/** The game's shared state: which screen is showing and the run. The play screen steps the run through `advance`. */
interface State {
  screen: "title" | "play" | "end";
  run: Run;
  /** What the screen draws of the map the run is on (see `rules/view.ts`). */
  view: View;
  /** The events of the latest step, for the effects (sounds, particles) that answer them. */
  events: readonly GameEvent[];
  /** Start a new run. */
  begin: () => void;
  toTitle: () => void;
  /** One step of the world. */
  advance: (input: Input, dt: number) => void;
}

export const useGame = createGameState<State>()((set, get) => ({
  screen: "title",
  run: newRun(),
  view: viewOf(newRun()),
  events: [],
  begin: () => set({ run: newRun(), view: viewOf(newRun()), screen: "play", events: [] }),
  toTitle: () => set({ screen: "title" }),
  advance: (input, dt) => {
    const result = step(get().run, input, dt);
    set({ run: result.run, view: viewOf(result.run), events: result.events, ...(result.run.done ? { screen: "end" as const } : {}) });
  },
}));
