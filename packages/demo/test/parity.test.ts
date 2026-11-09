import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const parity = resolve(repo, "packages/demo/parity.ts");

/** The Rust host, when it has been built: `RGE_HOST_BIN` names it. CI sets RGE_REQUIRE_HOST=1 so a missing one fails. */
const hostBin = process.env["RGE_HOST_BIN"];
const requireHost = process.env["RGE_REQUIRE_HOST"] === "1";
const skipHost = hostBin !== undefined && existsSync(hostBin) ? false : requireHost ? false : "the Rust host is not built (npm run host:build:headless, then RGE_HOST_BIN=host/target/release/rge-host)";

function bundle(entry: string, out: string): void {
  execFileSync(process.execPath, [resolve(repo, "tools/bundle.ts"), entry, out], { cwd: repo, stdio: "pipe" });
}

function underNode(): string {
  return execFileSync(process.execPath, [parity], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

describe("parity: the demo under Node", () => {
  it("prints the same output every run and a full minute of the game", () => {
    const first = underNode();
    assert.equal(underNode(), first, "the output is deterministic");
    const run = JSON.parse(first) as { frames: { records: { op: string; text?: string }[] }[]; plays: string[]; warnings: string[] };
    assert.equal(run.frames.length, 60);
    assert.deepEqual(run.plays, ["assets/click.wav"], "the miss does not play, the hit does once");
    assert.ok(run.frames.at(-1)?.records.some((r) => r.op === "text" && r.text === "Clicks: 1"), "the click on the button counted");
    assert.equal(run.warnings.length, 1, "only the missing beacon frame warns");
  });
});

describe("bundling for the host", () => {
  it("bundles the demo into one module with nothing from Node or a native package", () => {
    const dir = mkdtempSync(join(tmpdir(), "rge-bundle-"));
    try {
      bundle("packages/demo/main.ts", join(dir, "game.js"));
      const text = readFileSync(join(dir, "game.js"), "utf8");
      assert.doesNotMatch(text, /node:|koffi/, "no Node or koffi import");
      assert.match(text, /__rgeBackend/, "it asks the host for the backend");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a bundle that imports from Node", () => {
    const dir = mkdtempSync(join(tmpdir(), "rge-bundle-"));
    try {
      assert.throws(() => bundle("packages/player-node/src/play.ts", join(dir, "play.js")), /Command failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parity: the demo under the Rust host (QuickJS-ng)", { skip: skipHost }, () => {
  it("produces byte-identical output to Node over 60 scripted frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "rge-parity-"));
    try {
      bundle("packages/demo/parity.ts", join(dir, "parity.js"));
      const underHost = execFileSync(hostBin as string, [join(dir, "parity.js")], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      assert.equal(underHost, underNode());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits with status 1 and prints the stack when the game throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "rge-crash-"));
    try {
      writeCrash(dir);
      assert.throws(
        () => execFileSync(hostBin as string, [join(dir, "crash.js")], { cwd: repo, stdio: "pipe" }),
        (error: { status?: number; stderr?: Buffer }) => error.status === 1 && /Error: boom/.test(String(error.stderr)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits with status 2 and a usage line for a missing game file", () => {
    assert.throws(
      () => execFileSync(hostBin as string, [join(tmpdir(), "rge-no-such-game.js")], { cwd: repo, stdio: "pipe" }),
      (error: { status?: number; stderr?: Buffer }) => error.status === 2 && /Cannot read/.test(String(error.stderr)),
    );
  });
});

function writeCrash(dir: string): void {
  execFileSync(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(join(dir, "crash.js"))}, 'console.log("starting"); throw new Error("boom");')`]);
}
