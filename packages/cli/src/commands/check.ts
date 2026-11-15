/**
 * `tse check [folder]`: one command that says whether a game is sound. It prints one line per step and a summary, and returns 1
 * if any step failed (with that step's output).
 *
 * 1. compile    `src` to `generated`, with scenes and assets where the game has them
 * 2. typecheck  `tsc -p tsconfig.json` in the game's folder
 * 3. tests      `node --test test/**` (the output's counts are printed)
 * 4. previews   the game's stories rendered and compared with their stored screenshots (`tse preview --compare`), when it
 *               has stored any and the headless libtse is found
 * 5. parity     `parity.ts` twice under Node (identical, so a run is deterministic); and, when tse-host is found, bundled and
 *               run under it too, which must print the same
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileArgs, SCREENSHOTS_FOLDER, storyFiles } from "@tsengine/player-node";

import { bundleForHost } from "../bundle.ts";
import { loadGame, type Game } from "../config.ts";
import { findHost, findLibrary } from "../native.ts";
import { node, run } from "../run.ts";

interface Outcome {
  readonly ok: boolean;
  readonly detail: string;
  readonly output: string;
}

/** TypeScript's own `tsc`, from this package's dependency. */
function tscPath(): string {
  const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
  return join(dirname(manifest), "bin", "tsc");
}

function hasTests(game: Game): boolean {
  const dir = join(game.dir, "test");
  return existsSync(dir) && readdirSync(dir, { recursive: true }).some((file) => String(file).endsWith(".test.ts"));
}

/** This command line's own script, to run `tse preview --compare` in a process of its own. */
function cliScript(): string {
  const dir = dirname(dirname(fileURLToPath(import.meta.url)));
  return [join(dir, "cli.ts"), join(dir, "cli.js")].find((path) => existsSync(path)) ?? join(dir, "cli.js");
}

function previews(game: Game): Outcome {
  const files = storyFiles(game.dir);
  if (files.length === 0) return { ok: true, detail: "no stories", output: "" };
  if (!existsSync(join(game.dir, SCREENSHOTS_FOLDER)))
    return { ok: true, detail: `${files.length} stories files, no stored screenshots (tse preview --screenshot stores them)`, output: "" };
  const library = findLibrary("headless");
  if (library === null) return { ok: true, detail: "not compared: the headless libtse was not found", output: "" };
  const r = node([cliScript(), "preview", game.dir, "--compare"], game.dir, { ...process.env, TSE_NATIVE_LIB: library });
  const last = r.output
    .trim()
    .split("\n")
    .find((line) => /stories match/.test(line));
  return { ok: r.ok, detail: r.ok ? (last ?? "") : "stories differ from their stored screenshots", output: r.output };
}

async function parity(game: Game): Promise<Outcome> {
  if (!existsSync(join(game.dir, "parity.ts"))) return { ok: true, detail: "no parity.ts", output: "" };
  const first = node(["parity.ts"], game.dir);
  if (!first.ok) return { ok: false, detail: "parity.ts failed under Node", output: first.output };
  const second = node(["parity.ts"], game.dir);
  if (second.stdout !== first.stdout)
    return {
      ok: false,
      detail: "two runs under Node differ",
      output: "The parity script printed different output on a second run: the game is not deterministic.",
    };
  const host = findHost("headless");
  if (host === null) return { ok: true, detail: "Node only (tse-host was not found)", output: "" };
  const dir = mkdtempSync(join(tmpdir(), "tse-check-"));
  try {
    try {
      await bundleForHost(join(game.dir, "parity.ts"), join(dir, "parity.js"));
    } catch (error) {
      return { ok: false, detail: "bundling for the host failed", output: String(error instanceof Error ? error.message : error) };
    }
    const underHost = run(host, [join(dir, "parity.js")], game.dir);
    if (!underHost.ok) return { ok: false, detail: "the Rust host failed", output: underHost.output };
    if (underHost.stdout !== first.stdout)
      return {
        ok: false,
        detail: "output under the Rust host differs from Node",
        output: "The parity script's output differs between Node and the Rust host (QuickJS).",
      };
    return { ok: true, detail: "Node and the Rust host agree", output: "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function checkCommand(args: readonly string[]): Promise<number> {
  const game = loadGame(args[0]);
  const steps: { name: string; run: () => Outcome | Promise<Outcome> }[] = [
    {
      name: "compile",
      run: () => {
        const r = node(compileArgs(game.dir), game.dir);
        if (r.ok) return { ok: true, detail: r.output.trim().split("\n").at(-1) ?? "", output: r.output };
        // The errors are printed below, once each: the summary line only counts them.
        const errors = r.output.split("\n").filter((line) => / - error TSE\d+:/.test(line)).length;
        return { ok: false, detail: errors === 1 ? "1 error" : errors > 1 ? `${errors} errors` : "the compiler failed", output: r.output };
      },
    },
    {
      name: "typecheck",
      run: () => {
        if (!existsSync(join(game.dir, game.tsconfig))) return { ok: true, detail: `no ${game.tsconfig}`, output: "" };
        const r = node([tscPath(), "-p", game.tsconfig], game.dir);
        return { ok: r.ok, detail: r.ok ? "" : game.tsconfig, output: r.output };
      },
    },
    {
      name: "tests",
      run: () => {
        if (!hasTests(game)) return { ok: true, detail: "no tests", output: "" };
        // Under an outer `node --test`, NODE_TEST_CONTEXT would make the inner run report to it instead of printing.
        const { NODE_TEST_CONTEXT: _outer, ...env } = process.env;
        // `--enable-source-maps`: a failure inside a component names its own line in `src/`, not the generated file's.
        const r = node(["--enable-source-maps", "--test", "--test-reporter=spec", "test/**/*.test.ts"], game.dir, env);
        const count = (label: string): string => new RegExp(`^ℹ ${label} (\\d+)`, "m").exec(r.output)?.[1] ?? "?";
        return { ok: r.ok, detail: `${count("pass")} passed, ${count("fail")} failed, ${count("skipped")} skipped`, output: r.output };
      },
    },
    { name: "previews", run: () => previews(game) },
    { name: "parity", run: () => parity(game) },
  ];

  let failed = 0;
  for (const step of steps) {
    const started = Date.now();
    const outcome = await step.run();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${outcome.ok ? "ok  " : "FAIL"} ${step.name.padEnd(10)} ${outcome.detail} (${seconds}s)`);
    if (!outcome.ok) {
      failed++;
      console.log(outcome.output.trim().split("\n").slice(-60).join("\n"));
      break; // later steps depend on this one
    }
  }
  console.log(failed === 0 ? `check ${game.name}: passed` : `check ${game.name}: FAILED`);
  return failed === 0 ? 0 : 1;
}
