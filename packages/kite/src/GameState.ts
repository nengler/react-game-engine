import { createGameState, type InputState } from "@rge/runtime";
import { playEvents } from "./effects.ts";
import { readControls } from "./rules/controls.ts";
import type { GameEvent } from "./rules/events.ts";
import { newRun, stepRun, type Run } from "./rules/level.ts";

/**
 * The game's state, shared by every component: which screen is showing, the run of the level (`Run`, see `rules/level.ts`)
 * and the actions that move it on. All the rules are plain functions in `rules/`; this file keeps their state where components
 * can read it, and calls them. `step` is one fixed step of the game (the `Play` screen calls it with the step's input): the
 * rules report what happened as events, and `playEvents` answers them with sound, dust, a shake and a freeze.
 */
interface State {
  screen: "title" | "play" | "end";
  run: Run;
  /** Gems collected: there is one in the level. */
  gems: number;
  step: (input: InputState, dt: number) => void;
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
    if (screen !== "play") return;
    const events: GameEvent[] = [];
    const next = stepRun(run, readControls(input), dt, events);
    set({ run: next, screen: next.finished ? "end" : "play" });
    playEvents(events, run.originX, run.originY);
  },
  begin: () => set({ run: newRun(), screen: "play", gems: 0 }),
  toTitle: () => set({ run: newRun(), screen: "title", gems: 0 }),
  collect: () => set((s) => ({ gems: s.gems + 1 })),
}));
