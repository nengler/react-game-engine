/** Rewind in `rge dev` (REACT_FEEL_PLAN.md D1): record, snapshot, go back, play again, and say where a replay differs. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Sound, Text, createGameState, type InputState } from "@rge/runtime";
import { createPlayer, RecordingBackend, Rewind, type PlayerConfig } from "../src/index.ts";

interface State {
  count: number;
  add: () => void;
}
const game = createGameState<State>()((set) => ({ count: 0, add: () => set((s) => ({ count: s.count + 1 })) }));
/** Something outside the game state and the tree, which a replay cannot put back: what a game's `Math.random` would be. */
let outside = 0;

/** Counts a step on each press of Space; with `leaky`, also counts something rewind cannot see. */
class Counter extends Text {
  static readonly managed = true;
  leaky = false;
  constructor() {
    super({ text: "0" });
  }
  override onInput(input: InputState): void {
    if (input.pressed("Space")) game.getState().add();
  }
  override onUpdate(): void {
    if (this.leaky) {
      outside++;
      if (outside % 7 === 0) game.getState().add();
    }
  }
}

function run(frames: number, options: { leaky?: boolean; press?: (frame: number) => boolean } = {}) {
  game.store.reset();
  outside = 0;
  const backend = new RecordingBackend();
  for (let i = 0; i < frames; i++) backend.queueInput({ dt: 1 / 60, ...(options.press?.(i) ? { pressed: ["Space"] } : {}) });
  const stores = new Map([["test#game", game.store]]);
  const config: PlayerConfig = {
    root: () => {
      const c = new Counter();
      c.leaky = options.leaky === true;
      return c;
    },
    fixedStep: 60,
  };
  const logged: string[] = [];
  const rewind = new Rewind(backend, { config: () => config, stores: () => stores, snapshotEvery: 10, log: (m) => logged.push(m) });
  const player = createPlayer(rewind.backend, config);
  rewind.attach(player);
  const counts: number[] = [];
  for (let i = 0; i < frames; i++) {
    rewind.step();
    counts.push(game.getState().count);
  }
  return { rewind, player, counts, logged, backend };
}

describe("rewind", () => {
  it("goes back to any recorded frame and is there exactly as it was", () => {
    const { rewind, player, counts } = run(60, { press: (i) => i % 4 === 0 });
    rewind.pause();
    for (const at of [1, 9, 10, 11, 33, 59]) {
      rewind.seek(at);
      assert.equal(game.getState().count, counts[at - 1], `frame ${at}`);
      assert.equal(rewind.divergence, null);
    }
    assert.deepEqual(rewind.snapshotFrames.slice(0, 3), [0, 10, 20]);
    player.close();
  });

  it("names the first frame a replay differs at, when the game depends on something rewind cannot put back", () => {
    const { rewind, player, logged } = run(40, { leaky: true });
    rewind.pause();
    rewind.seek(35);
    assert.ok(rewind.divergence !== null && rewind.divergence > 30 && rewind.divergence <= 35, `diverged at ${rewind.divergence}`);
    assert.ok(logged.some((m) => new RegExp(`frame ${rewind.divergence} plays differently`).test(m)), logged.join("\n"));
    player.close();
  });

  it("pauses on F2, steps back with ←, draws the timeline over the paused frame, and plays on with the future dropped", () => {
    const { rewind, player, backend } = run(30, { press: (i) => i === 20 });
    backend.queueInput({ dt: 1 / 60, pressed: ["F2"] });
    rewind.step(); // the frame that reads F2
    rewind.step(); // paused: its frame is drawn again with the bar
    const paused = rewind.paused!;
    assert.ok(paused >= 31, `paused at ${paused}`);
    assert.ok(backend.lastFrame.records.some((r) => r.op === "text" && /REWIND\s+frame/.test(r.text)), "the timeline's label");
    backend.queueInput({ dt: 1 / 60, pressed: ["ArrowLeft"] });
    rewind.step();
    assert.equal(rewind.paused, paused - 1, "one frame back");
    backend.queueInput({ dt: 1 / 60, pressed: ["ArrowUp"] });
    rewind.step();
    const second = rewind.paused!;
    assert.ok(second < paused - 1, `↑ goes back a second (to ${second})`);
    backend.queueInput({ dt: 1 / 60, pressed: ["ArrowDown"] });
    rewind.step();
    assert.ok(rewind.paused! > second, "↓ goes on again");
    rewind.seek(15);
    assert.equal(game.getState().count, 0, "before the press");
    rewind.resume();
    assert.deepEqual(rewind.range, { from: 0, to: 15 }, "the recorded future is gone");
    rewind.step();
    assert.equal(rewind.range.to, 16);
    player.close();
  });

  it("plays the same frame again with new code when the game is reloaded while paused", () => {
    game.store.reset();
    const backend = new RecordingBackend();
    for (let i = 0; i < 40; i++) backend.queueInput({ dt: 1 / 60, ...(i % 5 === 0 ? { pressed: ["Space"] } : {}) });
    const stores = new Map([["test#game", game.store]]);
    /** The "new code": a press adds three. */
    class Tripler extends Counter {
      override onInput(input: InputState): void {
        if (input.pressed("Space")) for (let i = 0; i < 3; i++) game.getState().add();
      }
    }
    let config: PlayerConfig = { root: () => new Counter(), fixedStep: 60 };
    const rewind = new Rewind(backend, { config: () => config, stores: () => stores, snapshotEvery: 10 });
    const player = createPlayer(rewind.backend, config);
    rewind.attach(player);
    for (let i = 0; i < 40; i++) rewind.step();
    rewind.pause();
    rewind.seek(25);
    const before = game.getState().count;
    config = { root: () => new Tripler(), fixedStep: 60 };
    player.reload(config); // what rge dev does on a save
    rewind.reloaded();
    assert.equal(rewind.paused, 25, "still at the same frame");
    // From the snapshot at 20: the presses after it (frames 21 to 25) now add three each.
    const pressesAfter = [21, 22, 23, 24, 25].filter((k) => (k - 2) % 5 === 0).length;
    assert.equal(game.getState().count, before + 2 * pressesAfter);
    player.close();
  });

  it("plays no sound while it plays frames again", () => {
    const blip = new Sound("blip.wav");
    class Beeper extends Counter {
      override onInput(input: InputState): void {
        if (input.pressed("Space")) blip.play();
      }
    }
    const backend = new RecordingBackend();
    for (let i = 0; i < 30; i++) backend.queueInput({ dt: 1 / 60, ...(i % 3 === 0 ? { pressed: ["Space"] } : {}) });
    const config: PlayerConfig = { root: () => new Beeper(), fixedStep: 60 };
    const rewind = new Rewind(backend, { config: () => config, stores: () => new Map() });
    const player = createPlayer(rewind.backend, config);
    rewind.attach(player);
    for (let i = 0; i < 30; i++) rewind.step();
    const heard = backend.plays.length;
    assert.ok(heard >= 9, `heard ${heard}`);
    rewind.pause();
    rewind.seek(5);
    rewind.seek(28);
    assert.equal(backend.plays.length, heard, "the replays were silent");
    player.close();
  });
});
