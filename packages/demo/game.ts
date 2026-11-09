import type { PlayerConfig } from "@rge/player";
import { Main } from "./generated/Main.ts";

/** The demo's entry: just its root. The window, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  root: () => new Main(),
};
