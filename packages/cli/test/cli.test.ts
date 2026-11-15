import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// The command line, on a game made from the template in a temporary folder. Its node_modules is a link to the repository's, so
// @tsengine/* resolve to the workspace; tools/check-outside.ts is the check that installs packed tarballs instead.
import { pinEngine } from "../src/commands/create.ts";
import { findLibrary } from "../src/native.ts";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
const repo = resolve(dirname(cli), "../../..");
let root = "";
let game = "";

const tse = (args: string[], cwd: string = root) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });

before(() => {
  root = mkdtempSync(join(tmpdir(), "tse-cli-"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  game = join(root, "fixture");
  const made = tse(["create", game]);
  assert.equal(made.status, 0, made.stderr);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("create fills in the template", () => {
  const pkg = JSON.parse(readFileSync(join(game, "package.json"), "utf8")) as { name: string; tse: { name: string } };
  assert.equal(pkg.name, "fixture");
  assert.equal(pkg.tse.name, "fixture");
  assert.ok(existsSync(join(game, ".gitignore")), "gitignore is renamed");
  assert.match(readFileSync(join(game, "src/Main.tsx"), "utf8"), /title="fixture"/);
  assert.ok(!readFileSync(join(game, "package.json"), "utf8").includes("__NAME__"));
});

test("create refuses a folder that is not empty, and a bad name", () => {
  assert.equal(tse(["create", game]).status, 2);
  assert.equal(tse(["create", join(root, "ok"), "--name", "Bad Name"]).status, 2);
});

test("create --packs writes file: dependencies on the tarballs", () => {
  const packs = join(root, "packs");
  execFileSync("mkdir", [packs]);
  for (const name of ["runtime", "player", "native", "player-node", "compiler", "testing", "language-server", "cli"])
    writeFileSync(join(packs, `tsengine-${name}-0.0.0.tgz`), "");
  const made = tse(["create", join(root, "packed"), "--packs", packs]);
  assert.equal(made.status, 0, made.stderr);
  const pkg = JSON.parse(readFileSync(join(root, "packed/package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.dependencies["@tsengine/runtime"], `file:${join(packs, "tsengine-runtime-0.0.0.tgz")}`);
  assert.equal(pkg.devDependencies["@tsengine/cli"], `file:${join(packs, "tsengine-cli-0.0.0.tgz")}`);
  assert.equal(
    pkg.devDependencies["@tsengine/testing"],
    `file:${join(packs, "tsengine-testing-0.0.0.tgz")}`,
    "the tests' library is for development"
  );
  assert.equal(
    pkg.devDependencies["@tsengine/language-server"],
    `file:${join(packs, "tsengine-language-server-0.0.0.tgz")}`,
    "the editor's server too"
  );
});

for (const template of ["menu", "platformer"]) {
  test(`create --template ${template} makes a starter that passes tse check`, { timeout: 180_000 }, () => {
    const folder = join(root, template);
    const made = tse(["create", folder, "--template", template]);
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, new RegExp(`\\(${template}\\)`));
    assert.match(readFileSync(join(folder, "src/Main.tsx"), "utf8"), new RegExp(`title="${template}"`));
    const checked = tse(["check", folder]);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.match(checked.stdout, /0 failed/);
  });
}

test("create refuses a template it does not have, and names the ones it has", () => {
  const made = tse(["create", join(root, "nope"), "--template", "rpg"]);
  assert.equal(made.status, 2);
  assert.match(made.stderr, /blank, menu, platformer/);
});

test("build compiles src to generated", () => {
  const built = tse(["build"], game);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.ok(existsSync(join(game, "generated/Main.ts")));
});

test("check passes on the template: compile, typecheck, tests, parity", { timeout: 120_000 }, () => {
  const checked = tse(["check", game]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  for (const step of ["compile", "typecheck", "tests", "parity"]) assert.match(checked.stdout, new RegExp(`ok   ${step}`));
  // The template ships three tests: its Hero component alone (hero.test.ts, @tsengine/testing) and the whole game played on a
  // recording backend (play.test.ts).
  assert.match(checked.stdout, /3 passed, 0 failed/);
});

test("check fails, and says which step, when a test fails", { timeout: 120_000 }, () => {
  writeFileSync(
    join(game, "test/broken.test.ts"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("broken", () => assert.equal(1, 2));\n`
  );
  const checked = tse(["check", game]);
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /FAIL tests/);
  assert.match(checked.stdout, /check fixture: FAILED/);
});

test("an error in a component names its own line in src/, not the generated file's", { timeout: 120_000 }, () => {
  const errors = join(root, "errors");
  assert.equal(tse(["create", errors]).status, 0);
  // Z calls a plain function that throws, from the useInput handler of the template's Main.
  const main = readFileSync(join(errors, "src/Main.tsx"), "utf8")
    .replace('if (input.pressed("Z")) step();', 'if (input.pressed("Z")) boom();')
    .replace("import { useGame }", 'import { boom } from "./boom.ts";\nimport { useGame }');
  writeFileSync(join(errors, "src/Main.tsx"), main);
  writeFileSync(join(errors, "src/boom.ts"), 'export function boom(): void {\n  throw new Error("boom");\n}\n');
  const built = tse(["build", errors]);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.ok(existsSync(join(errors, "generated/Main.ts.map")), "a source map is written beside each generated file");
  writeFileSync(
    join(errors, "boom.ts"),
    `import { createPlayer, parseInputScript, RecordingBackend } from "@tsengine/player";
import { bindings, gameConfig } from "./game.ts";
const frames = parseInputScript("_*2, Z, _", { bindings });
const backend = new RecordingBackend();
for (const frame of frames) backend.queueInput(frame);
const player = createPlayer(backend, { ...gameConfig, showErrors: true } as never);
for (let i = 0; i < frames.length + 1; i++) player.step();
console.log(String((player.failure?.error as Error | undefined)?.stack));
`
  );
  // `tse dev` and `tse check` run Node with this flag; so does this.
  const ran = spawnSync(process.execPath, ["--enable-source-maps", "boom.ts"], { cwd: errors, encoding: "utf8" });
  const frame = ran.stdout.split("\n").find((line) => line.includes("Main.onInput"));
  assert.ok(frame, ran.stdout + ran.stderr);
  // The line of the `useInput(` the handler is written in (a source map keeps a line for the construct it came from).
  const line = main.split("\n").findIndex((l) => l.includes("useInput((input)")) + 1;
  assert.match(frame!, new RegExp(`src/Main\\.tsx:${line}:\\d+\\)$`), frame);
  assert.doesNotMatch(ran.stdout, /generated\/Main\.ts:/, "no frame names the generated file");
});

test(
  "a game packaged on V8 names the same src/ lines when it crashes",
  { timeout: 300_000, skip: findLibrary("headless") === null ? "libtse is not built (npm run native:build:headless)" : false },
  () => {
    // The game the test above wrote, with its boom.ts entry: packaged, run from another folder, and its stack read.
    const errors = join(root, "errors");
    const packaged = tse(["package", "--entry", "boom.ts", "--name", "boom", "--engine", "node", "--headless"], errors);
    assert.equal(packaged.status, 0, packaged.stdout + packaged.stderr);
    const ran = spawnSync(join(errors, "dist/boom/boom"), [], { cwd: tmpdir(), encoding: "utf8" });
    const frame = ran.stdout.split("\n").find((line) => line.includes("Main.onInput"));
    assert.ok(frame, ran.stdout + ran.stderr);
    const main = readFileSync(join(errors, "src/Main.tsx"), "utf8");
    const line = main.split("\n").findIndex((l) => l.includes("useInput((input)")) + 1;
    assert.match(frame!, new RegExp(`src/Main\\.tsx:${line}:\\d+\\)$`), frame);
    assert.match(ran.stdout, /at boom \(.*src\/boom\.ts:2:\d+\)/);
    assert.match(ran.stdout, /@tsengine\/runtime\/src\/World\.ts:\d+/, "the engine's frames by package");
    assert.doesNotMatch(ran.stdout, /game\.cjs:/, "no frame names the bundle");
  }
);

test("a folder that is not a game, and an unknown command, are usage errors", () => {
  assert.equal(tse(["check", root]).status, 2);
  assert.match(tse(["check", root]).stderr, /no package\.json/);
  assert.equal(tse(["frobnicate"]).status, 2);
});

test(
  "screenshot --compare passes against references it wrote, fails on a changed one, and --tolerance lets a small change pass",
  { timeout: 120_000, skip: findLibrary("headless") === null ? "libtse is not built (npm run native:build:headless)" : false },
  () => {
    assert.equal(tse(["build", game]).status, 0);
    const refs = join(root, "refs");
    const out = join(root, "shots");
    const shot = (...more: string[]) =>
      tse(["screenshot", game, "--script", "right*5", "--at", "4", "--out", out, "--compare", refs, ...more]);
    const wrote = shot("--update");
    assert.equal(wrote.status, 0, wrote.stderr);
    assert.match(wrote.stdout, /updated 1 reference/);
    const same = shot();
    assert.equal(same.status, 0, same.stdout + same.stderr);
    assert.match(same.stdout, /same {2}step-4/);
    // Change one pixel of the reference by 10 in its red channel.
    const reference = join(refs, "step-4.png");
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { readFileSync, writeFileSync } from "node:fs";
       import { decodePng, encodePng } from "@tsengine/player-node";
       const p = decodePng(readFileSync(${JSON.stringify(reference)}));
       p.rgba[0] = (p.rgba[0] + 10) % 256;
       writeFileSync(${JSON.stringify(reference)}, encodePng(p));`,
      ],
      { cwd: root }
    );
    const changed = shot();
    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /DIFF {2}step-4: 1 pixels differ by more than 0/);
    assert.equal(shot("--tolerance", "10").status, 0, "a change of 10 is within a tolerance of 10");
  }
);

test("screenshot --gpu says what is missing when the desktop build is not there", () => {
  const ran = spawnSync(process.execPath, [cli, "screenshot", game, "--gpu"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TSE_NATIVE_LIB: join(root, "no-such-libtse.so") },
  });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /--gpu needs the desktop build of libtse: run `npm run native:build`/);
});

test("a CLI from npm pins a new game's engine packages to its own version", () => {
  const pinned = pinEngine(
    { name: "g", dependencies: { "@tsengine/runtime": "0.0.0", other: "^1.0.0" }, devDependencies: { "@tsengine/cli": "0.0.0" } },
    "0.2.0"
  );
  assert.deepEqual(pinned["dependencies"], { "@tsengine/runtime": "0.2.0", other: "^1.0.0" });
  assert.deepEqual(pinned["devDependencies"], { "@tsengine/cli": "0.2.0" });
});
