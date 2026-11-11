/**
 * `rge package [folder] [--engine node|quickjs] [--headless] [--entry <file>] [--name <name>]`: build a game as a folder you can
 * hand to someone, `dist/<name>/` in the game's folder. `--headless` uses the software renderer (no window; for CI) instead of a
 * real window. `--engine` picks what runs the game's script:
 *
 * - `node` (the default): `<name>` is a Node single executable application (Node's own binary with the bundled game inside it,
 *   so V8 and its JIT), `lib/` (librge as a shared library), `node_modules/` (koffi, which loads it) and `assets/`. About
 *   100 MB, most of it Node; for desktops, where script time matters more than size.
 * - `quickjs`: `<name>` is the Rust host (which with no arguments runs the `game.js` beside it), `game.js` and `assets/`. A few
 *   MB; an interpreter, so it goes where a JIT is not allowed, but script runs 10 to 30 times slower than under V8.
 *
 * librge and rge-host come from `@rge/native` (or, in this repository, its build folders: `npm run native:build[:headless]`
 * and `npm run host:build[:headless]`); nothing is compiled here.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { bundleForHost } from "../bundle.ts";
import { loadGame, UsageError, type Game } from "../config.ts";
import { findHost, findLibrary, type NativeFlavor } from "../native.ts";

function option(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function packageCommand(args: readonly string[]): Promise<number> {
  const engine = option(args, "--engine") ?? "node";
  if (engine !== "node" && engine !== "quickjs") throw new UsageError("--engine is node or quickjs");
  const values = new Set(["--engine", "--entry", "--name"].map((flag) => args.indexOf(flag) + 1).filter((i) => i > 0));
  const folder = args.find((arg, i) => !arg.startsWith("--") && !values.has(i));
  const game = loadGame(folder);
  const flavor: NativeFlavor = args.includes("--headless") ? "headless" : "desktop";
  const entry = option(args, "--entry") ?? game.entry;
  const name = option(args, "--name") ?? game.name;
  if (!existsSync(join(game.dir, entry))) throw new UsageError(`${join(game.dir, entry)} does not exist`);

  const out = join(game.dir, "dist", name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  if (engine === "quickjs") await packageQuickJs(game, entry, name, flavor, out);
  else await packageNode(game, entry, name, flavor, out);
  if (existsSync(join(game.dir, "assets"))) cpSync(join(game.dir, "assets"), join(out, "assets"), { recursive: true });
  console.log(`\npackaged ${entry} -> ${relative(process.cwd(), out) || out} (${engine === "node" ? "Node/V8" : "QuickJS-ng"}, ${flavor === "headless" ? "headless: no window" : "with a window"})`);
  return 0;
}

const exeName = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

function need(path: string | null, what: string, hint: string): string {
  if (path === null) throw new UsageError(`${what} was not found. ${hint}`);
  return path;
}

async function packageQuickJs(game: Game, entry: string, name: string, flavor: NativeFlavor, out: string): Promise<void> {
  await bundleForHost(join(game.dir, entry), join(out, "game.js"));
  const host = need(findHost(flavor), "rge-host", `It ships in @rge/native; in the repository, build it with \`npm run host:build${flavor === "headless" ? ":headless" : ""}\`.`);
  cpSync(host, join(out, exeName(name)));
}

/**
 * The game, `@rge/player-node` and its backend bundled into one CommonJS script, put inside a copy of the running Node binary
 * (https://nodejs.org/api/single-executable-applications.html). Such a script can `require` only Node's own modules, so
 * koffi, which finds its native addon by paths relative to its own files, ships unbundled in `node_modules/` beside the
 * executable and is loaded from there.
 */
async function packageNode(game: Game, entry: string, name: string, flavor: NativeFlavor, out: string): Promise<void> {
  const lib = need(findLibrary(flavor), "librge", `It ships in @rge/native; in the repository, build it with \`npm run native:build${flavor === "headless" ? ":headless" : ""}\`.`);
  const libName = basename(lib);
  mkdirSync(join(out, "lib"));
  cpSync(lib, join(out, "lib", libName));

  // koffi and the package with this platform's addon (an optional dependency of koffi's, so it is the one installed).
  const playerNode = createRequire(fileURLToPath(import.meta.resolve("@rge/player-node")));
  // koffi's "exports" hides its package.json, so find its folder from its main file.
  let koffiDir = dirname(playerNode.resolve("koffi"));
  while (!existsSync(join(koffiDir, "package.json")) || basename(koffiDir) !== "koffi") koffiDir = dirname(koffiDir);
  const modules = dirname(koffiDir);
  const addon = join(modules, "@koromix", `koffi-${process.platform}-${process.arch}`);
  for (const [from, to] of [[koffiDir, "koffi"], [addon, join("@koromix", basename(addon))]] as const) {
    if (!existsSync(from)) throw new UsageError(`${from} is not installed: run \`npm install\`.`);
    cpSync(from, join(out, "node_modules", to), { recursive: true }); // about 3 MB, next to Node's 100
  }

  // The script: install the backend over the shipped librge, then run the game. Two modules, because imports run in order and
  // the game's `hostBackend()` must find the backend when it is evaluated.
  const work = join(out, ".build");
  mkdirSync(work);
  const importPath = (path: string): string => {
    const rel = relative(work, path).split("\\").join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  writeFileSync(
    join(work, "backend.ts"),
    [
      `import { dirname, join } from "node:path";`,
      `import { HOST_BACKEND_KEY } from "@rge/player";`,
      `import { createNodeBackend } from "@rge/player-node";`,
      `// Like the Rust host run with no arguments: the game's paths (its assets/) are relative to the executable's folder.`,
      `const folder = dirname(process.execPath);`,
      `process.chdir(folder);`,
      `(globalThis as Record<string, unknown>)[HOST_BACKEND_KEY] = createNodeBackend(join(folder, "lib", ${JSON.stringify(libName)}));`,
      ``,
    ].join("\n"),
  );
  writeFileSync(join(work, "main.ts"), `import "./backend.ts";\nimport ${JSON.stringify(importPath(resolve(game.dir, entry)))};\n`);

  // `koffi` resolves to the copy beside the executable, through a `require` made for that folder.
  const koffiBesideExe: Plugin = {
    name: "koffi-beside-exe",
    setup(b) {
      b.onResolve({ filter: /^koffi$/ }, () => ({ path: "koffi", namespace: "beside-exe" }));
      b.onLoad({ filter: /.*/, namespace: "beside-exe" }, () => ({
        contents: `module.exports = require("node:module").createRequire(process.execPath)("koffi");`,
        loader: "js",
      }));
    },
  };
  const script = join(work, "game.cjs");
  await build({
    entryPoints: [join(work, "main.ts")],
    outfile: script,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    plugins: [koffiBesideExe],
    // A CommonJS script has no `import.meta`; `@rge/player-node` reads its URL to find the repository's builds, which a packaged
    // game does not use (it passes librge's path), but the module still works it out when it loads.
    define: { "import.meta.url": "__rgeModuleUrl" },
    banner: { js: `const __rgeModuleUrl = require("node:url").pathToFileURL(process.execPath).href;` },
    legalComments: "none",
    logLevel: "warning",
  });

  // The blob Node reads at startup, injected into a copy of this Node binary.
  const blob = join(work, "sea.blob");
  const sh = (command: string, commandArgs: string[]): void => {
    const result = spawnSync(command, commandArgs, { cwd: game.dir, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`\`${command} ${commandArgs.join(" ")}\` failed${result.error ? `: ${result.error.message}` : ` with status ${result.status}`}.`);
  };
  writeFileSync(join(work, "sea-config.json"), JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true }));
  sh(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")]);
  const exe = join(out, exeName(name));
  cpSync(process.execPath, exe);
  // Unverified on macOS and Windows: these follow the Node documentation's steps for each.
  if (process.platform === "darwin") sh("codesign", ["--remove-signature", exe]);
  const postject = join(dirname(createRequire(import.meta.url).resolve("postject/package.json")), "dist", "cli.js");
  sh(process.execPath, [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])]);
  if (process.platform === "darwin") sh("codesign", ["--sign", "-", exe]);
  rmSync(work, { recursive: true, force: true });
}
