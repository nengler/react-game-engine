/**
 * Hot reload under Node, end to end: a copy of the demo is played with `playWithReload` against a recording backend, its
 * source is edited on disk, and the open game is checked after each reload. Needs no native library.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RecordingBackend, type Player } from "@rge/player";
import { Text, type GameObject } from "@rge/runtime";
import { compileErrors, playWithReload } from "../src/dev.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Inside the repository, so the copy finds the engine's packages in its node_modules as the demo does.
const gameDir = join(repo, ".test-output", `hot-demo-${process.pid}`);

after(() => rmSync(gameDir, { recursive: true, force: true }));

/** A recording backend that keeps only the last frame and takes a millisecond per frame, as a window with vsync takes longer. */
class PacedBackend extends RecordingBackend {
  readonly #pause = new Int32Array(new SharedArrayBuffer(4));
  override frame(clearColor: number, records: Float64Array, length: number, texts: readonly string[], input: Float64Array, keys: Uint8Array): void {
    super.frame(clearColor, records, length, texts, input, keys);
    if (this.frames.length > 1) this.frames.shift();
    Atomics.wait(this.#pause, 0, 0, 1);
  }
}

function find(root: GameObject, name: string): GameObject | null {
  if (root.constructor.name === name) return root;
  for (const child of root.children) {
    const found = find(child, name);
    if (found !== null) return found;
  }
  return null;
}

function texts(root: GameObject): string[] {
  const out: string[] = [];
  const walk = (object: GameObject): void => {
    if (object instanceof Text) out.push(object.text);
    object.children.forEach(walk);
  };
  walk(root);
  return out;
}

describe("playWithReload", () => {
  it("swaps in each new build, keeps component and game state, and shows a compile error until it is fixed", async () => {
    mkdirSync(gameDir, { recursive: true });
    for (const name of ["src", "assets", "main.ts", "game.ts", "package.json", "tsconfig.json"]) cpSync(join(repo, "packages/demo", name), join(gameDir, name), { recursive: true });
    const counterFile = join(gameDir, "src/CoinCounter.tsx");
    const original = readFileSync(counterFile, "utf8");
    assert.ok(original.includes("Coins: {coins}"));

    const backend = new PacedBackend();
    const events: string[] = [];
    const logs: string[] = [];
    const steps: ((player: Player) => void)[] = [
      // Started: change some state, then edit the counter's text.
      (player) => {
        const main = find(player.world.root, "Main") as GameObject & { setClicks(n: number): void };
        main.setClicks(2);
        const counter = find(player.world.root, "CoinCounter") as GameObject & { gameStateStore: { setState(s: object): void } };
        counter.gameStateStore.setState({ stats: { coins: 3, hits: 1 } });
        player.world.flush();
        writeFileSync(counterFile, original.replace("Coins: {coins}", "Gold: {coins}"));
      },
      // Reloaded: the new text, with the old state. Then break the file.
      (player) => {
        assert.ok(texts(player.world.root).includes("Gold: 3"), texts(player.world.root).join(" | "));
        assert.equal((find(player.world.root, "Main") as GameObject & { clicks: number }).clicks, 2);
        writeFileSync(counterFile, original.replace("Coins: {coins}", "Gold: {coinz}"));
      },
      // The compile error is shown in the window. Fix it.
      (player) => {
        const error = player.failure?.error;
        assert.equal(typeof error, "string");
        assert.match(error as string, /coinz/);
        assert.ok(backend.frames.length > 0);
        writeFileSync(counterFile, original.replace("Coins: {coins}", "Coins now: {coins}"));
      },
      // Fixed: the game runs again, still with its state. Close the window.
      (player) => {
        assert.equal(player.failure, null);
        assert.ok(texts(player.world.root).includes("Coins now: 3"));
        backend.queueInput({ quit: true });
      },
    ];
    let failure: unknown = null;
    const result = await playWithReload(backend, {
      entry: join(gameDir, "main.ts"),
      log: (message) => logs.push(message),
      observe: (event, player) => {
        events.push(event);
        const step = steps.shift();
        try {
          step?.(player);
        } catch (error) {
          failure ??= error;
          backend.queueInput({ quit: true });
        }
      },
    });
    if (failure !== null) throw failure;
    assert.deepEqual(events, ["start", "reload", "error", "reload"]);
    assert.equal(result.failed, false);
    assert.ok(logs.some((line) => line.startsWith("reloaded in")));
    assert.equal(backend.closed, true);
  });

  it("keeps only the compiler's error lines for the window", () => {
    assert.equal(compileErrors("read GameState.ts (2 actions)\nwrote Main.ts\nsrc/A.tsx(1,2): error RGE1: bad\n"), "src/A.tsx(1,2): error RGE1: bad");
    assert.equal(compileErrors("wrote Main.ts\n"), "wrote Main.ts");
  });
});
