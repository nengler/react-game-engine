/**
 * Run a game under Node with a native window:
 *
 *   node packages/player-node/src/play.ts path/to/entry.ts
 *
 * The entry file calls `run(hostBackend(), { … })`. This installs the backend first, so the same
 * entry file also runs under the native executable. Image and sound paths are relative to the
 * current directory, so run it from the folder that holds `assets/`.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HOST_BACKEND_KEY } from "@rge/player";
import { createNodeBackend } from "./backend.ts";

const entry = process.argv[2];
if (entry === undefined) {
  console.error("usage: node packages/player-node/src/play.ts <entry.ts>");
  process.exit(2);
}

(globalThis as Record<string, unknown>)[HOST_BACKEND_KEY] = createNodeBackend();
await import(pathToFileURL(resolve(entry)).href);
