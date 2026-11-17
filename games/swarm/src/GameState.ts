import { createGameState } from "@tsengine/runtime";

import { sfx } from "./effects.ts";

type Screen = "title" | "play" | "over";

/**
 * What the screens share: which one shows, whether the game is paused (the pause menu, or a level-up waiting for a choice, both of
 * which `<Game paused>` reads), and how the last run ended. The run itself is `Play`'s own state.
 */
interface Shared {
  screen: Screen;
  paused: boolean;
  choosing: boolean;
  /** How the last run ended: seconds lived, enemies killed, level reached, and whether the clock ran out first. */
  endTime: number;
  endKills: number;
  endLevel: number;
  survived: boolean;
}

export const useGame = createGameState(
  { screen: "title", paused: false, choosing: false, endTime: 0, endKills: 0, endLevel: 0, survived: false } as Shared,
  {
    begin(s) {
      sfx.play("start");
      s.screen = "play";
      s.paused = false;
      s.choosing = false;
    },
    toTitle(s) {
      s.screen = "title";
      s.paused = false;
      s.choosing = false;
    },
    togglePause(s) {
      if (!s.choosing) s.paused = !s.paused;
    },
    resume(s) {
      s.paused = false;
    },
    /** A level was gained (`true`) or the upgrade picked (`false`): the run waits while the player chooses. */
    choose(s, on: boolean) {
      s.choosing = on;
    },
    finish(s, survived: boolean, time: number, kills: number, level: number) {
      sfx.play("over");
      s.screen = "over";
      s.paused = false;
      s.choosing = false;
      s.survived = survived;
      s.endTime = time;
      s.endKills = kills;
      s.endLevel = level;
    },
  }
);
