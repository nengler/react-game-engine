import { createGameState } from "@rge/runtime";

import { sfx } from "./effects.ts";
import { afterOutcome, newRun, type Run } from "./rules/level.ts";

/**
 * The game's shared state: which screen is showing, the facts of the run that more than one component reads (the room, the
 * deaths, whether the character is dead, the time), and the gem. It does not step anything: the character moves itself
 * (`Player.tsx`) and reports what happened through these actions, the clock included.
 */
interface State {
  screen: "title" | "play" | "end";
  run: Run;
  /** Gems collected: there is one in the level. */
  gems: number;
  /** Start a new run: the first room, no deaths, no gems. */
  begin: () => void;
  /** Back to the title screen. */
  toTitle: () => void;
  collect: () => void;
  /** The character died; `respawned` when it is back at the room's start. */
  died: () => void;
  respawned: () => void;
  /** The character went through the room's exit into the next room. */
  enteredRoom: () => void;
  /** The character went through the last exit: the end screen. */
  finished: () => void;
  /** Time played: the character adds each step it plays (not the camera's slides between rooms). */
  tick: (dt: number) => void;
}

export const useGame = createGameState<State>()((set) => ({
  screen: "title",
  run: newRun(),
  gems: 0,
  begin: () => {
    sfx.play("start");
    set({ run: newRun(), screen: "play", gems: 0 });
  },
  toTitle: () => set({ run: newRun(), screen: "title", gems: 0 }),
  collect: () => set((s) => ({ gems: s.gems + 1 })),
  died: () => set((s) => ({ run: afterOutcome(s.run, "died") })),
  respawned: () => set((s) => ({ run: afterOutcome(s.run, "respawned") })),
  enteredRoom: () => set((s) => ({ run: afterOutcome(s.run, "entered") })),
  finished: () => set((s) => ({ run: afterOutcome(s.run, "finished"), screen: "end" })),
  tick: (dt) => set((s) => (s.run.finished ? {} : { run: { ...s.run, time: s.run.time + dt } })),
}));
