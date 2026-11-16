import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { findLibrary } from "../src/native.ts";
// `tse session` and `tse mcp` on a game made from the template, in a temporary folder whose node_modules is the repository's.
import { parseRequestLine } from "../src/session-server.ts";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
const repo = resolve(dirname(cli), "../../..");
let root = "";
let game = "";

const tse = (args: string[], input = "") =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input, timeout: 120_000 });

/** Run `tse session` on the game with these lines on stdin; the answers, parsed. */
function session(lines: readonly string[], args: readonly string[] = []): Record<string, unknown>[] {
  const ran = tse(["session", game, ...args], `${lines.join("\n")}\n`);
  assert.equal(ran.status, 0, ran.stderr);
  return ran.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "tse-session-"));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
  game = join(root, "walker");
  const made = tse(["create", game]);
  assert.equal(made.status, 0, made.stderr);
});
after(() => rmSync(root, { recursive: true, force: true }));

test("a request is JSON or a command and its argument as words", () => {
  assert.deepEqual(parseRequestLine("input right*30, jump"), { cmd: "input", script: "right*30, jump" });
  assert.deepEqual(parseRequestLine("step 60"), { cmd: "step", count: 60 });
  assert.deepEqual(parseRequestLine("observe components"), { cmd: "observe", only: "components" });
  assert.deepEqual(parseRequestLine('{"cmd":"step","until":{"text":"x"}}'), { cmd: "step", until: { text: "x" } });
  assert.deepEqual(parseRequestLine("hash"), { cmd: "hash" });
  assert.equal(parseRequestLine("  # a comment"), null);
  assert.equal(parseRequestLine(""), null);
  assert.throws(() => parseRequestLine('{"script":"x"}'), /"cmd"/);
});

test("session: compiles the game, says it is ready, and answers each request on a line", () => {
  const answers = session([
    "info",
    "input right*30",
    '{"cmd":"input","script":"Z, _, Z","id":7}',
    "state Hero",
    "state",
    '{"cmd":"step","until":{"path":"steps","equals":2},"maxSteps":5}',
    "observe components",
    "snapshot here",
    "input down*20",
    "restore here",
    "texts",
    "bogus",
    "quit",
    "info",
  ]);
  const [ready, info, moved, pressed, hero, state, until, observed, snap, down, restored, texts, bogus] = answers;
  assert.equal(answers.length, 13, "nothing is answered after quit");
  assert.equal(ready?.["ready"], true);
  assert.deepEqual(ready?.["actions"], ["left", "right", "up", "down"]);
  assert.deepEqual(ready?.["gameStates"], ["useGame"], "game states by export name");
  assert.equal(info?.["game"], "walker");
  assert.deepEqual([moved?.["ok"], moved?.["frame"], moved?.["steps"]], [true, 30, 30]);
  assert.deepEqual([pressed?.["id"], pressed?.["steps"]], [7, 3], "the id comes back");
  const heroes = hero?.["matches"] as { x: number; state: Record<string, unknown> }[];
  assert.equal(heroes.length, 1);
  assert.ok(heroes[0]!.x > 152, "the hero moved right");
  assert.deepEqual(state?.["gameState"], { useGame: { steps: 2 } });
  assert.deepEqual([until?.["steps"], until?.["reached"]], [0, true]);
  assert.match(observed?.["scene"] as string, /^Main @\(0,0\)\n {2}Hero @\(\d+(\.\d+)?,82\)/);
  assert.deepEqual(snap?.["snapshots"], [{ name: "here", frame: 33 }]);
  assert.equal(down?.["frame"], 53);
  assert.equal(restored?.["frame"], 33);
  assert.deepEqual(texts?.["texts"], ["steps: 2"]);
  assert.equal(bogus?.["ok"], false);
  assert.match(bogus?.["error"] as string, /^Unknown command 'bogus'\. The commands: info, input/);
  assert.ok(!String(bogus?.["error"]).includes(" at "), "a request's own mistake has no stack");
});

test("session: an error in a component names its line in src, and the session goes on", () => {
  const hero = join(game, "src/Hero.tsx");
  const source = readFileSync(hero, "utf8");
  try {
    writeFileSync(
      hero,
      source.replace(
        "move(dirX * speed * dt, dirY * speed * dt);",
        'if (dirY > 0) throw new Error("fell off");\n    move(dirX * speed * dt, dirY * speed * dt);'
      )
    );
    const [, fell, info] = session(["input down*3", "info"]);
    assert.equal(fell?.["ok"], false);
    assert.match(fell?.["error"] as string, /^fell off\n.*src\/Hero\.tsx:\d+/);
    assert.equal(info?.["ok"], true);
  } finally {
    writeFileSync(hero, source);
  }
});

test("session: reload compiles the changed game and plays the same input with it", () => {
  const hero = join(game, "src/Hero.tsx");
  const source = readFileSync(hero, "utf8");
  try {
    // The first load compiles; the edit then lands before `reload`, written by the test between two answers.
    const ran = spawnSync(
      process.execPath,
      [
        "-e",
        `
        const { spawn } = require("node:child_process");
        const fs = require("node:fs");
        const child = spawn(process.execPath, [${JSON.stringify(cli)}, "session", ${JSON.stringify(game)}], { stdio: ["pipe", "pipe", "inherit"] });
        const answers = [];
        let buffered = "";
        const send = (line) => child.stdin.write(line + "\\n");
        child.stdout.on("data", (chunk) => {
          buffered += chunk;
          for (let at; (at = buffered.indexOf("\\n")) >= 0; ) {
            answers.push(JSON.parse(buffered.slice(0, at)));
            buffered = buffered.slice(at + 1);
            if (answers.length === 1) send("input right*30");
            else if (answers.length === 2) send("state Hero");
            else if (answers.length === 3) {
              fs.writeFileSync(${JSON.stringify(hero)}, fs.readFileSync(${JSON.stringify(hero)}, "utf8").replace("speed = 120", "speed = 240"));
              send("reload");
            } else if (answers.length === 4) send("state Hero");
            else child.stdin.end();
          }
        });
        child.on("close", () => console.log(JSON.stringify(answers)));
        `,
      ],
      { encoding: "utf8", timeout: 120_000 }
    );
    const answers = JSON.parse(ran.stdout) as Record<string, unknown>[];
    const x = (answer: Record<string, unknown> | undefined): number => (answer!["matches"] as { x: number }[])[0]!.x;
    assert.deepEqual([answers[3]?.["ok"], answers[3]?.["frame"], answers[3]?.["steps"]], [true, 30, 30]);
    assert.equal(x(answers[4]) - 152, (x(answers[2]) - 152) * 2, "twice as far at twice the speed, over the same input");
  } finally {
    writeFileSync(hero, source);
  }
});

test("session: a game that does not compile says why in its first answer", () => {
  const hero = join(game, "src/Hero.tsx");
  const source = readFileSync(hero, "utf8");
  try {
    writeFileSync(hero, source.replace("useBody({", "useBody(({"));
    const ran = tse(["session", game], "info\n");
    assert.equal(ran.status, 1);
    const first = JSON.parse(ran.stdout.trim().split("\n")[0] as string) as Record<string, unknown>;
    assert.equal(first["ok"], false);
    assert.match(first["error"] as string, /^The game did not compile:\n.*Hero\.tsx/s);
  } finally {
    writeFileSync(hero, source);
    assert.equal(tse(["build", game]).status, 0);
  }
});

test("session: screenshot draws the game as it is now", { skip: findLibrary("headless") === null && "no headless libtse" }, () => {
  const out = join(root, "shot.png");
  const [, , shot] = session(["input right*10", `{"cmd":"screenshot","out":${JSON.stringify(out)}}`], ["--no-build"]);
  assert.equal(shot?.["ok"], true, String(shot?.["error"]));
  assert.equal(shot?.["path"], out);
  assert.ok(existsSync(out));
  assert.deepEqual([...readFileSync(out).subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
});

test("mcp: initializes, lists the game's tools, and calls them", () => {
  const rpc = (id: number, method: string, params: object = {}): string => JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const ran = tse(
    ["mcp", game, "--no-build"],
    [
      rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      rpc(2, "tools/list"),
      rpc(3, "tools/call", { name: "game_input", arguments: { script: "right*5, Z" } }),
      rpc(4, "tools/call", { name: "game_observe", arguments: { only: "components" } }),
      rpc(5, "tools/call", { name: "game_restore", arguments: { name: "nothing" } }),
      rpc(6, "nope"),
      rpc(7, "ping"),
    ].join("\n") + "\n"
  );
  assert.equal(ran.status, 0, ran.stderr);
  const messages = ran.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { id: number; result?: Record<string, unknown>; error?: { code: number } });
  assert.deepEqual(
    messages.map((m) => m.id),
    [1, 2, 3, 4, 5, 6, 7],
    "a notification gets no answer"
  );
  const [init, list, input, observe, restore, nope, ping] = messages;
  assert.equal(init?.result?.["protocolVersion"], "2025-03-26");
  assert.deepEqual(init?.result?.["capabilities"], { tools: {} });
  const tools = list?.result?.["tools"] as { name: string; inputSchema: { required?: string[] } }[];
  assert.ok(tools.some((t) => t.name === "game_screenshot"));
  assert.deepEqual(tools.find((t) => t.name === "game_input")?.inputSchema.required, ["script"]);
  const text = (m: typeof input): string => ((m!.result!["content"] as { text: string }[])[0] as { text: string }).text;
  assert.equal(text(input), "frame 6\nsteps: 6");
  assert.match(text(observe), /^frame 6\nscene:\nMain @\(0,0\)\n {2}Hero @/);
  assert.match(text(observe), /gameState: \{"useGame":\{"steps":1\}\}/);
  assert.equal(restore?.result?.["isError"], true);
  assert.equal(nope?.error?.code, -32601);
  assert.deepEqual(ping?.result, {});
});
