import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createControls, createMemoryStorage, createSave, createSettings as makeSettings, getVolume, setStorage, setVolume, Sound, setSoundSink, type SoundSink } from "../src/index.ts";

const made: { dispose(): void }[] = [];
/** `createSettings`, remembering each store so the next test does not reload it. */
const createSettings: typeof makeSettings = (options) => {
  const store = makeSettings(options);
  made.push(store);
  return store;
};

afterEach(() => {
  for (const store of made.splice(0)) store.dispose();
  setStorage(null);
  setVolume("music", 1);
  setVolume("effects", 1);
  setSoundSink(null);
});

interface Data {
  map: string;
  items: string[];
  opened?: number[];
}

function makeSave(state: { current: Data }, warnings: string[], version = 2) {
  return createSave<Data>({
    name: "save",
    version,
    pick: () => state.current,
    apply: (data) => void (state.current = data),
    migrate: { 1: (old: Data) => ({ ...old, opened: [] }) },
    warn: (m) => warnings.push(m),
  });
}

describe("createSave", () => {
  it("round trips what pick returns, as { version, data }", () => {
    const memory = createMemoryStorage();
    setStorage(memory);
    const state: { current: Data } = { current: { map: "cave", items: ["lantern"], opened: [1] } };
    const save = makeSave(state, []);
    assert.equal(save.exists(), false);
    assert.equal(save.write(), true);
    assert.equal(save.exists(), true);
    assert.deepEqual(JSON.parse(memory.entries.get("save") as string), { version: 2, data: { map: "cave", items: ["lantern"], opened: [1] } });
    state.current = { map: "other", items: [] };
    assert.equal(save.load(), true);
    assert.deepEqual(state.current, { map: "cave", items: ["lantern"], opened: [1] });
    save.remove();
    assert.equal(save.exists(), false);
    assert.equal(save.load(), false);
  });

  it("migrates an older version up, step by step", () => {
    setStorage(createMemoryStorage({ save: JSON.stringify({ version: 1, data: { map: "house", items: ["key"] } }) }));
    const state = { current: { map: "", items: [] } as Data };
    assert.equal(makeSave(state, []).load(), true);
    assert.deepEqual(state.current, { map: "house", items: ["key"], opened: [] });
  });

  it("refuses a save from a newer version, saying so once, and leaves the state alone", () => {
    setStorage(createMemoryStorage({ save: JSON.stringify({ version: 9, data: {} }) }));
    const state = { current: { map: "start", items: [] } as Data };
    const warnings: string[] = [];
    const save = makeSave(state, warnings);
    assert.equal(save.load(), false);
    assert.equal(save.load(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] as string, /newer version of the game/);
    assert.equal(state.current.map, "start");
  });

  it("reads a file that does not parse as no save, saying so once", () => {
    for (const text of ["{ not json", "[]", '{"version":"two","data":1}', "{\"data\":1}"]) {
      setStorage(createMemoryStorage({ save: text }));
      const warnings: string[] = [];
      const save = makeSave({ current: { map: "", items: [] } }, warnings);
      assert.equal(save.load(), false, text);
      assert.equal(warnings.length, 1, text);
    }
  });

  it("fails a migration that is missing, without applying half a save", () => {
    setStorage(createMemoryStorage({ save: JSON.stringify({ version: 0, data: {} }) }));
    const warnings: string[] = [];
    const state = { current: { map: "keep", items: [] } as Data };
    assert.equal(makeSave(state, warnings).load(), false);
    assert.match(warnings[0] as string, /no migration from version 0/);
    assert.equal(state.current.map, "keep");
  });

  it("does nothing, and says nothing, with no storage installed", () => {
    const save = makeSave({ current: { map: "", items: [] } }, []);
    assert.equal(save.write(), false);
    assert.equal(save.exists(), false);
    assert.equal(save.load(), false);
  });
});

describe("createSettings", () => {
  const defaults = { music: 0.6, effects: 0.8, fullscreen: false, bindings: null as Record<string, string[]> | null, hints: true };

  it("starts from the defaults, applies and keeps what set changes, and reads it back from a new store", () => {
    const memory = createMemoryStorage();
    setStorage(memory);
    const controls = createControls({ jump: ["Z"], dash: ["X"] });
    const settings = createSettings({ name: "settings", defaults, controls });
    assert.deepEqual(settings.get(), defaults);
    assert.equal(settings.set({ music: 0.2, hints: false }), true);
    assert.equal(getVolume("music"), 0.2);
    assert.equal(settings.get().hints, false);
    const stored = JSON.parse(memory.entries.get("settings") as string) as { version: number; data: typeof defaults };
    assert.equal(stored.version, 1);
    assert.equal(stored.data.music, 0.2);

    // "A next run": volumes forgotten, a new store reads the file when storage is installed.
    setVolume("music", 1);
    const again = createSettings({ name: "settings", defaults, controls });
    setStorage(memory);
    assert.equal(again.get().music, 0.2);
    assert.equal(getVolume("music"), 0.2, "applied when storage is installed, before anything is drawn");
    assert.equal(getVolume("effects"), 0.8);
  });

  it("applies bindings to the controls, and a reset puts both back", () => {
    const memory = createMemoryStorage();
    setStorage(memory);
    const controls = createControls({ jump: ["Z"], dash: ["X"] });
    const settings = createSettings({ name: "settings", defaults, controls });
    settings.set({ bindings: { jump: ["Space"] } });
    assert.deepEqual(controls.keysOf("jump"), ["Space"]);
    assert.deepEqual(controls.keysOf("dash"), ["X"]);
    settings.reset();
    assert.deepEqual(controls.keysOf("jump"), ["Z"]);
    assert.equal(settings.get().bindings, null);
  });

  it("goes full screen through the sink, and ignores wrong types and unknown keys in the file", () => {
    const memory = createMemoryStorage({ settings: JSON.stringify({ version: 1, data: { music: "loud", effects: 0.1, fullscreen: true, extra: 5 } }) });
    const calls: boolean[] = [];
    const settings = createSettings({ name: "settings", defaults });
    setStorage({ ...memory, setFullscreen: (on) => (calls.push(on), true) });
    assert.equal(settings.get().music, 0.6, "a wrong type is the default");
    assert.equal(settings.get().effects, 0.1);
    assert.deepEqual(calls, [true]);
    assert.equal("extra" in settings.get(), false);
  });

  it("tells a subscriber each change, once applied, so the game state can show it", () => {
    setStorage(createMemoryStorage());
    const controls = createControls({ jump: ["Z"] });
    const settings = createSettings({ name: "settings", defaults, controls });
    const seen: [number, string][] = [];
    const stop = settings.subscribe((values) => seen.push([values.music, controls.keysOf("jump")?.[0] ?? ""]));
    settings.set({ music: 0.3, bindings: { jump: ["Space"] } });
    settings.reset();
    stop();
    settings.set({ music: 0.9 });
    assert.deepEqual(seen, [[0.3, "Space"], [0.6, "Z"]], "the controls are already rebound when it is called; nothing after stop");
    settings.dispose();
  });

  it("types a setting from its default, so a `false` default can be set to true", () => {
    setStorage(createMemoryStorage());
    const settings = createSettings({ name: "settings", defaults: { fullscreen: false, hints: true } });
    settings.set({ fullscreen: true, hints: false }); // type-checked by `npm run typecheck`
    assert.equal(settings.get().fullscreen, true);
    settings.dispose();
  });

  it("says once that a file does not parse, and uses the defaults", () => {
    setStorage(createMemoryStorage({ settings: "garbage" }));
    const warnings: string[] = [];
    const settings = createSettings({ name: "settings", defaults, warn: (m) => warnings.push(m) });
    setStorage(createMemoryStorage({ settings: "garbage" }));
    settings.reload();
    assert.deepEqual(settings.get(), defaults);
    assert.equal(warnings.length, 1);
  });
});

describe("volume groups", () => {
  it("multiply the volume of every sound by the effects volume", () => {
    const played: number[] = [];
    const sink: SoundSink = { load() {}, play: (_path, volume) => void played.push(volume) };
    setSoundSink(sink);
    const sound = new Sound("hit.wav");
    sound.play();
    setVolume("effects", 0.5);
    sound.play();
    sound.play(0.5);
    assert.deepEqual(played, [1, 0.5, 0.25]);
    assert.equal(sound.plays, 3, "counts every play, whatever the volume");
  });

  it("clamp to 0 to 1 and ignore what is not a number", () => {
    setVolume("music", 3);
    assert.equal(getVolume("music"), 1);
    setVolume("music", -2);
    assert.equal(getVolume("music"), 0);
    setVolume("music", Number.NaN);
    assert.equal(getVolume("music"), 0);
  });
});
