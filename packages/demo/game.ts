import type { PlayerConfig } from "@rge/player";
import { Main } from "./generated/Main.ts";

/** The demo's entry: the window's size, and its root. The title, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  width: 640,
  height: 360,
  root: () => new Main(),
};
