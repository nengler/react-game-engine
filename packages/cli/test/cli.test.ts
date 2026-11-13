// The command line, on a game made from the template in a temporary folder. Its node_modules is a link to the repository's, so
// @rge/* resolve to the workspace; tools/check-outside.ts is the check that installs packed tarballs instead.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
const repo = resolve(dirname(cli), "../../..");
let root = "";
let game = "";

const rge = (args: string[], cwd: string = root) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

before(() => {
  root = mkdtempSync(join(tmpdir(), "rge-cli-"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  game = join(root, "fixture");
  const made = rge(["create", game]);
  assert.equal(made.status, 0, made.stderr);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("create fills in the template", () => {
  const pkg = JSON.parse(readFileSync(join(game, "package.json"), "utf8")) as { name: string; rge: { name: string } };
  assert.equal(pkg.name, "fixture");
  assert.equal(pkg.rge.name, "fixture");
  assert.ok(existsSync(join(game, ".gitignore")), "gitignore is renamed");
  assert.match(readFileSync(join(game, "src/Main.tsx"), "utf8"), /title="fixture"/);
  assert.ok(!readFileSync(join(game, "package.json"), "utf8").includes("__NAME__"));
});

test("create refuses a folder that is not empty, and a bad name", () => {
  assert.equal(rge(["create", game]).status, 2);
  assert.equal(rge(["create", join(root, "ok"), "--name", "Bad Name"]).status, 2);
});

test("create --packs writes file: dependencies on the tarballs", () => {
  const packs = join(root, "packs");
  execFileSync("mkdir", [packs]);
  for (const name of ["runtime", "player", "native", "player-node", "compiler", "testing", "cli"]) writeFileSync(join(packs, `rge-${name}-0.0.0.tgz`), "");
  const made = rge(["create", join(root, "packed"), "--packs", packs]);
  assert.equal(made.status, 0, made.stderr);
  const pkg = JSON.parse(readFileSync(join(root, "packed/package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@rge/runtime"], `file:${join(packs, "rge-runtime-0.0.0.tgz")}`);
  assert.equal(pkg.devDependencies["@rge/cli"], `file:${join(packs, "rge-cli-0.0.0.tgz")}`);
  assert.equal(pkg.devDependencies["@rge/testing"], `file:${join(packs, "rge-testing-0.0.0.tgz")}`, "the tests' library is for development");
});

test("build compiles src to generated", () => {
  const built = rge(["build"], game);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.ok(existsSync(join(game, "generated/Main.ts")));
});

test("check passes on the template: compile, typecheck, tests, parity", { timeout: 120_000 }, () => {
  const checked = rge(["check", game]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  for (const step of ["compile", "typecheck", "tests", "parity"]) assert.match(checked.stdout, new RegExp(`ok   ${step}`));
  // The template ships three tests: its Hero component alone (hero.test.ts, @rge/testing) and the whole game played on a
  // recording backend (play.test.ts).
  assert.match(checked.stdout, /3 passed, 0 failed/);
});

test("check fails, and says which step, when a test fails", { timeout: 120_000 }, () => {
  writeFileSync(join(game, "test/broken.test.ts"), `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("broken", () => assert.equal(1, 2));\n`);
  const checked = rge(["check", game]);
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /FAIL tests/);
  assert.match(checked.stdout, /check fixture: FAILED/);
});

test("an error in a component names its own line in src/, not the generated file's", { timeout: 120_000 }, () => {
  const errors = join(root, "errors");
  assert.equal(rge(["create", errors]).status, 0);
  // Z calls a plain function that throws, from the useInput handler of the template's Main.
  const main = readFileSync(join(errors, "src/Main.tsx"), "utf8")
    .replace('if (input.pressed("Z")) step();', 'if (input.pressed("Z")) boom();')
    .replace('import { useGame }', 'import { boom } from "./boom.ts";\nimport { useGame }');
  writeFileSync(join(errors, "src/Main.tsx"), main);
  writeFileSync(join(errors, "src/boom.ts"), 'export function boom(): void {\n  throw new Error("boom");\n}\n');
  const built = rge(["build", errors]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.ok(existsSync(join(errors, "generated/Main.ts.map")), "a source map is written beside each generated file");
  writeFileSync(
    join(errors, "boom.ts"),
    `import { createPlayer, parseInputScript, RecordingBackend } from "@rge/player";
import { bindings, gameConfig } from "./game.ts";
const frames = parseInputScript("_*2, Z, _", { bindings });
const backend = new RecordingBackend();
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, showErrors: true } as never);
for (let i = 0; i < frames.length + 1; i++) player.step();
console.log(String((player.failure?.error as Error | undefined)?.stack));
`,
  );
  // `rge dev` and `rge check` run Node with this flag; so does this.
  const ran = spawnSync(process.execPath, ["--enable-source-maps", "boom.ts"], { cwd: errors, encoding: "utf8" });
  const frame = ran.stdout.split("\n").find((line) => line.includes("Main.onInput"));
  assert.ok(frame, ran.stdout + ran.stderr);
  // The line of the `useInput(` the handler is written in (a source map keeps a line for the construct it came from).
  const line = main.split("\n").findIndex((l) => l.includes("useInput((input)")) + 1;
  assert.match(frame!, new RegExp(`src/Main\\.tsx:${line}:\\d+\\)$`), frame);
  assert.doesNotMatch(ran.stdout, /generated\/Main\.ts:/, "no frame names the generated file");
});

test("a folder that is not a game, and an unknown command, are usage errors", () => {
  assert.equal(rge(["check", root]).status, 2);
  assert.match(rge(["check", root]).stderr, /no package\.json/);
  assert.equal(rge(["frobnicate"]).status, 2);
});
