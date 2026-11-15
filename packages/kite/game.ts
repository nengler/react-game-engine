import type { InputBindings, PlayerConfig } from "@rge/player";

import { Main } from "./generated/Main.ts";

/** The game's entry: just its root. The window, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  root: () => new Main(),
};

/**
 * The names an input script may use (`right*30, jump, right*20+dash`): the keyboard's keys for each action. A script is
 * also the replay format: `test/replays.ts` holds one that finishes each room.
 */
export const bindings: InputBindings = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  jump: ["Z"],
  dash: ["X"],
  grab: ["C"],
};
