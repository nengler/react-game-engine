import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// `--json` on `tse build` and `tse check`, on a game made from the template in a temporary folder.
const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
const repo = resolve(dirname(cli), "../../..");
let root = "";
let game = "";

const tse = (args: string[]) => {
  // Under this file's own `node --test`, NODE_TEST_CONTEXT would make the game's inner test run report to it.
  const { NODE_TEST_CONTEXT: _outer, ...env } = process.env;
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", timeout: 180_000, env });
};

before(() => {
  root = mkdtempSync(join(tmpdir(), "tse-json-"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  game = join(root, "fixture");
  assert.equal(tse(["create", game]).status, 0);
});
after(() => rmSync(root, { recursive: true, force: true }));

/** Run with a file changed, and put it back after. */
function withChange<T>(file: string, change: (text: string) => string, run: () => T): T {
  const path = join(game, file);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, change(text));
  try {
    return run();
  } finally {
    writeFileSync(path, text);
  }
}

test("build --json: the compiler's diagnostics as data, with where they are", () => {
  const ok = tse(["build", game, "--json"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const good = JSON.parse(ok.stdout) as { ok: boolean; errors: number; log: string[] };
  assert.equal(good.ok, true);
  assert.equal(good.errors, 0);
  assert.ok(good.log.some((line) => line.startsWith("compiled Hero.tsx")));

  const bad = withChange(
    "src/Hero.tsx",
    (text) => text.replace("move(dirX * speed * dt, dirY * speed * dt);", "move(dirX * speed * dt, dirY * speed * dt, nowhere);"),
    () => tse(["build", game, "--json"])
  );
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout) as {
    ok: boolean;
    errors: number;
    diagnostics: { file: string; line: number; column: number; code: string; severity: string; message: string }[];
  };
  assert.equal(report.ok, false);
  assert.ok(report.errors >= 1);
  const first = report.diagnostics[0]!;
  assert.match(first.file, /src\/Hero\.tsx$/);
  assert.equal(typeof first.line, "number");
  assert.match(first.code, /^TSE\d{4}$/);
  assert.match(first.message, /nowhere/);
});

test("check --json: every step as data, and a failing test by name, file, line and message", () => {
  const passed = tse(["check", game, "--json"]);
  const good = JSON.parse(passed.stdout) as { ok: boolean; steps: { name: string; ok: boolean }[]; skipped: string[] };
  assert.equal(good.ok, true, passed.stdout);
  assert.deepEqual(
    good.steps.map((s) => s.name),
    ["compile", "typecheck", "tests", "previews", "parity"]
  );
  assert.deepEqual(good.skipped, []);

  const failing = withChange(
    "test/hero.test.ts",
    (text) => `${text}\nimport { test as extra } from "node:test";\nextra("the hero flies", () => { throw new Error("no wings"); });\n`,
    () => tse(["check", game, "--json"])
  );
  assert.equal(failing.status, 1);
  const report = JSON.parse(failing.stdout) as {
    ok: boolean;
    steps: { name: string; ok: boolean; failures?: { name: string; file: string; line: number; error: string }[]; output?: string }[];
    skipped: string[];
  };
  assert.equal(report.ok, false);
  const tests = report.steps.find((s) => s.name === "tests")!;
  assert.equal(tests.ok, false);
  assert.deepEqual(
    tests.failures?.map((f) => [f.name, f.file, f.error]),
    [["the hero flies", "test/hero.test.ts", "no wings"]]
  );
  assert.equal(typeof tests.failures?.[0]?.line, "number");
  assert.equal(tests.output, undefined, "the failures say it: no output tail");
  assert.deepEqual(report.skipped, ["previews", "parity"]);

  const broken = withChange(
    "src/Hero.tsx",
    (text) => text.replace("useBody({", "useBody(({"),
    () => tse(["check", game, "--json"])
  );
  const compile = (JSON.parse(broken.stdout) as { steps: { name: string; ok: boolean; diagnostics: { file: string }[] }[] }).steps[0]!;
  assert.equal(compile.name, "compile");
  assert.equal(compile.ok, false);
  assert.ok(compile.diagnostics.some((d) => d.file.endsWith("src/Hero.tsx")));
});
