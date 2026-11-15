import { compileArgs } from "@rge/player-node";

import { loadGame } from "../config.ts";
import { node } from "../run.ts";

/** `rge build [folder]`: compile `src` to `generated` (with scenes and assets where the game has them). */
export function buildCommand(args: readonly string[]): number {
  const game = loadGame(args[0]);
  const result = node(compileArgs(game.dir), game.dir);
  process.stdout.write(result.output);
  return result.ok ? 0 : 1;
}
