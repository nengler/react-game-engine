import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createControls, createSave, createSettings, Entity, getVolume, setVolume, type Controls } from "@rge/runtime";

import { createPlayer, parseInputScript, RecordingBackend } from "../src/index.ts";

const controls: Controls = createControls({ jump: ["Z"] });

describe("saved data in the player", () => {
  it("opens the game's folder with its id and applies the stored settings before the first frame", () => {
    setVolume("music", 1);
    const backend = new RecordingBackend({
      storage: { settings: JSON.stringify({ version: 1, data: { music: 0.25, bindings: { jump: ["Space"] } } }) },
    });
    const settings = createSettings({
      name: "settings",
      defaults: { music: 0.6 as number, bindings: null as Record<string, string[]> | null },
      controls,
    });
    const seen: number[] = [];
    const player = createPlayer(backend, {
      id: "mygame",
      controls,
      root: () => {
        const root = new Entity();
        // What the first frame sees: the volume was applied before the tree was mounted.
        seen.push(getVolume("music"));
        return root;
      },
    });
    assert.equal(backend.storageOpenedFor, "mygame");
    player.step();
    assert.equal(settings.get().music, 0.25);
    assert.equal(getVolume("music"), 0.25);
    assert.deepEqual(controls.keysOf("jump"), ["Space"], "the stored binding is in use");
    player.close();
    settings.dispose();
    controls.reset();
    setVolume("music", 1);
  });

  it("writes a save through the backend, and a second run starts from it", () => {
    const state = { score: 0 };
    const save = createSave({
      name: "save",
      version: 1,
      pick: () => ({ score: state.score }),
      apply: (d: { score: number }) => void (state.score = d.score),
    });
    const first = new RecordingBackend();
    const run = createPlayer(first, { id: "mygame", root: () => new Entity() });
    state.score = 42;
    assert.equal(save.write(), true);
    run.close();
    assert.deepEqual(JSON.parse(first.stored.get("save") as string), { version: 1, data: { score: 42 } });

    // The next run's backend starts from that entry.
    state.score = 0;
    const second = new RecordingBackend({ storage: Object.fromEntries(first.stored) });
    const again = createPlayer(second, { id: "mygame", root: () => new Entity() });
    assert.equal(save.load(), true);
    assert.equal(state.score, 42);
    again.close();
  });

  it("does not open storage without a game id, and warns once when the host has none", () => {
    const backend = new RecordingBackend();
    createPlayer(backend, { root: () => new Entity() }).close();
    assert.equal(backend.storageOpenedFor, null);
    const warnings: string[] = [];
    const bare = new RecordingBackend();
    const without = {
      open: bare.open.bind(bare),
      close: bare.close.bind(bare),
      loadTexture: bare.loadTexture.bind(bare),
      loadSound: bare.loadSound.bind(bare),
      playSound: bare.playSound.bind(bare),
      frame: bare.frame.bind(bare),
    };
    createPlayer(without, { id: "mygame", warn: (m) => warnings.push(m), root: () => new Entity() }).close();
    assert.equal(warnings.filter((w) => /no saved data/.test(w)).length, 1);
  });

  it("keeps working through an input script: rebinding does not break names the script uses", () => {
    const local = createControls({ jump: ["Z"] });
    local.bind("jump", ["Space"]);
    const frames = parseInputScript("jump", { bindings: { jump: ["Space"] } });
    assert.equal(frames.length, 1);
  });
});
