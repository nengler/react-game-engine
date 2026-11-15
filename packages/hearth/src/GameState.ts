import { createGameState } from "@rge/runtime";

import { sfx } from "./effects.ts";

type Screen = "title" | "play" | "won" | "lost";

/**
 * What the screens share: which screen shows, the cursor (the pad the panel is about, which the pads and the side panel both
 * read), the speed and the pause (which `<Game timeScale paused>` reads), and how the last battle ended (for the end screen). The
 * battle itself is not here: `Play` keeps the gold, the lives and the wave, and each enemy, tower and shot keeps its own state.
 */
interface Shared {
  screen: Screen;
  /** The pad the cursor is on (the focused pad), and whether the panel shows it. */
  cursor: number;
  open: boolean;
  speed: 1 | 2;
  paused: boolean;
  /** The lives left and the wave reached when the last battle ended. */
  endLives: number;
  endWave: number;
}

/** The cursor on the first pad, the panel closed, normal speed, not paused. */
function fresh(s: Shared, screen: Screen): void {
  s.screen = screen;
  s.cursor = 0;
  s.open = false;
  s.speed = 1;
  s.paused = false;
}

export const useGame = createGameState(
  {
    screen: "title",
    cursor: 0,
    open: false,
    speed: 1,
    paused: false,
    endLives: 0,
    endWave: 0,
  } as Shared,
  {
    begin(s) {
      sfx.play("click");
      fresh(s, "play");
    },
    toTitle(s) {
      fresh(s, "title");
    },
    /** The focus came to a pad (the arrow keys, or a click): the cursor moves, the panel stays as it is. */
    point(s, pad: number) {
      s.cursor = pad;
    },
    /** A pad was pressed (a click, or confirm on the focused pad): the cursor moves and the panel opens. */
    select(s, pad: number) {
      s.cursor = pad;
      s.open = true;
    },
    close(s) {
      s.open = false;
    },
    toggleSpeed(s) {
      s.speed = s.speed === 1 ? 2 : 1;
    },
    togglePause(s) {
      s.paused = !s.paused;
    },
    resume(s) {
      s.paused = false;
    },
    /** The battle is over: `Play` says how it went, and the end screen shows. */
    finish(s, won: boolean, lives: number, wave: number) {
      sfx.play(won ? "win" : "lose");
      s.screen = won ? "won" : "lost";
      s.endLives = lives;
      s.endWave = wave;
      s.paused = false;
      s.speed = 1;
    },
  }
);
