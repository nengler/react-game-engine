import { createGameState, type InputState } from "@rge/runtime";
import { sfx } from "./effects.ts";
import { readControls } from "./rules/controls.ts";
import type { GameEvent } from "./rules/events.ts";
import { newRun, stepRun, type Run } from "./rules/level.ts";

/**
 * The game's state, shared by every component: which screen is showing, the run of the level (`Run`, see `rules/level.ts`)
 * and the actions that move it on. All the rules are plain functions in `rules/`; this file keeps their state where components
 * can read it, and calls them. `step` is one fixed step of the game: the character calls it with the step's input, and it
 * returns what happened, for the character to answer (`effects.ts`).
 */
interface State {
  screen: "title" | "play" | "end";
  run: Run;
  /** Gems collected: there is one in the level. */
  gems: number;
  /** One fixed step of the run, given the step's input: what happened in it (nothing off the play screen). */
  step: (input: InputState, dt: number) => GameEvent[];
  /** Start a new run: the first room, no deaths, no gems. */
  begin: () => void;
  /** Back to the title screen. */
  toTitle: () => void;
  collect: () => void;
}

export const useGame = createGameState<State>()((set, get) => ({
  screen: "title",
  run: newRun(),
  gems: 0,
  step: (input, dt) => {
    const { screen, run } = get();
    const events: GameEvent[] = [];
    if (screen !== "play") return events;
    const next = stepRun(run, readControls(input), dt, events);
    set({ run: next, screen: next.finished ? "end" : "play" });
    return events;
  },
  begin: () => {
    sfx.play("start");
    set({ run: newRun(), screen: "play", gems: 0 });
  },
  toTitle: () => set({ run: newRun(), screen: "title", gems: 0 }),
  collect: () => set((s) => ({ gems: s.gems + 1 })),
}));
