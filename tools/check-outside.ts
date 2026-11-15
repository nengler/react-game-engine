/**
 * Is the engine usable from outside this repository? Packs it, copies `games/bramble` to a temporary folder away from the
 * repository, points its dependencies at the tarballs, installs, and runs `rge check`, `rge lsp` (a component's diagnostics) and
 * `rge package --headless` there, then runs the packaged build for a few seconds. A relative import into `packages/`, an export a package is missing, or a file left
 * out of a pack fails here.
 *
 *   npm run check:outside
 *
 * It needs librge and rge-host built (`npm run native:build:headless`, `npm run host:build:headless`), which `@rge/native` ships.
 * With `--keep` the temporary folder is left where it is and printed.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packAll } from "./pack.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");
const work = mkdtempSync(join(tmpdir(), "rge-outside-"));
const game = join(work, "bramble");

function step(name: string, command: string, args: string[], cwd: string, allowed: number[] = [0]): void {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const ok = result.status !== null && allowed.includes(result.status);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) {
    console.log(`${result.stdout}${result.stderr}`.trim().split("\n").slice(-60).join("\n"));
    throw new Error(`${name} failed (status ${result.status})`);
  }
}

try {
  const tarballs = packAll(join(work, "packs"));
  console.log(`ok   packed ${tarballs.length} packages`);
  cpSync(join(root, "games/bramble"), game, {
    recursive: true,
    filter: (path) => !/[\\/](node_modules|generated|dist)([\\/]|$)/.test(path.slice(join(root, "games/bramble").length)),
  });
  const manifest = join(game, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, Record<string, string> | undefined>;
  for (const file of readdirSync(join(work, "packs"))) {
    const pack = /^rge-(.+?)-\d/.exec(file)?.[1];
    if (pack === undefined) continue;
    const section = pack === "cli" || pack === "testing" || pack === "language-server" ? "devDependencies" : "dependencies";
    (pkg[section] ??= {})[`@rge/${pack}`] = `file:${join(work, "packs", file)}`;
  }
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);

  step("npm install", "npm", ["install", "--no-audit", "--no-fund"], game);
  const rge = join(game, "node_modules/.bin/rge");
  step("rge check", rge, ["check"], game);
  step("rge lsp", process.execPath, [join(root, "tools/lsp-smoke.ts"), rge, game], game);
  step("rge package --headless", rge, ["package", "--headless"], game);
  // The packaged game runs until its window closes: stopping it after a few seconds (status 124) is the pass.
  const exe = join(game, "dist/bramble/bramble");
  step("run the packaged game", "timeout", ["5", exe], work, [0, 124]);
  console.log("check:outside passed");
} finally {
  if (keep) console.log(`kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
