/**
 * The game behind `tse session` and `tse mcp`: one headless `Session` of a game's folder, driven by requests (`{ "cmd": "input",
 * "script": "right*30" }`) and answering with plain data. It loads the game's `game.ts` (its `gameConfig`, `bindings` and `screen`),
 * names the game states by their export names, and can compile and load the game again (`reload`) and play the same input with
 * the new code.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Session, type InputBindings, type PlayerConfig, type ScriptOptions, type Until } from "@tsengine/player";
import { compileArgs, readGameSettings } from "@tsengine/player-node";
import { GameStore, type DescribeOptions } from "@tsengine/runtime";

import { findLibrary } from "./native.ts";
import { node } from "./run.ts";

/** One request: a command and its arguments. `id` is echoed in the answer. */
export interface SessionRequest {
  readonly id?: unknown;
  readonly cmd: string;
  readonly [arg: string]: unknown;
}

/** One answer: `ok`, the frame the game is at after the request, what the command returned, and the game's new warnings. */
export type SessionResponse = { readonly ok: boolean; readonly frame: number; readonly id?: unknown; readonly error?: string } & Record<
  string,
  unknown
>;

/** Every command, with what it takes: what `help` prints, and what `tse mcp` turns into tools. */
export const COMMANDS: Readonly<Record<string, { readonly args: string; readonly does: string }>> = {
  info: { args: "", does: "the game's name, window, input action names, frame, snapshots and these commands" },
  input: {
    args: "script",
    does: "play an input script, one step a frame: `right*30, jump, right*20+dash, _*10, click@120,64` (names are actions or key names; `_` waits)",
  },
  step: {
    args: "count?, until?, maxSteps?",
    does: "run steps with nothing pressed: `count` (default 1), or until `until` holds ({text}, {gone}, {component, path?, equals|not|above|below, absent?}, {path, …} on the game state), at most `maxSteps` (default 3600)",
  },
  type: { args: "text", does: "type characters into a text input (2 steps)" },
  observe: {
    args: "only?, depth?, maxNodes?, format?",
    does: 'the scene as indented text (or `format: "json"`): each object\'s name, world position, texts, colliders, props and state; plus the game state. `only: "components"` lists only components and texts',
  },
  state: { args: "query?", does: "the game state; with `query` (a component's name), every such component's position and state" },
  texts: { args: "", does: "the words of every <Text> on screen, in tree order" },
  snapshot: { args: "name", does: "keep the game as it is now under a name" },
  restore: { args: "name", does: "go back to a snapshot (fast; a built-in's own state, timers and particles start afresh)" },
  replay: { args: "", does: "start again and play this run's input from the start (exact)" },
  reset: { args: "", does: "start the game again from nothing" },
  reload: { args: "", does: "compile the game, load the new code, and play this run's input again with it" },
  hash: { args: "", does: "a number for the game's state now: equal states hash equal (check that two ways to a moment agree)" },
  screenshot: {
    args: "out?, scale?",
    does: "draw the game as it is now to a PNG (replays the run's input through the headless renderer) and return its path",
  },
  help: { args: "", does: "these commands" },
};

/** A recursive list of the `.ts` files in `dir` (not `.tsx`, not `.d.ts`). */
function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .map((file) => join(dir, file));
}

export interface SessionServerOptions {
  /** Compile `src` to `generated` before loading the game. Default true. */
  readonly build?: boolean;
}

export class SessionServer {
  readonly gameDir: string;
  readonly name: string;
  #version = 0;
  #session: Session | null = null;

  private constructor(gameDir: string) {
    this.gameDir = gameDir;
    const pkg = join(gameDir, "package.json");
    const settings = readGameSettings(gameDir);
    this.name = settings.name ?? (existsSync(pkg) ? ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name ?? "game") : "game");
  }

  /** Load the game in `folder` and start it. Throws, with the compiler's errors, when it does not build. */
  static async open(folder: string, options: SessionServerOptions = {}): Promise<SessionServer> {
    const gameDir = resolve(folder);
    if (!existsSync(join(gameDir, "game.ts")))
      throw new RequestError(`${gameDir} has no game.ts (the file that exports gameConfig, and bindings for input scripts).`);
    const server = new SessionServer(gameDir);
    // Every file of the game gets the load's version in its URL, so `reload` evaluates the new code (as `tse dev` does).
    const prefix = pathToFileURL(gameDir).href + "/";
    registerHooks({
      resolve(specifier, context, next) {
        const result = next(specifier, context);
        if (!result.url.startsWith(prefix) || result.url.includes("/node_modules/")) return result;
        const url = new URL(result.url);
        url.search = `?v=${server.#version}`;
        return { ...result, url: url.href };
      },
    });
    process.chdir(gameDir); // the game's assets/ resolve as when it is played
    if (options.build ?? true) server.#compile();
    await server.#load();
    return server;
  }

  get session(): Session {
    if (this.#session === null) throw new RequestError("The game is not loaded.");
    return this.#session;
  }

  #compile(): void {
    const r = node(compileArgs(this.gameDir), this.gameDir);
    if (!r.ok) {
      const errors = r.output
        .split("\n")
        .filter((line) => !/^(wrote|read|imported|checked|compiled|type-checked)\b/.test(line))
        .join("\n")
        .trim();
      throw new RequestError(`The game did not compile:\n${errors}`);
    }
  }

  /** Import the game (a new version of every file in its folder) and start a session of it. */
  async #load(): Promise<void> {
    this.#version++;
    const mod = (await import(pathToFileURL(join(this.gameDir, "game.ts")).href)) as {
      gameConfig?: PlayerConfig;
      bindings?: InputBindings;
      screen?: ScriptOptions["screen"];
    };
    if (mod.gameConfig === undefined) throw new RequestError("game.ts does not export gameConfig.");
    // The game states, by export name: in the .ts files of src that make one.
    const storeNames = new Map<GameStore<unknown>, string>();
    const src = join(this.gameDir, readGameSettings(this.gameDir).src ?? "src");
    for (const file of tsFiles(src)) {
      if (!readFileSync(file, "utf8").includes("createGameState")) continue;
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(exports)) {
        const store = (value as { store?: unknown } | null)?.store;
        if ((typeof value === "function" || typeof value === "object") && store instanceof GameStore) storeNames.set(store, name);
      }
    }
    this.#session?.close();
    this.#session = new Session(mod.gameConfig, {
      ...(mod.bindings ? { bindings: mod.bindings } : {}),
      ...(mod.screen ? { screen: mod.screen } : {}),
      storeNames,
    });
  }

  /** What `info` and the first line of `tse session` say. */
  info(): Record<string, unknown> {
    const session = this.session;
    return {
      game: this.name,
      folder: this.gameDir,
      window: session.window,
      actions: session.actions,
      gameStates: Object.keys(session.gameState()),
      snapshots: session.snapshots(),
      commands: Object.keys(COMMANDS),
    };
  }

  /** Answer one request. Never throws: a failure is `{ ok: false, error }`. */
  async handle(request: SessionRequest): Promise<SessionResponse> {
    const id = request.id === undefined ? {} : { id: request.id };
    try {
      const result = await this.#run(request);
      const session = this.session;
      const warnings = session.takeWarnings();
      return { ...id, ok: true, frame: session.frame, ...result, ...(warnings.length > 0 ? { warnings } : {}) };
    } catch (error) {
      const frame = this.#session?.frame ?? 0;
      const warnings = this.#session?.takeWarnings() ?? [];
      return { ...id, ok: false, frame, error: describeError(error, this.gameDir), ...(warnings.length > 0 ? { warnings } : {}) };
    }
  }

  async #run(request: SessionRequest): Promise<Record<string, unknown>> {
    const session = this.session;
    const text = (name: string): string => {
      const value = request[name];
      if (typeof value !== "string" || value === "")
        throw new RequestError(`${request.cmd} needs "${name}" (${COMMANDS[request.cmd]?.args}).`);
      return value;
    };
    const number = (name: string): number | undefined => {
      const value = request[name];
      if (value === undefined) return undefined;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new RequestError(`"${name}" must be a number.`);
      return value;
    };
    switch (request.cmd) {
      case "info":
        return this.info();
      case "help":
        return { commands: COMMANDS };
      case "input":
        return { steps: session.input(text("script")) };
      case "step": {
        const until = request["until"];
        if (until !== undefined && (typeof until !== "object" || until === null)) throw new RequestError('"until" must be an object.');
        const count = number("count");
        const maxSteps = number("maxSteps");
        const result = session.step({
          ...(count !== undefined ? { count } : {}),
          ...(maxSteps !== undefined ? { maxSteps } : {}),
          ...(until !== undefined ? { until: until as Until } : {}),
        });
        return { ...result };
      }
      case "type":
        return { steps: session.type(text("text")) };
      case "observe": {
        const only = request["only"];
        if (only !== undefined && only !== "all" && only !== "components") throw new RequestError('"only" is "all" or "components".');
        const depth = number("depth");
        const maxNodes = number("maxNodes");
        const options: DescribeOptions = {
          ...(only !== undefined ? { only } : {}),
          ...(depth !== undefined ? { depth } : {}),
          ...(maxNodes !== undefined ? { maxNodes } : {}),
        };
        const scene = request["format"] === "json" ? session.scene(options) : session.sceneText(options);
        return { scene, gameState: session.gameState() };
      }
      case "state":
      case "find": {
        const query = request["query"];
        if (query === undefined) return { gameState: session.gameState() };
        if (typeof query !== "string") throw new RequestError('"query" is a component\'s name.');
        return { matches: session.find(query) };
      }
      case "texts":
        return { texts: session.texts() };
      case "snapshot":
        session.snapshot(text("name"));
        return { snapshots: session.snapshots() };
      case "restore":
        session.restore(text("name"));
        return {};
      case "snapshots":
        return { snapshots: session.snapshots() };
      case "replay":
        return { steps: session.replay() };
      case "reset":
        session.reset();
        return {};
      case "reload": {
        const history = [...session.history];
        this.#compile();
        await this.#load();
        this.session.play(history);
        return { steps: history.length };
      }
      case "hash":
        return { hash: session.hash() };
      case "screenshot":
        return this.#screenshot(request);
      default:
        throw new RequestError(`Unknown command '${request.cmd}'. The commands: ${Object.keys(COMMANDS).join(", ")}.`);
    }
  }

  /** Draw the game as it is now: its run's input played again through the headless renderer, in a process of its own. */
  #screenshot(request: SessionRequest): Record<string, unknown> {
    const session = this.session;
    const library = findLibrary("headless");
    if (library === null)
      throw new RequestError(
        "screenshot needs the headless libtse (in this repository `npm run native:build:headless`; a game gets it from @tsengine/native)."
      );
    const history = session.history.length > 0 ? session.history : [{}];
    const work = mkdtempSync(join(tmpdir(), "tse-session-"));
    try {
      const framesFile = join(work, "frames.json");
      writeFileSync(framesFile, JSON.stringify(history));
      const out = typeof request["out"] === "string" ? resolve(request["out"]) : resolve("shots");
      const target = out.endsWith(".png") ? out : join(out, `frame-${session.frame}.png`);
      const shotsDir = join(work, "shots");
      mkdirSync(shotsDir);
      const scale = typeof request["scale"] === "number" ? String(request["scale"]) : "1";
      const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
      const r = spawnSync(
        process.execPath,
        [
          cli,
          "screenshot",
          this.gameDir,
          "--frames-file",
          framesFile,
          "--at",
          String(history.length - 1),
          "--out",
          shotsDir,
          "--scale",
          scale,
        ],
        { cwd: this.gameDir, encoding: "utf8", env: { ...process.env, TSE_NATIVE_LIB: library } }
      );
      if (r.status !== 0) throw new RequestError(`screenshot failed:\n${`${r.stdout}${r.stderr}`.trim()}`);
      mkdirSync(resolve(target, ".."), { recursive: true });
      writeFileSync(target, readFileSync(join(shotsDir, `step-${history.length - 1}.png`)));
      return { path: target };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  close(): void {
    this.#session?.close();
  }
}

/** A request that cannot be run as written: its message is the whole answer, with no stack. */
export class RequestError extends Error {}

/**
 * An error as one string: its message, and where it was thrown. A request's own mistake (`RequestError`) is its message alone; an
 * error from the game names the first lines of the stack in the game's folder (with source maps, its `src/` files). An error with
 * no line in the game's folder (a missing snapshot) is its message alone.
 */
export function describeError(error: unknown, gameDir?: string): string {
  if (!(error instanceof Error)) return String(error);
  if (error instanceof RequestError) return error.message;
  const frames = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") && !line.includes("node:"));
  // Without a game folder (or with no frame in it), the engine's own frames, briefly: they are rarely what to fix.
  const own = gameDir === undefined ? frames : frames.filter((line) => line.includes(gameDir) && !line.includes("/node_modules/"));
  const shown = own.slice(0, 5);
  return shown.length > 0 ? `${error.message}\n${shown.join("\n")}` : error.message;
}

/** The argument a command takes when it is written as a line of text (`input right*30`, `step 60`, `snapshot boss`). */
const MAIN_ARG: Readonly<Record<string, string>> = {
  input: "script",
  type: "text",
  step: "count",
  observe: "only",
  state: "query",
  find: "query",
  snapshot: "name",
  restore: "name",
  screenshot: "out",
};

/**
 * One line of input as a request: a JSON object, or a command and its one argument as words (`input right*30, jump`,
 * `step 60`, `observe components`). Null for a blank line or a comment (`#`).
 */
export function parseRequestLine(line: string): SessionRequest | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as { cmd?: unknown }).cmd !== "string")
      throw new RequestError('A request is a JSON object with a "cmd", or a command and its argument as words.');
    return parsed as SessionRequest;
  }
  const space = trimmed.search(/\s/);
  const cmd = space === -1 ? trimmed : trimmed.slice(0, space);
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const arg = MAIN_ARG[cmd];
  if (rest === "" || arg === undefined) return { cmd };
  return { cmd, [arg]: arg === "count" && /^\d+$/.test(rest) ? Number(rest) : rest };
}
