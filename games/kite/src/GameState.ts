import { createGameState } from "@tsengine/runtime";

import { sfx } from "./effects.ts";
import { afterOutcome, newRun, type Run } from "./rules/level.ts";

type Screen = "title" | "play" | "end";

/**
 * The game's shared state: which screen is showing, the facts of the run that more than one component reads (the room, the
 * deaths, whether the character is dead, the time), and the gem. It does not step anything: the character moves itself
 * (`Player.tsx`) and reports what happened through these actions, the clock included.
 */
export const useGame = createGameState(
  {
    screen: "title" as Screen,
    run: newRun() as Run,
    /** Gems collected: there is one in the level. */
    gems: 0,
  },
  {
    /** Start a new run: the first room, no deaths, no gems. */
    begin(s) {
      sfx.play("start");
      s.run = newRun();
      s.screen = "play";
      s.gems = 0;
    },
    /** Back to the title screen. */
    toTitle(s) {
      s.run = newRun();
      s.screen = "title";
      s.gems = 0;
    },
    collect(s) {
      s.gems += 1;
    },
    /** The character died; `respawned` when it is back at the room's start. */
    died(s) {
      s.run = afterOutcome(s.run, "died");
    },
    respawned(s) {
      s.run = afterOutcome(s.run, "respawned");
    },
    /** The character went through the room's exit into the next room. */
    enteredRoom(s) {
      s.run = afterOutcome(s.run, "entered");
    },
    /** The character went through the last exit: the end screen. */
    finished(s) {
      s.run = afterOutcome(s.run, "finished");
      s.screen = "end";
    },
    /** Time played: the character adds each step it plays (not the camera's slides between rooms). */
    tick(s, dt: number) {
      if (!s.run.finished) s.run.time += dt;
    },
  }
);
