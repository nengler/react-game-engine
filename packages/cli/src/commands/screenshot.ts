/**
 * Render frames of a scripted run to PNG through the headless (software) build, and a contact sheet of them. For looking at
 * a room, an animation or a camera slide without a window.
 *
 *   npm run native:build:headless   (in this repository; an installed game has librge from @rge/native)
 *   rge screenshot packages/demo --script "right*30" --at 0,15,29 --out /tmp/shots
 *
 * The game folder holds `game.ts`, which exports `gameConfig` (what `run` takes) and may export `bindings` (the action names a
 * script may use, `jump`, `right`; see `parseInputScript`) and `screen` (how the canvas sits in the window, for `click@x,y`). The script is run with the folder as the working directory, so
 * the game's `assets/` resolve as when it is played.
 *
 * Options:
 *   --script "<script>"     the input script (default: 1 idle step)
 *   --script-file <file>    the script, from a file
 *   --at 0,10,20            steps to capture (0 is after the first scripted frame); default is the last step
 *   --every N               capture every Nth step instead
 *   --out <dir>             where to write (default ./shots); frames are step-<n>.png
 *   --sheet <name>          also write a contact sheet <name>.png of the captured frames
 *   --columns N --scale N   the sheet's frames per row and enlargement; --scale also enlarges the single frames
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseInputScript, type InputBindings, type PlayerConfig, type ScriptOptions } from "@rge/player";
import { contactSheet, encodePng, renderRun, type Pixels } from "@rge/player-node";

const usage =
  'usage: rge screenshot <gameFolder> [--script "<script>" | --script-file <file>] [--at 0,10 | --every N] [--out dir] [--sheet name] [--columns N] [--scale N]';

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
    if (arg.startsWith("--")) {
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
  const mod = (await import(pathToFileURL(join(gameDir, "game.ts")).href)) as {
    gameConfig: PlayerConfig;
    bindings?: InputBindings;
    screen?: ScriptOptions["screen"];
  };
  process.chdir(gameDir);
  const script =
    flags.get("script-file") !== undefined ? readFileSync(flags.get("script-file") as string, "utf8") : (flags.get("script") ?? "_");
  const frames = parseInputScript(script, { bindings: mod.bindings, screen: mod.screen });
  let at: number[] | undefined;
  if (flags.has("at")) at = (flags.get("at") as string).split(",").map(Number);
  else if (flags.has("every")) {
    const every = Math.max(1, Number(flags.get("every")));
    at = frames.map((_, i) => i).filter((i) => i % every === every - 1);
  } else at = [frames.length - 1];
  if (at.some((n) => !Number.isInteger(n) || n < 0 || n >= frames.length)) {
    console.error(`--at needs steps from 0 to ${frames.length - 1} (the script has ${frames.length} frames).`);
    return 2;
  }
  const warnings: string[] = [];
  const shots = renderRun(mod.gameConfig, frames, { at, warnings });
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
  console.log(`${frames.length} frames run; wrote ${written.join(", ")} to ${out}`);
  return 0;
}
