/**
 * The game behind `tse session` and `tse mcp`: one headless `Session` of a game's folder, driven by requests (`{ "cmd": "input",
 * "script": "right*30" }`) and answering with plain data. It loads the game's `game.ts` (its `gameConfig`, `bindings` and `screen`),
 * names the game states by their export names, and can compile and load the game again (`reload`) and play the same input with
 * the new code.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  packFrames,
  Session,
  type InputBindings,
  type InputFrame,
  type PlayerConfig,
  type ScriptOptions,
  type Until,
} from "@tsengine/player";
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
  press: {
    args: "query",
    does: "click something by name as a player would (2 steps): `Pad[key=7]`, `MenuButton`, `StartButton`; the mouse goes to its middle as last frame drew it",
  },
  observe: {
    args: "only?, depth?, maxNodes?, format?",
    does: 'the scene as indented text (or `format: "json"`): each object\'s name, world position, texts, colliders, props and state; the part of the world on screen (`view`); and the game state. `only: "components"` lists only components and texts',
  },
  state: { args: "query?", does: "the game state; with `query` (a component's name), every such component's position and state" },
  map: {
    args: "around?, region?, maxColumns?",
    does: "the level as text: its tilemaps one character a tile (# solid, other tiles by symbol, with a legend) and the game's things marked by letter with their positions; around a component (default: what the camera follows), or a region {x, y, width, height} in pixels",
  },
  texts: { args: "", does: "the words of every <Text> on screen, in tree order" },
  watch: {
    args: "path",
    does: "follow a value: every answer then lists its changes with their frames. A component's state (`Play.s.lives`, `Pad[key=7].st.hovered`) or the game state's (`useGame.wave`)",
  },
  unwatch: { args: "path", does: "stop following a value" },
  snapshot: { args: "name", does: "keep the game as it is now under a name" },
  restore: { args: "name", does: "go back to a snapshot (fast; a built-in's own state, timers and particles start afresh)" },
  replay: { args: "", does: "start again and play this run's input from the start (exact)" },
  reset: { args: "", does: "start the game again from nothing" },
  reload: {
    args: "",
    does: "compile the game, load the new code, and play this run's input again with it; snapshots are kept, and a restore plays their input with the new code",
  },
  "save-test": {
    args: "name, path?",
    does: "write this run as a test (default test/session-<name>.test.ts): its input played again must end with the same game state, watched values and texts; the test is run once to check it passes",
  },
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
  /** The game states the session names, by export name, with the file that exports each: what a saved test imports. */
  #storeFiles: [string, string][] = [];
  /** The renderer of `screenshot`, and the input it has played. */
  #renderer: RenderClient | null = null;
  #rendered: InputFrame[] = [];
  /** Whether game.ts exports `bindings`. */
  #hasBindings = false;

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
    const storeFiles: [string, string][] = [];
    const src = join(this.gameDir, readGameSettings(this.gameDir).src ?? "src");
    for (const file of tsFiles(src)) {
      if (!readFileSync(file, "utf8").includes("createGameState")) continue;
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(exports)) {
        const store = (value as { store?: unknown } | null)?.store;
        if ((typeof value === "function" || typeof value === "object") && store instanceof GameStore) {
          storeNames.set(store, name);
          storeFiles.push([name, file]);
        }
      }
    }
    this.#storeFiles = storeFiles;
    this.#hasBindings = mod.bindings !== undefined;
    this.#session?.close();
    // The renderer runs the code it loaded: a new build needs a new one.
    this.#renderer?.close();
    this.#renderer = null;
    this.#rendered = [];
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
      const log = session.takeLog();
      return { ...id, ok: true, frame: session.frame, ...result, ...log, ...(warnings.length > 0 ? { warnings } : {}) };
    } catch (error) {
      const frame = this.#session?.frame ?? 0;
      const warnings = this.#session?.takeWarnings() ?? [];
      const log = this.#session?.takeLog() ?? null;
      return {
        ...id,
        ok: false,
        frame,
        error: describeError(error, this.gameDir),
        ...log,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
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
      case "press":
        return { at: session.press(text("query")) };
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
        return { scene, view: session.view(), gameState: session.gameState() };
      }
      case "state":
      case "find": {
        const query = request["query"];
        if (query === undefined) return { gameState: session.gameState() };
        if (typeof query !== "string") throw new RequestError('"query" is a component\'s name.');
        return { matches: session.find(query) };
      }
      case "map": {
        const around = request["around"];
        if (around !== undefined && typeof around !== "string") throw new RequestError('"around" is a component\'s name.');
        const region = request["region"];
        if (
          region !== undefined &&
          !(
            typeof region === "object" &&
            region !== null &&
            ["x", "y", "width", "height"].every((k) => typeof (region as Record<string, unknown>)[k] === "number")
          )
        )
          throw new RequestError('"region" is {x, y, width, height}, in pixels.');
        const maxColumns = number("maxColumns");
        return {
          map: session.map({
            ...(around !== undefined ? { around } : {}),
            ...(region !== undefined ? { region: region as { x: number; y: number; width: number; height: number } } : {}),
            ...(maxColumns !== undefined ? { maxColumns } : {}),
          }),
        };
      }
      case "texts":
        return { texts: session.texts() };
      case "watch":
        return { value: session.watch(text("path")), watching: session.watching };
      case "unwatch":
        session.unwatch(text("path"));
        return { watching: session.watching };
      case "snapshot":
        session.snapshot(text("name"));
        return { snapshots: session.snapshots() };
      case "restore":
        session.restore(text("name"));
        return {};
      case "snapshots":
        return { snapshots: session.snapshots() };
      case "replay": {
        const steps = session.replay();
        session.takeLog(); // what a replay plays again happened before
        return { steps };
      }
      case "reset":
        session.reset();
        return {};
      case "reload": {
        const history = [...session.history];
        const snapshots = session.snapshotInputs();
        this.#compile();
        await this.#load();
        this.session.adoptSnapshots(snapshots);
        this.session.play(history);
        this.session.takeLog();
        return { steps: history.length };
      }
      case "save-test":
        return this.#saveTest(request);
      case "hash":
        return { hash: session.hash() };
      case "screenshot":
        return await this.#screenshot(request);
      default:
        throw new RequestError(`Unknown command '${request.cmd}'. The commands: ${Object.keys(COMMANDS).join(", ")}.`);
    }
  }

  /**
   * Write this run as a test: its input, played again from the start, must end with the same game state, the same values of what is
   * watched and the same texts on screen. The test is run once to check it passes (a run that does not repeat fails here).
   */
  #saveTest(request: SessionRequest): Record<string, unknown> {
    const session = this.session;
    const name = request["name"];
    if (typeof name !== "string" || name.trim() === "") throw new RequestError('save-test needs "name": what the test checks, in words.');
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "session";
    const path =
      typeof request["path"] === "string" ? resolve(this.gameDir, request["path"]) : join(this.gameDir, "test", `session-${slug}.test.ts`);
    const from = (file: string): string => {
      const rel = relative(dirname(path), file).split(sep).join("/");
      return rel.startsWith(".") ? rel : `./${rel}`;
    };
    const watched = session.watching.map((p) => [p, session.valueOf(p)] as const);
    const imports = this.#storeFiles.map(([store, file]) => `import { ${store} } from "${from(file)}";`);
    const storeNames = this.#storeFiles.map(([store]) => `[${store}.store, "${store}"]`).join(", ");
    const options = [...(this.#hasBindings ? ["bindings"] : []), ...(storeNames === "" ? [] : [`storeNames: new Map([${storeNames}])`])];
    const packed = packFrames(session.history);
    const lines = [
      `/** Written by \`tse session\` (save-test) at frame ${session.frame}: the run's input, played again from the start, must end as it did. */`,
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      "",
      'import { Session, unpackFrames } from "@tsengine/player";',
      "",
      `import { ${this.#hasBindings ? "bindings, " : ""}gameConfig } from "${from(join(this.gameDir, "game.ts"))}";`,
      ...imports,
      "",
      `const frames = unpackFrames([\n${packed.map((f) => `  ${JSON.stringify(f)},`).join("\n")}\n] as const);`,
      "",
      "/** A value as plain data, as it was written here: what a class instance holds, without its class. */",
      "const data = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null)) as unknown;",
      "",
      `test(${JSON.stringify(name)}, () => {`,
      `  const session = new Session(gameConfig${options.length > 0 ? `, { ${options.join(", ")} }` : ""});`,
      "  try {",
      "    session.play(frames);",
      `    assert.equal(session.frame, ${session.frame});`,
      `    assert.deepEqual(data(session.gameState()), ${JSON.stringify(session.gameState())});`,
      ...watched.map(([p, v]) => `    assert.deepEqual(data(session.valueOf(${JSON.stringify(p)})), ${JSON.stringify(v ?? null)});`),
      `    assert.deepEqual(session.texts(), ${JSON.stringify(session.texts())});`,
      "  } finally {",
      "    session.close();",
      "  }",
      "});",
      "",
    ];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, lines.join("\n"));
    // Under an outer `node --test`, NODE_TEST_CONTEXT would make this run report to it instead of printing.
    const { NODE_TEST_CONTEXT: _outer, ...env } = process.env;
    const ran = node(["--enable-source-maps", "--test", path], this.gameDir, env);
    return {
      path,
      frames: session.history.length,
      passes: ran.ok,
      ...(ran.ok ? {} : { output: ran.output.trim().split("\n").slice(-30).join("\n") }),
    };
  }

  /**
   * Draw the game as it is now. A renderer process of its own (`tse render-server`) plays the run's input through the headless
   * renderer, so the session's world is untouched; it is kept between pictures and sent only the frames since the last one. When the
   * run's input is no longer what it was sent (a restore, a replay, a reset), or the game was reloaded, it starts again.
   */
  async #screenshot(request: SessionRequest): Promise<Record<string, unknown>> {
    const session = this.session;
    const library = findLibrary("headless");
    if (library === null)
      throw new RequestError(
        "screenshot needs the headless libtse (in this repository `npm run native:build:headless`; a game gets it from @tsengine/native)."
      );
    const history = session.history;
    const sent = this.#rendered;
    const same =
      sent.length <= history.length &&
      sent.every((frame, i) => frame === history[i] || JSON.stringify(frame) === JSON.stringify(history[i]));
    if (this.#renderer === null || !same) {
      this.#renderer?.close();
      this.#renderer = new RenderClient(this.gameDir, library);
      this.#rendered = [];
    }
    const fresh = history.slice(this.#rendered.length);
    const out = typeof request["out"] === "string" ? resolve(request["out"]) : resolve("shots");
    const target = out.endsWith(".png") ? out : join(out, `frame-${session.frame}.png`);
    mkdirSync(dirname(target), { recursive: true });
    const scale = typeof request["scale"] === "number" ? request["scale"] : 1;
    await this.#renderer.ask({ play: packFrames(fresh), shot: target, scale });
    this.#rendered = [...history];
    return { path: target };
  }

  close(): void {
    this.#session?.close();
    this.#renderer?.close();
  }
}

/** A `tse render-server` process, asked a request at a time. */
class RenderClient {
  readonly #child: ChildProcess;
  readonly #channel: Duplex;
  readonly #answers: ((line: string | null) => void)[] = [];
  #stderr = "";

  constructor(gameDir: string, library: string) {
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    // Requests and answers go over a pipe of their own (fd 3): see `tse render-server`.
    this.#child = spawn(process.execPath, [cli, "render-server", gameDir], {
      cwd: gameDir,
      env: { ...process.env, TSE_NATIVE_LIB: library },
      stdio: ["ignore", "ignore", "pipe", "pipe"],
    });
    this.#channel = this.#child.stdio[3] as Duplex;
    this.#child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-4000);
    });
    createInterface({ input: this.#channel }).on("line", (line) => this.#answers.shift()?.(line));
    this.#child.on("close", () => {
      for (const answer of this.#answers.splice(0)) answer(null);
    });
  }

  ask(request: unknown): Promise<void> {
    return new Promise((done, fail) => {
      this.#answers.push((line) => {
        if (line === null) return fail(new RequestError(`screenshot: the renderer stopped.\n${this.#stderr.trim()}`));
        let answer: { ok: boolean; error?: string };
        try {
          answer = JSON.parse(line) as typeof answer;
        } catch {
          return fail(new RequestError(`screenshot: the renderer said something unreadable: ${line.slice(0, 200)}`));
        }
        if (answer.ok) done();
        else fail(new RequestError(`screenshot failed: ${answer.error}`));
      });
      this.#channel.write(`${JSON.stringify(request)}\n`);
    });
  }

  close(): void {
    this.#channel.end();
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
  map: "around",
  state: "query",
  find: "query",
  snapshot: "name",
  press: "query",
  watch: "path",
  "save-test": "name",
  unwatch: "path",
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
