/**
 * `rge preview`: a game's stories (see `stories` in @rge/player), in a window with hot reload, or as PNGs to compare with the
 * stored ones.
 *
 * Stories live in the game's `stories/` folder, one `<Component>.stories.ts` per component. The stored screenshots are
 * `stories/screenshots/<Component>/<Story>.png`; `rge preview --screenshot` writes them and `rge check` compares them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyInputFrame,
  DrawList,
  gameLook,
  KEY_INDEX,
  parseInputScript,
  RGE_IN_HEIGHT,
  RGE_IN_WIDTH,
  RGE_KEY_PRESSED,
  storiesIn,
  storyRoot,
  type Backend,
  type InputBindings,
  type InputFrame,
  type LoadedStory,
  type PlayerConfig,
} from "@rge/player";
import type { GameProps } from "@rge/runtime";
import type { Pixels } from "./backend.ts";
import { playWithReload, type DevOptions } from "./dev.ts";
import { decodePng, encodePng } from "./png.ts";
import { renderRun } from "./screenshot.ts";

/** Where a game keeps its stories, and the stored screenshots inside that. */
export const STORIES_FOLDER = "stories";
export const SCREENSHOTS_FOLDER = join(STORIES_FOLDER, "screenshots");

/** The game's stories files, `stories/**\/*.stories.ts`, sorted. */
export function storyFiles(gameDir: string): string[] {
  const dir = join(gameDir, STORIES_FOLDER);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".stories.ts") || file.endsWith(".stories.js"))
    .map((file) => join(dir, file))
    .sort();
}

/** What a game's `game.ts` exports that a preview uses: its root (for the look) and its bindings (for a story's input). */
interface GameModule {
  readonly gameConfig?: PlayerConfig;
  readonly bindings?: InputBindings;
}

export interface Previews {
  readonly stories: readonly LoadedStory[];
  /** The game's `<Game>` look: background, assets, font, text, controls. */
  readonly look: GameProps;
  readonly bindings: InputBindings | undefined;
}

/**
 * Import the game's stories and its `game.ts` (when it has one), and build its root once to read the look from. Throws on a
 * stories file whose default export is not `stories(…)`, and on two stories with the same id.
 */
export async function loadPreviews(gameDir: string): Promise<Previews> {
  const game = join(gameDir, "game.ts");
  const mod: GameModule = existsSync(game) ? ((await import(pathToFileURL(game).href)) as GameModule) : {};
  const look = mod.gameConfig === undefined ? {} : gameLook(mod.gameConfig.root());
  const stories: LoadedStory[] = [];
  const seen = new Map<string, string>();
  for (const file of storyFiles(gameDir)) {
    const name = relative(gameDir, file);
    for (const story of storiesIn((await import(pathToFileURL(file).href)) as Record<string, unknown>, name)) {
      const other = seen.get(story.id);
      if (other !== undefined) throw new Error(`${name}: the story ${story.id} is also in ${other}.`);
      seen.set(story.id, name);
      stories.push(story);
    }
  }
  return { stories, look, bindings: mod.bindings };
}

/** A story's input script as frames: its own, then one idle step so the layout settles. */
export function storyFrames(story: LoadedStory, bindings: InputBindings | undefined): InputFrame[] {
  const script = story.options.input;
  const frames = script === undefined ? [] : parseInputScript(script, bindings === undefined ? {} : { bindings });
  return [...frames, {}];
}

/** Render one story through the headless build: its size times its scale (4 by default). Run in the game's folder. */
export function renderStory(previews: Previews, story: LoadedStory, warnings?: string[]): Pixels {
  const frames = storyFrames(story, previews.bindings);
  const shots = renderRun({ root: () => storyRoot(story, previews.look) }, frames, { at: [frames.length - 1], ...(warnings ? { warnings } : {}) });
  const shot = shots[0];
  if (shot === undefined) throw new Error(`${story.id} drew nothing`);
  return shot.pixels;
}

/** The stored screenshot's path for a story, under the game's folder. */
export function screenshotPath(gameDir: string, story: Pick<LoadedStory, "component" | "name">): string {
  return join(gameDir, SCREENSHOTS_FOLDER, story.component, `${story.name}.png`);
}

/** Write a PNG of every story (or the one named) as the stored screenshot. Returns the files written. */
export function writeScreenshots(gameDir: string, previews: Previews, only?: string): string[] {
  const written: string[] = [];
  const chosen = previews.stories.filter((story) => only === undefined || story.id === only || story.component === only);
  if (chosen.length === 0) throw new Error(only === undefined ? "The game has no stories." : `No story or component called ${only}.`);
  if (only === undefined) rmSync(join(gameDir, SCREENSHOTS_FOLDER), { recursive: true, force: true }); // a removed story's picture goes too
  for (const story of chosen) {
    const path = screenshotPath(gameDir, story);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encodePng(renderStory(previews, story)));
    written.push(path);
  }
  return written;
}

export interface Difference {
  readonly id: string;
  /** `changed`: the picture differs; `new`: no stored picture; `gone`: a stored picture whose story is no more. */
  readonly kind: "changed" | "new" | "gone";
  /** For `changed`: how many pixels differ, or why the sizes differ. */
  readonly detail: string;
}

/**
 * How many pixels of two pictures differ by more than `tolerance` in a channel (0 to 255), or a description of how their sizes
 * differ.
 */
export function pixelDifference(a: Pixels, b: Pixels, tolerance = 0): number | string {
  if (a.width !== b.width || a.height !== b.height) return `${a.width} × ${a.height} now, ${b.width} × ${b.height} stored`;
  let count = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a.rgba[i + c] as number) - (b.rgba[i + c] as number)) > tolerance) {
        count++;
        break;
      }
    }
  }
  return count;
}

/**
 * Render every story and compare it with its stored screenshot. Writes the pictures that differ (and the new ones) to `out`,
 * as `<Component>/<Story>.png`, to look at. Returns what differs; empty when everything matches.
 */
export function compareScreenshots(gameDir: string, previews: Previews, out: string, tolerance = 0): Difference[] {
  const differences: Difference[] = [];
  const keep = (story: LoadedStory, pixels: Pixels): void => {
    const path = join(out, story.component, `${story.name}.png`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encodePng(pixels));
  };
  const ids = new Set<string>();
  for (const story of previews.stories) {
    ids.add(story.id);
    const pixels = renderStory(previews, story);
    const path = screenshotPath(gameDir, story);
    if (!existsSync(path)) {
      differences.push({ id: story.id, kind: "new", detail: "no stored screenshot" });
      keep(story, pixels);
      continue;
    }
    const diff = pixelDifference(pixels, decodePng(readFileSync(path)), tolerance);
    if (diff === 0) continue;
    differences.push({ id: story.id, kind: "changed", detail: typeof diff === "number" ? `${diff} pixels differ` : diff });
    keep(story, pixels);
  }
  const stored = join(gameDir, SCREENSHOTS_FOLDER);
  if (existsSync(stored)) {
    for (const file of readdirSync(stored, { recursive: true }).map(String)) {
      if (!file.endsWith(".png")) continue;
      const id = file.slice(0, -".png".length).split(/[\\/]/).join("/");
      if (!ids.has(id)) differences.push({ id, kind: "gone", detail: "a stored screenshot whose story is no more" });
    }
  }
  return differences;
}

const PREVIOUS = KEY_INDEX.get("F5") as number;
const NEXT = KEY_INDEX.get("F6") as number;

export interface PreviewOptions {
  /** The game's folder. */
  readonly gameDir: string;
  /** The story to show first, by id (`HealthBar/Hurt`) or component (`HealthBar`). Default the first. */
  readonly story?: string;
  readonly log?: (message: string) => void;
  /** Told when the preview has started, and after each reload or failed reload (a story switched counts). For tests. */
  readonly observe?: DevOptions["observe"];
}

/**
 * Show the game's stories in a window, one at a time, with hot reload: saving a component or a stories file compiles and
 * shows the change. F5 and F6 go to the previous and next story; the story's name is drawn along the window's bottom. A story's
 * input script is played when it is shown.
 */
export async function previewWithReload(backend: Backend, options: PreviewOptions): Promise<{ readonly failed: boolean }> {
  const gameDir = resolve(options.gameDir);
  const log = options.log ?? ((message: string) => console.log(message));
  let ids: string[] = [];
  let wanted = options.story;
  let current: LoadedStory | null = null;
  /** Input frames still to feed: the shown story's script. */
  let feed: InputFrame[] = [];
  let reload: (() => void) | null = null;
  const label = new DrawList();

  const load = async (): Promise<PlayerConfig> => {
    const previews = await loadPreviews(gameDir);
    if (previews.stories.length === 0) throw new Error(`${gameDir} has no stories: add a stories/<Component>.stories.ts (see the guide's "Previews").`);
    ids = previews.stories.map((story) => story.id);
    const story = previews.stories.find((s) => s.id === wanted) ?? previews.stories.find((s) => s.component === wanted) ?? (previews.stories[0] as LoadedStory);
    if (story.id !== current?.id) {
      feed = storyFrames(story, previews.bindings).slice(0, -1);
      log(`preview: ${story.id}  (${ids.indexOf(story.id) + 1} of ${ids.length}; F5 F6 switch)`);
    }
    current = story;
    wanted = story.id;
    return { root: () => storyRoot(story, previews.look, { width: 960, height: 540 }) };
  };

  const step = (by: number): void => {
    if (current === null || ids.length === 0 || reload === null) return;
    const at = ids.indexOf(current.id);
    wanted = ids[(at + by + ids.length) % ids.length];
    reload();
  };

  const wrapped: Backend = new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop === "frame") {
        const frame: Backend["frame"] = (clear, records, length, texts, values, keys) => {
          label.reset();
          label.appendFrom(records, 0, length, 0, false);
          label.texts.push(...texts);
          if (current !== null) {
            const text = `${current.id}   ${ids.indexOf(current.id) + 1} of ${ids.length}   F5 F6 story`;
            const W = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
            label.view({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
            label.rect({ ...W, x: 4, y: 4 }, text.length * 6 + 6, 12, 0x000000cc);
            label.text({ ...W, x: 7, y: 5 }, text, 10, 0xffffffff);
          }
          target.frame(clear, label.records, label.length, label.texts, values, keys);
          const pressed = (key: number): boolean => ((keys[key] as number) & RGE_KEY_PRESSED) !== 0;
          if (pressed(PREVIOUS)) step(-1);
          else if (pressed(NEXT)) step(1);
          const next = feed.shift();
          if (next !== undefined) applyInputFrame(next, values, keys, values[RGE_IN_WIDTH] as number, values[RGE_IN_HEIGHT] as number);
        };
        return frame;
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

  return playWithReload(wrapped, {
    entry: join(gameDir, "game.ts"),
    gameDir,
    load,
    rewind: false,
    inspector: false,
    log,
    watch: ["src", "scenes", STORIES_FOLDER],
    ...(options.observe !== undefined ? { observe: options.observe } : {}),
    onReady: (handle) => {
      reload = handle.reload;
    },
  });
}
