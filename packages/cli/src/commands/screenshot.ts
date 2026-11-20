/**
 * Render frames of a scripted run to PNG through the headless (software) build, and a contact sheet of them. For looking at
 * a room, an animation or a camera slide without a window.
 *
 *   npm run native:build:headless   (in this repository; an installed game has libtse from @tsengine/native)
 *   tse screenshot games/demo --script "right*30" --at 0,15,29 --out /tmp/shots
 *
 * The game folder holds `game.ts`, which exports `gameConfig` (what `run` takes) and may export `bindings` (the action names a
 * script may use, `jump`, `right`; see `parseInputScript`) and `screen` (how the canvas sits in the window, for `click@x,y`). The script is run with the folder as the working directory, so
 * the game's `assets/` resolve as when it is played. The game is compiled first (`src` to `generated`, as `tse build` does), so a
 * shot always shows the source as it is now; a compile error is printed and nothing is shot.
 *
 * Options:
 *   --script "<script>"     the input script (default: 1 idle step)
 *   --script-file <file>    the script, from a file
 *   --at 0,10,20            steps to capture (0 is after the first scripted frame); default is the last step. A negative
 *                           number counts back from the end (-1 is the last step) and `last` is the last step, so a shot of
 *                           how a script ends does not need its frames counted: --at 0,-30,last
 *   --every N               capture every Nth step instead
 *   --from N --to N         with --every: only steps N to N (default the whole script), so a sheet shows one stretch of a long run
 *   --setup <file>          a module whose default export `(player, step) => void` is called before each scripted step (0
 *                           first; the game is built by then): it puts the game where the shot needs it, and what it changes
 *                           shows in that step's picture (`findComponent` from @tsengine/testing reaches a component's state)
 *   --saves                 read and write the player's own saved data; without it a run starts with none and keeps nothing
 *   --out <dir>             where to write (default ./shots); frames are step-<n>.png
 *   --sheet <name>          also write a contact sheet <name>.png of the captured frames
 *   --columns N --scale N   the sheet's frames per row and enlargement; --scale also enlarges the single frames
 *   --gpu                   draw with the desktop build on the GPU (OpenGL), as a player's window does, not the software renderer:
 *                           what a shader or a driver does shows. Needs `npm run native:build` and a display; without one (CI, a
 *                           cloud machine) it runs itself again under `xvfb-run`, which Mesa's software OpenGL backs
 *   --compare <dir>         compare each frame with <dir>/step-<n>.png and exit 1 if one differs (new frames are written to --out)
 *   --tolerance N           how far a channel (0 to 255) may differ before a pixel counts as different (default 0)
 *   --update                with --compare: write the frames into <dir> as the new references instead of comparing
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseInputScript, type InputBindings, type Player, type PlayerConfig, type ScriptOptions } from "@tsengine/player";
import {
  compileArgs,
  contactSheet,
  decodePng,
  encodePng,
  findNativeLibraryOf,
  pixelDifference,
  renderRun,
  type Pixels,
} from "@tsengine/player-node";

import { cliScript, node } from "../run.ts";

const usage =
  'usage: tse screenshot <gameFolder> [--script "<script>" | --script-file <file>] [--at 0,10 | --every N [--from N] [--to N]] [--setup file] [--saves] [--out dir] [--sheet name] [--columns N] [--scale N] [--gpu] [--compare dir [--tolerance N] [--update]]';

/** Options that take no value. */
const SWITCHES = new Set(["gpu", "update", "saves"]);

/** The virtual display `--gpu` runs under when there is none: large enough for a game's hidden window at its default scale. */
const XVFB_SCREEN = "-screen 0 1920x1080x24";

function hasDisplay(env: NodeJS.ProcessEnv): boolean {
  return process.platform !== "linux" || Boolean(env["DISPLAY"]) || Boolean(env["WAYLAND_DISPLAY"]);
}

function onPath(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).status === 0;
}

function enlarge(pixels: Pixels, scale: number): Pixels {
  if (scale <= 1) return pixels;
  const rgba = new Uint8Array(pixels.width * scale * pixels.height * scale * 4);
  const width = pixels.width * scale;
  for (let y = 0; y < pixels.height * scale; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / scale) * pixels.width + Math.floor(x / scale)) * 4;
      rgba.set(pixels.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height: pixels.height * scale, rgba };
}

export async function screenshotCommand(argv: readonly string[]): Promise<number> {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--") && SWITCHES.has(arg.slice(2))) flags.set(arg.slice(2), "true");
    else if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined) {
        console.error(`${arg} needs a value.\n${usage}`);
        return 2;
      }
      flags.set(arg.slice(2), value);
      i++;
    } else positional.push(arg);
  }
  const folder = positional[0];
  if (folder === undefined) {
    console.error(usage);
    return 2;
  }
  const gameDir = resolve(folder);
  const gpu = flags.has("gpu");
  let library: string | undefined;
  if (gpu) {
    const found = findNativeLibraryOf("desktop");
    if (found === null) {
      console.error(
        "--gpu needs the desktop build of libtse: run `npm run native:build`. On Debian or Ubuntu it needs the window libraries first: `sudo apt-get install libx11-dev libxrandr-dev libxi-dev libxcursor-dev libxinerama-dev libgl1-mesa-dev` (see Getting started)."
      );
      return 2;
    }
    library = found;
    if (!hasDisplay(process.env)) {
      // No display (CI, a cloud machine): run again under a virtual one, which Mesa's software OpenGL draws for.
      if (process.env["TSE_UNDER_XVFB"] === "1" || !onPath("xvfb-run")) {
        console.error("--gpu needs a display, and there is none: install Xvfb (`sudo apt install xvfb`) or run it in a desktop session.");
        return 2;
      }
      const again = spawnSync("xvfb-run", ["-a", "-s", XVFB_SCREEN, process.execPath, cliScript(), "screenshot", ...argv], {
        stdio: "inherit",
        env: { ...process.env, TSE_UNDER_XVFB: "1" },
      });
      return again.status ?? 1;
    }
  }
  const compareDir = flags.has("compare") ? resolve(flags.get("compare") as string) : null;
  const tolerance = Number(flags.get("tolerance") ?? 0);
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    console.error(`--tolerance takes a whole number from 0 to 255.\n${usage}`);
    return 2;
  }
  // Compile first, as `tse check` and `tse dev` do: the generated code a shot runs is never older than the source. About a second.
  const compiled = node(compileArgs(gameDir), gameDir);
  if (!compiled.ok) {
    process.stderr.write(compiled.output);
    console.error("tse screenshot: the game did not compile, so nothing was shot.");
    return 1;
  }
  const mod = (await import(pathToFileURL(join(gameDir, "game.ts")).href)) as {
    gameConfig: PlayerConfig;
    bindings?: InputBindings;
    screen?: ScriptOptions["screen"];
  };
  let beforeStep: ((player: Player, step: number) => void) | undefined;
  if (flags.has("setup")) {
    // Resolved before the working directory moves to the game's folder, as the other paths on the command line are.
    const file = resolve(flags.get("setup") as string);
    const setup = (await import(pathToFileURL(file).href)) as { default?: unknown };
    if (typeof setup.default !== "function") {
      console.error(`--setup: ${file} has no default export that is a function (player, step) => void.`);
      return 2;
    }
    beforeStep = setup.default as (player: Player, step: number) => void;
  }
  process.chdir(gameDir);
  const script =
    flags.get("script-file") !== undefined ? readFileSync(flags.get("script-file") as string, "utf8") : (flags.get("script") ?? "_");
  const frames = parseInputScript(script, { bindings: mod.bindings, screen: mod.screen });
  let at: number[] | undefined;
  if (flags.has("at"))
    at = (flags.get("at") as string).split(",").map((step) => {
      const n = step.trim() === "last" ? -1 : Number(step);
      return Number.isInteger(n) && n < 0 ? frames.length + n : n;
    });
  else if (flags.has("every")) {
    const every = Math.max(1, Number(flags.get("every")));
    const from = Number(flags.get("from") ?? 0);
    const to = Number(flags.get("to") ?? frames.length - 1);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to >= frames.length || from > to) {
      console.error(`--from and --to need steps from 0 to ${frames.length - 1}, --from no later than --to.`);
      return 2;
    }
    at = [];
    for (let step = from + every - 1; step <= to; step += every) at.push(step);
    if (at.length === 0) at = [to];
  } else at = [frames.length - 1];
  if (at.some((n) => !Number.isInteger(n) || n < 0 || n >= frames.length)) {
    console.error(
      `--at needs steps from 0 to ${frames.length - 1} (the script has ${frames.length} frames), or counted back from the end: -1 or \`last\` is the last step.`
    );
    return 2;
  }
  const warnings: string[] = [];
  const shots = renderRun(mod.gameConfig, frames, {
    at,
    warnings,
    saves: flags.has("saves"),
    ...(beforeStep !== undefined ? { beforeStep } : {}),
    ...(library !== undefined ? { library } : {}),
  });
  const scale = Math.max(1, Number(flags.get("scale") ?? 1));
  const out = resolve(flags.get("out") ?? "shots");
  mkdirSync(out, { recursive: true });
  for (const shot of shots)
    writeFileSync(join(out, `step-${shot.step}.png`), encodePng(enlarge(shot.pixels, shot.pixels.width * scale > 1600 ? 1 : scale)));
  const written = shots.map((shot) => `step-${shot.step}.png`);
  const sheetName = flags.get("sheet");
  if (sheetName !== undefined) {
    const sheet = contactSheet(
      shots.map((shot) => shot.pixels),
      { columns: Number(flags.get("columns") ?? 4), scale, labels: shots.map((shot) => shot.step) }
    );
    writeFileSync(join(out, `${sheetName}.png`), encodePng(sheet));
    written.push(`${sheetName}.png`);
  }
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  console.log(`${frames.length} frames run${gpu ? " on the GPU" : ""}; wrote ${written.join(", ")} to ${out}`);
  if (compareDir === null) return 0;
  if (flags.has("update")) {
    mkdirSync(compareDir, { recursive: true });
    for (const shot of shots) writeFileSync(join(compareDir, `step-${shot.step}.png`), encodePng(shot.pixels));
    console.log(`updated ${shots.length} reference${shots.length === 1 ? "" : "s"} in ${compareDir}`);
    return 0;
  }
  let failed = 0;
  for (const shot of shots) {
    const reference = join(compareDir, `step-${shot.step}.png`);
    if (!existsSync(reference)) {
      console.log(`new   step-${shot.step}: no reference (--update writes it)`);
      failed++;
      continue;
    }
    const diff = pixelDifference(shot.pixels, decodePng(readFileSync(reference)), tolerance);
    if (diff === 0) console.log(`same  step-${shot.step}`);
    else {
      failed++;
      console.log(
        `DIFF  step-${shot.step}: ${typeof diff === "number" ? `${diff} pixels differ by more than ${tolerance}` : diff} (the new frame is in ${out})`
      );
    }
  }
  return failed === 0 ? 0 : 1;
}
