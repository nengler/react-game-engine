/**
 * `tse package --engine web`: the game as a folder of static files a browser plays: `index.html`, `game.js` (the game, the player
 * and `@tsengine/player-web` bundled together), `assets/`, and a web app manifest, so a phone can add it to its home screen and open it
 * full screen. Any static host serves it (GitHub Pages, `npx serve`); it cannot be opened as a file, since a page loads its assets over
 * HTTP.
 *
 * The page shows a "tap to play" screen first: browsers start sound only after a press, and a phone goes full screen (and turns to
 * landscape, where it can) only from one.
 */
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

import { build } from "esbuild";

import type { Game } from "./config.ts";

/** Every file under `dir`, as paths relative to `root` with forward slashes, sorted. */
export function listFiles(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listFiles(root, path));
    else out.push(relative(root, path).split("\\").join("/"));
  }
  return out.sort();
}

/** Where `@tsengine/player-web` is: the game's own copy first (so the bundle has one player and one runtime), else the CLI's. */
function playerWeb(game: Game): string {
  for (const from of [join(game.dir, "package.json"), import.meta.url]) {
    try {
      return createRequire(from).resolve("@tsengine/player-web");
    } catch {
      // Not installed there: try the next.
    }
  }
  throw new Error("@tsengine/player-web was not found: install it beside @tsengine/cli.");
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The page: a canvas filling the screen, the "tap to play" screen over it, and a note to turn a phone held upright. */
export function webPage(title: string, background: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="${escapeHtml(background)}">
<link rel="manifest" href="manifest.webmanifest">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${escapeHtml(background)}; overflow: hidden; }
  body { position: fixed; inset: 0; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #game { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; image-rendering: pixelated; }
  #start, #error { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; color: #f4f1e6; font: 600 18px system-ui, sans-serif; background: ${escapeHtml(background)}; text-align: center; padding: 24px; }
  #start button { font: inherit; color: inherit; background: #ffffff1f; border: 2px solid #f4f1e6; border-radius: 10px; padding: 14px 32px; }
  #start small { opacity: 0.7; font-weight: 400; font-size: 14px; }
  #turn { display: none; }
  @media (orientation: portrait) and (max-width: 700px) { #turn { display: block; } }
  #error { display: none; white-space: pre-wrap; font: 13px ui-monospace, monospace; text-align: left; }
</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="start"><button type="button">Tap to play</button><small>Loading…</small><small id="turn">Turn your phone sideways to play</small></div>
<div id="error"></div>
<script type="module" src="game.js"></script>
</body>
</html>
`;
}

/** The web app manifest: the home-screen app opens full screen, in landscape. */
export function webManifest(name: string, background: string): string {
  return `${JSON.stringify({ name, short_name: name, start_url: ".", display: "fullscreen", orientation: "landscape", background_color: background, theme_color: background }, null, 2)}\n`;
}

/** The bundle's entry: start the host with the asset list, wait for the first tap, then run the game's own entry file. */
function webEntry(hostPath: string, entryPath: string, files: readonly string[]): string {
  return `import { startWebHost } from ${JSON.stringify(hostPath)};

const canvas = document.getElementById("game");
const start = document.getElementById("start");
const error = document.getElementById("error");
const showError = (e) => {
  error.textContent = "The game stopped with an error:\\n\\n" + (e && e.stack ? e.stack : String(e));
  error.style.display = "flex";
};
try {
  await startWebHost({ canvas, files: ${JSON.stringify(files)}, onError: showError });
  const status = start.querySelector("small");
  status.textContent = "Sound is on once you tap.";
  await new Promise((resolve) => start.querySelector("button").addEventListener("click", resolve, { once: true }));
  // Full screen and landscape, where the browser allows them (a phone's does, from a tap).
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape");
  } catch {}
  start.remove();
  await import(${JSON.stringify(entryPath)});
} catch (e) {
  showError(e);
}
`;
}

/** Write the web build of `game` (its entry file `entry`) into `out`. */
export async function packageWeb(game: Game, entry: string, name: string, out: string, background: string): Promise<void> {
  const files = listFiles(game.dir, join(game.dir, "assets"));
  const entryFile = join(game.dir, `.tse-web-entry.mjs`);
  writeFileSync(entryFile, webEntry(playerWeb(game), `./${entry}`, files));
  try {
    await build({
      entryPoints: [entryFile],
      outfile: join(out, "game.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      mainFields: ["browser", "module", "main"],
      legalComments: "none",
      logLevel: "warning",
      sourcemap: "linked",
    });
  } finally {
    rmSync(entryFile, { force: true });
  }
  writeFileSync(join(out, "index.html"), webPage(name, background));
  writeFileSync(join(out, "manifest.webmanifest"), webManifest(name, background));
}
