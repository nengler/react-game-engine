/**
 * `rge preview [folder]`: the game's stories (`stories/<Component>.stories.ts`), one component at a time.
 *
 *   rge preview                       a window showing the stories, with hot reload; F5 and F6 switch story
 *   rge preview --story HealthBar     start at a component's first story (or `HealthBar/Hurt`, one story)
 *   rge preview --screenshot          store a PNG of every story in stories/screenshots/, which `rge check` compares
 *   rge preview --screenshot --story HealthBar/Hurt    store just that one again
 *   rge preview --compare [--out dir] render every story and compare with the stored PNGs; exit 1 if any differ
 *
 * The screenshots and the comparison use the headless (software-rendered) build of librge, as `rge screenshot` does.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { compareScreenshots, createNodeBackend, loadPreviews, previewWithReload, writeScreenshots } from "@rge/player-node";
import { loadGame, UsageError } from "../config.ts";
import { findLibrary } from "../native.ts";

const USAGE = "usage: rge preview [folder] [--story <Component or Component/Story>] [--screenshot | --compare [--out dir]]";

export async function previewCommand(argv: readonly string[]): Promise<number> {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--screenshot" || arg === "--compare") flags.set(arg.slice(2), true);
    else if (arg === "--story" || arg === "--out" || arg === "--tolerance") {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value\n${USAGE}`);
      flags.set(arg.slice(2), value);
    } else if (arg.startsWith("--")) throw new UsageError(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  const game = loadGame(positional[0]);
  const story = flags.get("story") as string | undefined;
  // Image, font and sound names are relative to the game's folder.
  process.chdir(game.dir);

  if (flags.has("screenshot") || flags.has("compare")) {
    const library = findLibrary("headless");
    if (library === null) {
      console.error("rge preview: the headless librge was not found (npm run native:build:headless in this repository, or install @rge/native).");
      return 1;
    }
    process.env["RGE_NATIVE_LIB"] ??= library;
    const previews = await loadPreviews(game.dir);
    if (flags.has("screenshot")) {
      const written = writeScreenshots(game.dir, previews, story);
      console.log(`wrote ${written.length} screenshot${written.length === 1 ? "" : "s"} to ${relative(process.cwd(), join(game.dir, "stories", "screenshots")) || "."}`);
      return 0;
    }
    const out = resolve(typeof flags.get("out") === "string" ? (flags.get("out") as string) : mkdtempSync(join(tmpdir(), "rge-previews-")));
    const tolerance = Number(flags.get("tolerance") ?? 0);
    const differences = compareScreenshots(game.dir, previews, out, tolerance);
    if (differences.length === 0) {
      console.log(`${previews.stories.length} stories match their screenshots`);
      return 0;
    }
    for (const difference of differences) console.log(`${difference.kind.padEnd(8)} ${difference.id}: ${difference.detail}`);
    console.log(`The pictures as they are now are in ${out}. If the change is meant, store them with: rge preview --screenshot`);
    return 1;
  }

  process.setSourceMapsEnabled(true);
  const { failed } = await previewWithReload(createNodeBackend(), { gameDir: game.dir, ...(story !== undefined ? { story } : {}) });
  return failed ? 1 : 0;
}
