import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGame, UsageError } from "../config.ts";

/** `rge dev [folder] [--no-watch]`: compile, open the window and hot reload. */
export function devCommand(args: readonly string[]): number {
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-watch");
  if (unknown.length > 0) throw new UsageError(`unknown option ${unknown[0]}\nusage: rge dev [folder] [--no-watch]`);
  const game = loadGame(args.find((arg) => !arg.startsWith("--")));
  const dir = dirname(fileURLToPath(import.meta.resolve("@rge/player-node")));
  const play = [join(dir, "play.ts"), join(dir, "play.js")].find((path) => existsSync(path));
  if (play === undefined) throw new Error("@rge/player-node has no play script");
  // The window's image and sound paths are relative to the game's folder.
  const result = spawnSync(process.execPath, [play, game.entry, ...(args.includes("--no-watch") ? ["--no-watch"] : [])], { cwd: game.dir, stdio: "inherit" });
  return result.status ?? 1;
}
