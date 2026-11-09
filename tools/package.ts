/**
 * Build a game as a folder you can hand to someone: the native executable, the bundled game and its assets.
 *
 *   npm run package [-- <entry.ts> <name> <assets-dir>] [--headless]
 *
 * The defaults package the demo: `dist/demo/` holds `demo` (the Rust host, which with no arguments runs the
 * `game.js` beside it), `game.js` and `assets/`. `--headless` builds the host on raylib's software renderer
 * (no window; for CI) instead of a real window.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const headless = args.includes("--headless");
const [entry = "packages/demo/main.ts", name = "demo", assets = "packages/demo/assets"] = args.filter((arg) => !arg.startsWith("--"));

function run(command: string, commandArgs: string[]): void {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\`${command} ${commandArgs.join(" ")}\` failed${result.error ? `: ${result.error.message}` : ` with status ${result.status}`}.`);
    process.exit(result.status ?? 1);
  }
}

const out = join(root, "dist", name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

run(process.execPath, ["tools/bundle.ts", entry, join("dist", name, "game.js")]);
run("cargo", ["build", "--release", "--manifest-path", "host/Cargo.toml", ...(headless ? ["--features", "headless"] : [])]);

const exe = process.platform === "win32" ? "rge-host.exe" : "rge-host";
const built = join(root, "host", "target", "release", exe);
if (!existsSync(built)) {
  console.error(`The host was not built where expected: ${built}`);
  process.exit(1);
}
cpSync(built, join(out, process.platform === "win32" ? `${name}.exe` : name));
if (existsSync(resolve(root, assets))) cpSync(resolve(root, assets), join(out, "assets"), { recursive: true });
console.log(`\npackaged ${entry} -> dist/${name}/ (${headless ? "headless: no window" : "with a window"})`);
