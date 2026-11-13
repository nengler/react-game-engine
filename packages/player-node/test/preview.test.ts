/**
 * `rge preview`: the window (a copy of the demo with a stories file, against a recording backend, so it needs no native library),
 * and the screenshots compared with the stored ones (which need the headless librge, and are skipped without it).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RecordingBackend, type Player } from "@rge/player";
import { Text, type GameObject } from "@rge/runtime";
import { libraryFileName, nativeLibrary } from "@rge/native";
import { compareScreenshots, loadPreviews, pixelDifference, previewWithReload } from "../src/preview.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const gameDir = join(repo, ".test-output", `preview-demo-${process.pid}`);

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

function texts(root: GameObject): string[] {
  const out: string[] = [];
  const walk = (object: GameObject): void => {
    if (object instanceof Text) out.push(object.text);
    object.children.forEach(walk);
  };
  walk(root);
  return out;
}

const STORIES = `import { stories, story } from "@rge/player";
import { CoinCounter } from "../generated/CoinCounter.ts";
import { useGame } from "../src/GameState.ts";

export default stories(CoinCounter, { size: [80, 20] });
export const Some = story({}, { setup: () => useGame.setState({ stats: { coins: 3, hits: 0 } }) });
export const Many = story({}, { setup: () => useGame.setState({ stats: { coins: 70, hits: 0 } }) });
`;

describe("rge preview", () => {
  it("shows one story at a time, switches with F6 and F5, and hot reloads the shown story", async () => {
    mkdirSync(gameDir, { recursive: true });
    for (const name of ["src", "assets", "main.ts", "game.ts", "package.json", "tsconfig.json"]) cpSync(join(repo, "packages/demo", name), join(gameDir, name), { recursive: true });
    mkdirSync(join(gameDir, "stories"));
    writeFileSync(join(gameDir, "stories/CoinCounter.stories.ts"), STORIES);
    const counterFile = join(gameDir, "src/CoinCounter.tsx");
    const original = readFileSync(counterFile, "utf8");

    const backend = new PacedBackend();
    const logs: string[] = [];
    const label = (): string | undefined => {
      for (const r of backend.lastFrame.records) if (r.op === "text" && r.text.startsWith("CoinCounter/")) return r.text;
      return undefined;
    };
    const steps: ((player: Player) => void)[] = [
      // The first story by name. F6 goes to the next.
      (player) => {
        assert.deepEqual(texts(player.world.root), ["Coins: 70"]);
        backend.queueInput({ pressed: ["F6"] });
      },
      // The second. Edit the component.
      (player) => {
        assert.deepEqual(texts(player.world.root), ["Coins: 3"]);
        writeFileSync(counterFile, original.replace("Coins: {coins}", "Gold: {coins}"));
      },
      // The same story, with the new code and its label over it. F5 goes back to the first.
      (player) => {
        assert.deepEqual(texts(player.world.root), ["Gold: 3"]);
        assert.match(label() ?? "", /^CoinCounter\/Some {3}2 of 2/);
        backend.queueInput({ pressed: ["F5"] });
      },
      (player) => {
        assert.deepEqual(texts(player.world.root), ["Gold: 70"]);
        backend.queueInput({ quit: true });
      },
    ];
    let failure: unknown = null;
    const result = await previewWithReload(backend, {
      gameDir,
      log: (message) => logs.push(message),
      observe: (_event, player) => {
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
    assert.equal(steps.length, 0, logs.join("\n"));
    assert.equal(result.failed, false);
    assert.ok(logs.includes("preview: CoinCounter/Some  (2 of 2; F5 F6 switch)"), logs.join("\n"));
  });

  it("counts the pixels that differ beyond a tolerance, and says when the sizes differ", () => {
    const a = { width: 2, height: 1, rgba: new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]) };
    const b = { width: 2, height: 1, rgba: new Uint8Array([0, 0, 0, 255, 14, 10, 10, 255]) };
    assert.equal(pixelDifference(a, a), 0);
    assert.equal(pixelDifference(a, b), 1);
    assert.equal(pixelDifference(a, b, 4), 0);
    assert.equal(pixelDifference(a, { width: 1, height: 2, rgba: a.rgba }), "2 × 1 now, 1 × 2 stored");
  });

  // The stored pictures are the software renderer's: the OpenGL build blends translucent colours a little differently, so only
  // the headless build is compared (as `rge check` does).
  const headless = nativeLibrary("headless") ?? [join(repo, "native/build-headless", libraryFileName())].find((path) => existsSync(path)) ?? null;
  it("renders Hearth's stories as their stored screenshots", { skip: headless === null ? "the headless librge is not built" : false }, async () => {
    const hearth = join(repo, "packages/hearth");
    const cwd = process.cwd();
    const before = process.env["RGE_NATIVE_LIB"];
    process.env["RGE_NATIVE_LIB"] = headless!;
    process.chdir(hearth);
    const out = mkdtempSync(join(tmpdir(), "rge-previews-"));
    try {
      const previews = await loadPreviews(hearth);
      assert.ok(previews.stories.length >= 10, `${previews.stories.length} stories`);
      assert.deepEqual(compareScreenshots(hearth, previews, out), [], `the pictures as they are now are in ${out}`);
      rmSync(out, { recursive: true, force: true });
    } finally {
      process.chdir(cwd);
      if (before === undefined) delete process.env["RGE_NATIVE_LIB"];
      else process.env["RGE_NATIVE_LIB"] = before;
    }
  });
});
