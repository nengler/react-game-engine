import { compileArgs } from "@tsengine/player-node";

import { loadGame } from "../config.ts";
import { node } from "../run.ts";

/**
 * `tse build [folder] [--json]`: compile `src` to `generated` (with scenes and assets where the game has them). `--json` prints the
 * compiler's one JSON object (`{ ok, errors, warnings, diagnostics, log }`) instead of its lines.
 */
export function buildCommand(args: readonly string[]): number {
  const json = args.includes("--json");
  const game = loadGame(args.find((arg) => !arg.startsWith("--")));
  const result = node([...compileArgs(game.dir), ...(json ? ["--json"] : [])], game.dir);
  process.stdout.write(json ? result.stdout : result.output);
  return result.ok ? 0 : 1;
}
