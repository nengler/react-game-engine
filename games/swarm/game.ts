import type { InputBindings, PlayerConfig } from "@tsengine/player";

import { Main } from "./generated/Main.ts";
import { Stress } from "./generated/Stress.ts";

/**
 * `SWARM_STRESS=1500 tse dev games/swarm` plays the stress scene with that many enemies instead of the game (`SWARM_ARMED=1` gives
 * the player every weapon); `tse screenshot` takes pictures of it the same way.
 */
const env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env;
const stress = Number(env["SWARM_STRESS"] ?? 0);

/** The game's entry: just its root. The window, background, assets folder and game state are the root's `<Game>` props. */
export const gameConfig: PlayerConfig = {
  root: () => (stress > 0 ? new Stress({ count: stress, armed: env["SWARM_ARMED"] === "1" }) : new Main()),
};

/** The game's canvas in its window, for `click@x,y` in an input script. */
export const screen = { width: 480, height: 270, windowWidth: 960, windowHeight: 540, fit: "contain" } as const;

/** The names an input script may use (`right*60+up*60, one`): the keyboard's keys for each action. */
export const bindings: InputBindings = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter"],
  one: ["1"],
  two: ["2"],
  three: ["3"],
  pause: ["Escape"],
};
