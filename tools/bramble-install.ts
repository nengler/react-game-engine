/**
 * Repack the engine and reinstall the tarballs into `games/bramble`: the in-repo loop when the engine changes. Slower than a
 * workspace on purpose; it is the loop an author outside the repository has. `--no-save` keeps the game's package.json as it
 * is (dependencies on version 0.0.0), so nothing about the packs ends up committed.
 *
 *   npm run bramble:install
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packAll } from "./pack.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tarballs = packAll(join(root, "dist", "packs"));
execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", ...tarballs], {
  cwd: join(root, "games/bramble"),
  stdio: "inherit",
});
console.log("installed the packs into games/bramble: `cd games/bramble && npm run check`");
