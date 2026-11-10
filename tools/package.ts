/**
 * Build a game as a folder you can hand to someone: the native executable, the bundled game and its assets.
 *
 *   npm run package [-- <entry.ts> <name> <assets-dir>] [--headless] [--engine node|quickjs]
 *
 * The defaults package the demo. `--headless` builds on raylib's software renderer (no window; for CI) instead of a
 * real window. `--engine` picks what runs the game's script:
 *
 * - `node` (the default): `dist/demo/` holds `demo` (a Node single executable application: Node's own binary with the bundled game
 *   inside it, so V8 and its JIT), `lib/` (librge as a shared library), `node_modules/` (koffi, which loads it) and
 *   `assets/`. About 100 MB, most of it Node; for desktops, where script time matters more than size.
 * - `quickjs` (the fallback): `dist/demo/` holds `demo` (the Rust host, which with no arguments runs the `game.js`
 *   beside it), `game.js` and `assets/`. A few MB; an interpreter, so it goes where a JIT is not allowed (iOS,
 *   consoles), but script runs 10 to 30 times slower than under V8 (see docs/NATIVE_PLAN.md).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build, type Plugin } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const headless = args.includes("--headless");
const engineAt = args.indexOf("--engine");
const engine = engineAt >= 0 ? args[engineAt + 1] : "node";
if (engine !== "quickjs" && engine !== "node") {
  console.error("usage: npm run package [-- <entry.ts> <name> <assets-dir>] [--headless] [--engine node|quickjs]");
  process.exit(2);
}
const positional = args.filter((arg, i) => !arg.startsWith("--") && !(engineAt >= 0 && i === engineAt + 1));
const [entry = "packages/demo/main.ts", name = "demo", assets = "packages/demo/assets"] = positional;

function run(command: string, commandArgs: string[]): void {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\`${command} ${commandArgs.join(" ")}\` failed${result.error ? `: ${result.error.message}` : ` with status ${result.status}`}.`);
    process.exit(result.status ?? 1);
  }
}

const out = join(root, "dist", name);
const exeName = process.platform === "win32" ? `${name}.exe` : name;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (engine === "quickjs") await packageQuickJs();
else await packageNode();
if (existsSync(resolve(root, assets))) cpSync(resolve(root, assets), join(out, "assets"), { recursive: true });
console.log(`\npackaged ${entry} -> dist/${name}/ (${engine === "node" ? "Node/V8" : "QuickJS-ng"}, ${headless ? "headless: no window" : "with a window"})`);

async function packageQuickJs(): Promise<void> {
  run(process.execPath, ["tools/bundle.ts", entry, join("dist", name, "game.js")]);
  run("cargo", ["build", "--release", "--manifest-path", "host/Cargo.toml", ...(headless ? ["--features", "headless"] : [])]);
  const built = join(root, "host", "target", "release", process.platform === "win32" ? "rge-host.exe" : "rge-host");
  if (!existsSync(built)) {
    console.error(`The host was not built where expected: ${built}`);
    process.exit(1);
  }
  cpSync(built, join(out, exeName));
}

/**
 * The game, `@rge/player-node` and its backend bundled into one CommonJS script, put inside a copy of the running
 * Node binary (https://nodejs.org/api/single-executable-applications.html). Such a script can `require` only Node's
 * own modules, so koffi, which finds its native addon by paths relative to its own files, ships unbundled in
 * `node_modules/` beside the executable and is loaded from there.
 */
async function packageNode(): Promise<void> {
  // librge as a shared library: the same build the Node dev host uses.
  const folder = headless ? "build-headless" : "build";
  run("cmake", ["-S", "native", "-B", `native/${folder}`, ...(headless ? ["-DRGE_PLATFORM=Memory"] : [])]);
  run("cmake", ["--build", `native/${folder}`, "-j", "--target", "rge"]);
  const libName = process.platform === "win32" ? "rge.dll" : process.platform === "darwin" ? "librge.dylib" : "librge.so";
  const lib = [join(root, "native", folder, libName), join(root, "native", folder, "Release", libName)].find((path) => existsSync(path));
  if (lib === undefined) {
    console.error(`librge was not built where expected, in native/${folder}.`);
    process.exit(1);
  }
  mkdirSync(join(out, "lib"));
  cpSync(lib, join(out, "lib", libName));

  // koffi and the package with this platform's addon (an optional dependency of koffi's, so it is the one installed).
  const modules = join(root, "node_modules");
  const platform = `@koromix/koffi-${process.platform}-${process.arch}`;
  for (const pkg of ["koffi", platform]) {
    if (!existsSync(join(modules, pkg))) {
      console.error(`${pkg} is not installed in node_modules: run \`npm install\`.`);
      process.exit(1);
    }
    cpSync(join(modules, pkg), join(out, "node_modules", pkg), { recursive: true }); // about 3 MB, next to Node's 100
  }

  // The script: install the backend over the shipped librge, then run the game. Two modules, because imports run in
  // order and the game's `hostBackend()` must find the backend when it is evaluated.
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
  writeFileSync(join(work, "main.ts"), `import "./backend.ts";\nimport ${JSON.stringify(importPath(resolve(root, entry)))};\n`);

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
    // A CommonJS script has no `import.meta`; `@rge/player-node` reads its URL to find the repository's builds, which a
    // packaged game does not use (it passes librge's path), but the module still works it out when it loads.
    define: { "import.meta.url": "__rgeModuleUrl" },
    banner: { js: `const __rgeModuleUrl = require("node:url").pathToFileURL(process.execPath).href;` },
    legalComments: "none",
    logLevel: "warning",
  });

  // The blob Node reads at startup, injected into a copy of this Node binary.
  const blob = join(work, "sea.blob");
  writeFileSync(join(work, "sea-config.json"), JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true }));
  run(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")]);
  const exe = join(out, exeName);
  cpSync(process.execPath, exe);
  // Unverified on macOS and Windows: these follow the Node documentation's steps for each.
  if (process.platform === "darwin") run("codesign", ["--remove-signature", exe]);
  const postject = join(root, "node_modules", "postject", "dist", "cli.js");
  run(process.execPath, [
    postject,
    exe,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
    ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
  ]);
  if (process.platform === "darwin") run("codesign", ["--sign", "-", exe]);
  rmSync(work, { recursive: true, force: true });
}
