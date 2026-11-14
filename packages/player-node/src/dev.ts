/**
 * Play a game under Node with hot reload: edit a component, save, and it changes in the open window, keeping its state.
 *
 * The launcher (`play.ts`) drives the frame loop itself, between turns of Node's event loop, so it can watch files while the
 * game runs. When a file under the game's `src/` (or `scenes/`) changes it:
 *
 * 1. compiles the game again (`rge-compile src generated`, with `--scenes` and `--assets` as the check command uses them), in
 *    a child process, while the game keeps running; a compile error is shown in the window;
 * 2. imports the entry file again. A module hook gives every file inside the game's folder (not its `node_modules`) a new
 *    version in its URL, so the whole game, its rules and its game state are evaluated afresh, and the engine's packages are
 *    not: one runtime, one window;
 * 3. carries each game state (`createGameState`) over to its new build, matched by file and export name
 *    (`GameStore.carryFrom`), so the new components are built against the old values;
 * 4. puts the new root in place of the old one (`Player.reload`), which gives each component the `useMutable` fields and refs
 *    of the component it replaces, by its place in the tree.
 *
 * What is not kept: a built-in's own state (an animation's frame, a camera's slide, particles in flight), and module-level
 * variables in the game's plain `.ts` files. Images and sounds are loaded once per path, so a changed image file needs a
 * restart. Each build stays in memory (ES modules cannot be unloaded), which is fine for a session of edits.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPlayer, HOST_BACKEND_KEY, HOST_RUN_KEY, Rewind, type Backend, type Player, type PlayerConfig } from "@rge/player";
import { GameStore } from "@rge/runtime";
import { startInspector, type Inspector } from "./inspector.ts";

export interface DevOptions {
  /** The game's entry file, which calls `run(hostBackend(), config)`. */
  readonly entry: string;
  /**
   * Make the config another way than by importing `entry` (`rge preview` builds a story): called on start and after each
   * compile, with the game's files given a new version, as an import of the entry would be.
   */
  readonly load?: () => Promise<PlayerConfig>;
  /** Called once the game runs, with a way to load the game again without compiling (`rge preview` switching stories). */
  readonly onReady?: (handle: { readonly reload: () => void }) => void;
  /** The folders whose changes reload the game, in the game's folder. Default `src` and `scenes`. */
  readonly watch?: readonly string[];
  /** The game's folder: `src/`, `generated/`, and optionally `scenes/` and `assets/`. Default: the entry's folder. */
  readonly gameDir?: string;
  /** Recompile before the first load too, so the game never starts from stale generated code. Default true. */
  readonly compileFirst?: boolean;
  /** Where messages go. Default the console. */
  readonly log?: (message: string) => void;
  /**
   * The development inspector's page (the tree, the selected component's state, the game state): the port to serve it on
   * (0, the default, takes a free one), or false for none. Its address is printed when the game starts.
   */
  readonly inspector?: number | false;
  /** Rewind (F2 pauses, the arrows step, F4 saves the moment to `moments/`). Default on. */
  readonly rewind?: boolean;
  /** Told when the game has started, after each reload that worked, and when a reload failed. For tests. */
  readonly observe?: (event: "start" | "reload" | "error", player: Player) => void;
}

const NOTE = "Save a file to reload. Close the window to quit.";

/** The `rge` field of a game's package.json: where its folders are, and whether a missing asset is an error. */
export interface GameSettings {
  readonly name?: string;
  readonly entry?: string;
  readonly src?: string;
  readonly generated?: string;
  readonly scenes?: string;
  readonly assets?: string;
  readonly checkAssets?: boolean;
}

export function readGameSettings(gameDir: string): GameSettings {
  try {
    return (JSON.parse(readFileSync(join(gameDir, "package.json"), "utf8")) as { rge?: GameSettings }).rge ?? {};
  } catch {
    return {}; // No package.json: the defaults.
  }
}

/** The compiler's command-line script: `cli.ts` in the workspace, `cli.js` in an installed pack. */
export function compilerCli(): string {
  const dir = dirname(fileURLToPath(import.meta.resolve("@rge/compiler")));
  return [join(dir, "cli.ts"), join(dir, "cli.js")].find((path) => existsSync(path)) ?? join(dir, "cli.js");
}

/**
 * The command line that compiles the game in `gameDir`, as `rge check` does. It writes a source map beside each generated file, so
 * a Node run with `--enable-source-maps` names the component's own line in an error (`src/Play.tsx:20:3`), not the generated one.
 */
export function compileArgs(gameDir: string): string[] {
  const settings = readGameSettings(gameDir);
  const args = [compilerCli(), settings.src ?? "src", settings.generated ?? "generated", "--source-maps"];
  const scenes = settings.scenes ?? "scenes";
  if (existsSync(join(gameDir, scenes))) args.push("--scenes", scenes);
  const assets = settings.assets ?? "assets";
  if (existsSync(join(gameDir, assets)) && settings.checkAssets !== false) args.push("--assets", assets);
  return args;
}

/** Compile the game; resolves with whether it compiled and what the compiler printed. */
function compileGame(gameDir: string): Promise<{ readonly ok: boolean; readonly output: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, compileArgs(gameDir), { cwd: gameDir, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (error) => done({ ok: false, output: String(error) }));
    child.on("close", (code) => done({ ok: code === 0, output }));
  });
}

/**
 * The compiler's errors, without its progress lines (`wrote Main.ts`, `checked scene …`), for the window. Falls back to the
 * whole output if nothing looks like an error.
 */
export function compileErrors(output: string): string {
  const lines = output.split("\n").filter((line) => line.trim() !== "");
  const progress = /^(wrote|read|imported|checked|compiled|type-checked)\b/;
  const errors = lines.filter((line) => !progress.test(line));
  return (errors.length > 0 ? errors : lines).join("\n");
}

/** Every game state a module exports, by `file#export`. */
function storesOf(file: string, namespace: Record<string, unknown>, into: Map<string, GameStore<unknown>>): void {
  for (const [name, value] of Object.entries(namespace)) {
    const store = (value as { store?: unknown } | null)?.store;
    if ((typeof value === "function" || typeof value === "object") && store instanceof GameStore) into.set(`${file}#${name}`, store as GameStore<unknown>);
  }
}

/**
 * Run the game at `options.entry` in a window, reloading it when its source changes. Resolves when the window is closed, with
 * the error the game was showing then, if any.
 */
export async function playWithReload(backend: Backend, options: DevOptions): Promise<{ readonly failed: boolean }> {
  const log = options.log ?? ((message: string) => console.log(message));
  const entry = resolve(options.entry);
  const gameDir = resolve(options.gameDir ?? dirname(entry));
  const gamePrefix = pathToFileURL(gameDir).href + "/";

  // Each load is a version; every game file imported during it gets that version in its URL, and is listed.
  let version = 0;
  const loaded = new Set<string>();
  const inGame = (url: string): boolean => url.startsWith(gamePrefix) && !url.includes("/node_modules/");
  registerHooks({
    resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (!inGame(result.url)) return result;
      const url = new URL(result.url);
      url.search = `?v=${version}`;
      loaded.add(url.href);
      return { ...result, url: url.href };
    },
  });

  // The entry calls `run(hostBackend(), config)`, which hands its config here instead of looping (see `HOST_RUN_KEY`).
  let handed: PlayerConfig | null = null;
  (globalThis as Record<string, unknown>)[HOST_BACKEND_KEY] = backend;
  (globalThis as Record<string, unknown>)[HOST_RUN_KEY] = (_backend: Backend, config: PlayerConfig) => {
    handed = config;
  };

  /** Import the entry again. Resolves with its config and the game states it made, or throws what the import threw. */
  const importGame = async (): Promise<{ config: PlayerConfig; stores: Map<string, GameStore<unknown>> }> => {
    version++;
    loaded.clear();
    handed = null;
    if (options.load !== undefined) handed = await options.load();
    else await import(`${pathToFileURL(entry).href}?v=${version}`);
    const config = handed as PlayerConfig | null;
    if (config === null) throw new Error(`${options.entry} did not call run(hostBackend(), config).`);
    const stores = new Map<string, GameStore<unknown>>();
    for (const url of loaded) {
      const file = url.slice(0, url.indexOf("?"));
      storesOf(file, (await import(url)) as Record<string, unknown>, stores);
    }
    return { config, stores };
  };

  if (options.compileFirst ?? true) {
    const first = await compileGame(gameDir);
    if (!first.ok) {
      if (!existsSync(join(gameDir, "generated"))) throw new Error(`The game does not compile:\n${compileErrors(first.output)}`);
      log(`The game does not compile; starting from the last build.\n${compileErrors(first.output)}`);
    }
  }

  const start = await importGame();
  let stores = start.stores;
  // Development tools: the layout overlay (F1) in the window, rewind (F2), and the inspector's page in a browser.
  let config: PlayerConfig = { ...start.config, showErrors: true, errorNote: NOTE, devtools: true };
  const rewind =
    options.rewind === false
      ? null
      : new Rewind(backend, {
          config: () => config,
          stores: () => stores,
          log,
          saveMoment: (moment) => {
            const folder = join(gameDir, "moments");
            mkdirSync(folder, { recursive: true });
            const file = join(folder, `frame-${moment.frame}-${Date.now()}.json`);
            writeFileSync(file, `${JSON.stringify(moment)}\n`);
            log(`rewind: wrote ${file}: replay it in a test with replayMoment (see the guide's "Rewind")`);
          },
        });
  const player: Player = createPlayer(rewind?.backend ?? backend, config);
  rewind?.attach(player);
  let inspector: Inspector | null = null;
  if (options.inspector !== false) {
    try {
      inspector = await startInspector({ root: () => player.world.root.children[0] ?? null, stores: () => stores, port: options.inspector ?? 0, log, rewind });
      log(`inspector: ${inspector.url}  (F1 in the window outlines the layout${rewind !== null ? ", F2 pauses to rewind" : ""})`);
    } catch (error) {
      log(`The inspector could not start: ${String(error)}`);
    }
  }

  // Watch the sources; a burst of saves is one reload, and a save during a reload starts another after it.
  let closed = false;
  let changed = false;
  let busy = false;
  /** Set by `onReady`'s `reload`: load again without compiling first. */
  let skipCompile = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers: FSWatcher[] = [];
  const onChange = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      changed = true;
      skipCompile = false; // a saved file is compiled, even when a reload without compiling was asked for too
      void reloadIfChanged();
    }, 80);
  };
  for (const folder of options.watch ?? ["src", "scenes"]) {
    const path = join(gameDir, folder);
    if (existsSync(path)) watchers.push(watch(path, { recursive: true }, onChange));
  }

  const reloadIfChanged = async (): Promise<void> => {
    if (busy || !changed || closed) return;
    busy = true;
    changed = false;
    const compile = !skipCompile;
    skipCompile = false;
    try {
      const started = Date.now();
      const compiled = compile ? await compileGame(gameDir) : { ok: true, output: "" };
      if (closed) return;
      if (!compiled.ok) {
        const errors = compileErrors(compiled.output);
        log(errors);
        player.showError(errors, NOTE);
        options.observe?.("error", player);
        return;
      }
      let next: Awaited<ReturnType<typeof importGame>>;
      try {
        next = await importGame();
      } catch (error) {
        console.error(error);
        player.showError(error, NOTE);
        options.observe?.("error", player);
        return;
      }
      if (closed) return;
      // Synchronous from here: no frame runs between taking the old values and building the new tree from them.
      for (const [key, store] of next.stores) {
        const older = stores.get(key);
        if (older !== undefined && older !== store) store.carryFrom(older);
      }
      stores = next.stores;
      config = { ...next.config, showErrors: true, errorNote: NOTE, devtools: true };
      if (player.reload(config)) {
        rewind?.reloaded();
        log(`reloaded in ${Date.now() - started} ms`);
        options.observe?.("reload", player);
      } else {
        console.error(player.failure?.error);
        options.observe?.("error", player);
      }
    } finally {
      busy = false;
      if (changed) void reloadIfChanged();
    }
  };

  // The frame loop: one frame per turn of the event loop, so file events and the compiler's output are heard between frames.
  let printed: unknown = null;
  options.observe?.("start", player);
  options.onReady?.({
    reload: () => {
      skipCompile = true;
      changed = true;
      void reloadIfChanged();
    },
  });
  try {
    for (;;) {
      const open = rewind !== null ? rewind.step() : player.step();
      const failure = player.failure;
      if (failure !== null && failure.error !== printed && !(typeof failure.error === "string")) {
        printed = failure.error;
        console.error(failure.error);
      }
      if (!open) break;
      inspector?.update();
      await new Promise<void>((next) => setImmediate(next));
    }
  } finally {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    await inspector?.close();
    player.close();
    delete (globalThis as Record<string, unknown>)[HOST_RUN_KEY];
  }
  return { failed: player.failure !== null };
}
