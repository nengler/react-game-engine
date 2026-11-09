import type { PlayerConfig } from "@rge/player";
import { Game } from "./generated/Game.ts";

/** The demo's window and root, shared by the entry point and the tests. */
export const gameConfig: PlayerConfig = {
  width: 640,
  height: 360,
  title: "rge demo",
  background: "#10131c",
  assets: "assets",
  root: () => new Game(),
};
