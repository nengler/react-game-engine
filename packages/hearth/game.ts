import type { InputBindings, PlayerConfig } from "@rge/player";
import { Main } from "./generated/Main.ts";

/** The game's entry: just its root. The window, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  root: () => new Main(),
};

/** The game's canvas in its window, for `click@x,y` in an input script: the root's `<Screen>` and `<Game>` sizes. */
export const screen = { width: 320, height: 180, windowWidth: 960, windowHeight: 540, fit: "contain" } as const;

/**
 * The names an input script may use (`click@120,64, space, 1, _*60`): the keyboard's keys for each action. A script is also the
 * replay format: `test/replays.ts` holds the ones that win and lose.
 */
export const bindings: InputBindings = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Z"],
  back: ["X"],
  wave: ["Space"],
  fast: ["F"],
  pause: ["Escape"],
  one: ["1"],
  two: ["2"],
  three: ["3"],
  upgrade: ["U"],
  sell: ["S"],
};
