import type { InputBindings, PlayerConfig } from "@tsengine/player";

import { Main } from "./generated/Main.ts";

/** The demo's entry: just its root. The window, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  root: () => new Main(),
};

/** Names for the input scripts that tests and the screenshot tool use (`right*30, down*10`); anything else is a key name. */
export const bindings: InputBindings = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
};
