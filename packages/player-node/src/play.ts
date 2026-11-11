/**
 * Run a game under Node with a native window:
 *
 *   node packages/player-node/src/play.ts path/to/entry.ts [--no-watch]
 *
 * The entry file calls `run(hostBackend(), { … })`. This installs the backend first, so the same entry file also runs under
 * the native executable. Image and sound paths are relative to the current directory, so run it from the game's folder (the
 * one that holds `assets/`).
 *
 * When that folder has a `src/`, the game is compiled first and then **hot reloaded**: saving a file under `src/` (or
 * `scenes/`) compiles it again and swaps the new build into the open window, keeping the game state and each component's
 * state (see `dev.ts`). A compile error or a thrown error is shown in the window until the next save fixes it. `--no-watch`
 * runs the entry as it is, as the packaged game does: an error is shown in the window, and exits with status 1 when it closes.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_BACKEND_KEY } from "@rge/player";
import { createNodeBackend } from "./backend.ts";
import { playWithReload } from "./dev.ts";

const args = process.argv.slice(2);
const watch = !args.includes("--no-watch");
const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--no-watch");
const entry = args.find((arg) => !arg.startsWith("--"));
if (entry === undefined || unknown.length > 0) {
  console.error("usage: node packages/player-node/src/play.ts <entry.ts> [--no-watch]");
  process.exit(2);
}

const backend = createNodeBackend();
(globalThis as Record<string, unknown>)[HOST_BACKEND_KEY] = backend;
const gameDir = dirname(resolve(entry));
if (watch && existsSync(join(gameDir, "src"))) {
  const { failed } = await playWithReload(backend, { entry, gameDir });
  if (failed) process.exitCode = 1;
} else {
  await import(pathToFileURL(resolve(entry)).href);
}
