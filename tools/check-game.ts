/**
 * One command that says whether a game package is sound: compile it, type-check it, run its tests, and run its parity
 * script. It prints one line per step and a summary, and exits 1 if any step failed (with that step's output).
 *
 *   npm run check:demo           (node tools/check-game.ts demo)
 *
 * A game is `packages/<name>` laid out like the demo: `src/*.tsx`, `generated/`, `test/`, `parity.ts`, `main.ts`.
 *
 * 1. compile   `rge-compile src generated` (with `--scenes scenes` if the package has a `scenes/` folder)
 * 2. typecheck `tsc -p packages/<name>/tsconfig.json`, then the repository's `tsc -p tsconfig.json`
 * 3. tests     `node --test packages/<name>/test/**` (the output's counts are printed)
 * 4. parity    `parity.ts` twice under Node (identical, so a run is deterministic); and, when the Rust host is built
 *              (host/target/release/rge-host, or RGE_HOST_BIN), bundled and run under it too, which must print the same
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
if (name === undefined || !existsSync(join(repo, "packages", name, "main.ts"))) {
  console.error("usage: npm run check:<game>  (node tools/check-game.ts <name>, where packages/<name>/main.ts exists)");
  process.exit(2);
}
const pkg = join(repo, "packages", name);

interface Outcome {
  readonly ok: boolean;
  readonly detail: string;
  readonly output: string;
}

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): { ok: boolean; stdout: string; output: string } {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env });
  return { ok: result.status === 0, stdout: result.stdout ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

const node = (args: readonly string[], env?: NodeJS.ProcessEnv) => run(process.execPath, args, env);

const steps: { name: string; run: () => Outcome }[] = [
  {
    name: "compile",
    run: () => {
      const args = ["packages/compiler/src/cli.ts", `packages/${name}/src`, `packages/${name}/generated`];
      if (existsSync(join(pkg, "scenes"))) args.push("--scenes", `packages/${name}/scenes`);
      const r = node(args);
      return { ok: r.ok, detail: r.output.trim().split("\n").at(-1) ?? "", output: r.output };
    },
  },
  {
    name: "typecheck",
    run: () => {
      const tsc = join(repo, "node_modules/.bin/tsc");
      for (const project of [`packages/${name}/tsconfig.json`, "tsconfig.json"]) {
        const r = run(tsc, ["-p", project]);
        if (!r.ok) return { ok: false, detail: project, output: r.output };
      }
      return { ok: true, detail: "", output: "" };
    },
  },
  {
    name: "tests",
    run: () => {
      const r = node(["--test", "--test-reporter=spec", `packages/${name}/test/**/*.test.ts`]);
      const count = (label: string): string => new RegExp(`^ℹ ${label} (\\d+)`, "m").exec(r.output)?.[1] ?? "?";
      return { ok: r.ok, detail: `${count("pass")} passed, ${count("fail")} failed, ${count("skipped")} skipped`, output: r.output };
    },
  },
  {
    name: "parity",
    run: () => {
      const parity = `packages/${name}/parity.ts`;
      const first = node([parity]);
      if (!first.ok) return { ok: false, detail: "parity.ts failed under Node", output: first.output };
      const second = node([parity]);
      if (second.stdout !== first.stdout) return { ok: false, detail: "two runs under Node differ", output: "The parity script printed different output on a second run: the game is not deterministic." };
      const host = process.env["RGE_HOST_BIN"] ?? join(repo, "host/target/release/rge-host");
      if (!existsSync(host)) return { ok: true, detail: "Node only (the Rust host is not built)", output: "" };
      const dir = mkdtempSync(join(tmpdir(), "rge-check-"));
      try {
        const bundled = node(["tools/bundle.ts", `packages/${name}/parity.ts`, join(dir, "parity.js")]);
        if (!bundled.ok) return { ok: false, detail: "bundling for the host failed", output: bundled.output };
        const underHost = run(host, [join(dir, "parity.js")]);
        if (!underHost.ok) return { ok: false, detail: "the Rust host failed", output: underHost.output };
        if (underHost.stdout !== first.stdout) return { ok: false, detail: "output under the Rust host differs from Node", output: "The parity script's output differs between Node and the Rust host (QuickJS)." };
        return { ok: true, detail: "Node and the Rust host agree", output: "" };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

let failed = 0;
for (const step of steps) {
  const started = Date.now();
  const outcome = step.run();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${outcome.ok ? "ok  " : "FAIL"} ${step.name.padEnd(10)} ${outcome.detail} (${seconds}s)`);
  if (!outcome.ok) {
    failed++;
    console.log(outcome.output.trim().split("\n").slice(-60).join("\n"));
    break; // later steps depend on this one
  }
}
console.log(failed === 0 ? `check ${name}: passed` : `check ${name}: FAILED`);
process.exit(failed === 0 ? 0 : 1);
