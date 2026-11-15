import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, freeze, Game, type InputState } from "@tsengine/runtime";

import {
  createPlayer,
  FixedDriver,
  MAX_STEPS_PER_FRAME,
  RecordingBackend,
  TSE_KEY_DOWN,
  TSE_KEY_PRESSED,
  TSE_KEY_RELEASED,
  type InputFrame,
  type PlayerConfig,
} from "../src/index.ts";

/** Records what each tick of it saw. */
class Probe extends Entity {
  readonly dts: number[] = [];
  readonly saw: string[] = [];
  override onInput(input: InputState): void {
    this.saw.push(`${input.down("Space") ? "d" : "-"}${input.pressed("Space") ? "p" : "-"}${input.released("Space") ? "r" : "-"}`);
  }
  override onUpdate(dt: number): void {
    this.dts.push(dt);
  }
}

function run(frames: readonly InputFrame[], config: Partial<PlayerConfig> = { fixedStep: 60 }): Probe {
  const backend = new RecordingBackend();
  const probe = new Probe();
  for (const f of frames) backend.queueInput(f);
  const player = createPlayer(backend, { root: () => probe, ...config });
  for (let i = 0; i <= frames.length; i++) player.step(); // the first step has no input yet
  player.close();
  return probe;
}

const idle = (n: number, dt: number): InputFrame[] => Array.from({ length: n }, () => ({ dt }));

describe("fixed timestep", () => {
  it("runs one step per frame of 1/60 s, each with dt 1/60, however many frames there are", () => {
    const probe = run(idle(600, 1 / 60));
    assert.equal(probe.dts.length, 600, "no step lost to rounding (the warm-up frame has dt 0)");
    assert.ok(probe.dts.every((d) => d === 1 / 60));
  });

  it("runs two steps for a slow frame and none for a fast one", () => {
    assert.equal(run(idle(10, 1 / 30)).dts.length, 20);
    const fast = run(idle(10, 1 / 120));
    assert.equal(fast.dts.length, 5, "a step every second frame");
  });

  it("carries the leftover time to the next frame", () => {
    // 1/45 s is a step and a third: three frames are exactly four steps.
    const probe = run(idle(3, 1 / 45));
    assert.equal(probe.dts.length, 4);
  });

  it("caps a stall to a few steps and forgets the rest", () => {
    const probe = run(idle(1, 5));
    assert.ok(probe.dts.length <= MAX_STEPS_PER_FRAME);
    assert.equal(run([{ dt: 5 }, { dt: 1 / 60 }]).dts.length, 6 + 1 + 0, "0.1 s is clamped to 6 steps; then one step; no burst after");
  });

  it("is off unless asked for: one update per frame with the frame's own time", () => {
    const probe = run([{ dt: 0.02 }, { dt: 0.05 }], {});
    assert.deepEqual(probe.dts, [0, 0.02, 0.05]);
  });

  it("shows a press to exactly one step, even when the frame has two or none", () => {
    // Frame with two steps (dt 1/30): the press is in the first only.
    const two = run([
      { dt: 1 / 30, pressed: ["Space"] },
      { dt: 1 / 30, down: ["Space"] },
      { dt: 1 / 30, released: ["Space"] },
    ]);
    assert.deepEqual(two.saw, ["dp-", "d--", "d--", "d--", "--r", "---"]);
    // A press on a frame that runs no step (a 120 Hz frame) is seen by the next step.
    const none = run([
      { dt: 1 / 120, pressed: ["Space"] },
      { dt: 1 / 120, down: ["Space"] },
      { dt: 1 / 120, down: ["Space"] },
    ]);
    assert.equal(none.saw.filter((s) => s[1] === "p").length, 1, "seen once");
    assert.equal(
      none.saw.findIndex((s) => s[1] === "p"),
      none.saw.findIndex((s) => s[0] === "d"),
      "and the key is down for that step"
    );
  });

  it("does not lose a tap that was released before the step ran", () => {
    const tap = run([{ dt: 1 / 120, pressed: ["Space"] }, { dt: 1 / 120, released: ["Space"] }, { dt: 1 / 120 }]);
    assert.deepEqual(
      tap.saw.filter((s) => s !== "---"),
      ["dpr"],
      "down, pressed and released in the one step"
    );
  });

  it("rejects a rate that is not positive", () => {
    assert.throws(() => run([], { fixedStep: 0 }), /fixedStep/);
  });
});

describe("<Game timeScale paused>", () => {
  /** A `<Game fixedStep={60}>` root holding a probe, run frame by frame; `between(i, game)` may change the game's props. */
  function runGame(frames: readonly InputFrame[], between: (frame: number, game: Game) => void): Probe {
    const backend = new RecordingBackend();
    const probe = new Probe();
    const game = new Game({ fixedStep: 60 });
    game.addChild(probe);
    for (const f of frames) backend.queueInput(f);
    const player = createPlayer(backend, { root: () => game });
    for (let i = 0; i <= frames.length; i++) {
      between(i, game);
      player.step();
    }
    player.close();
    return probe;
  }

  it("timeScale 2 runs two steps a frame, each the same dt: a fast-forward that plays the game exactly as at 1", () => {
    const probe = runGame(idle(10, 1 / 60), (_, game) => (game.timeScale = 2));
    assert.equal(probe.dts.length, 20);
    assert.ok(probe.dts.every((d) => d === 1 / 60));
  });

  it("is read every frame, so it may change while the game runs", () => {
    const probe = runGame(idle(10, 1 / 60), (i, game) => (game.timeScale = i <= 5 ? 1 : 2));
    assert.equal(probe.dts.length, 5 + 2 * 5);
  });

  it("paused stops every update, while input still reaches the game (a pause menu can unpause it)", () => {
    const probe = runGame(
      [...idle(3, 1 / 60), { dt: 1 / 60, pressed: ["Space"] }, ...idle(3, 1 / 60)],
      (i, game) => (game.paused = i >= 2 && i < 6)
    );
    assert.equal(probe.dts.length, 3, "two steps before the pause, one after");
    assert.ok(probe.saw.includes("dp-"), "the press during the pause was seen by onInput");
  });
});

describe("FixedDriver, without a player", () => {
  const PRESSED = TSE_KEY_DOWN | TSE_KEY_PRESSED;
  /** Runs frames of `dt` through a one-key driver; `frozen` says which steps (counting from 0) are frozen. Returns what each step's input and update saw. */
  function drive(frames: readonly { dt: number; keys: number }[], frozen: (step: number) => boolean = () => false) {
    const driver = new FixedDriver(60, 1);
    const log: { input: number; update: number; frozen: boolean }[] = [];
    for (const f of frames) {
      driver.advance(f.dt, Uint8Array.of(f.keys), (input, update) => {
        const isFrozen = frozen(log.length);
        log.push({ input: input[0] as number, update: update[0] as number, frozen: isFrozen });
        return isFrozen;
      });
    }
    return log;
  }

  it("runs the steps a frame holds, as the player does", () => {
    assert.equal(drive(Array.from({ length: 600 }, () => ({ dt: 1 / 60, keys: 0 }))).length, 600);
    assert.equal(drive(Array.from({ length: 10 }, () => ({ dt: 1 / 30, keys: 0 }))).length, 20);
    assert.equal(drive([{ dt: 5, keys: 0 }]).length, MAX_STEPS_PER_FRAME);
  });

  it("rejects a rate that is not positive", () => {
    assert.throws(() => new FixedDriver(0, 1), /fixedStep/);
    assert.throws(() => new FixedDriver(Number.NaN, 1), /fixedStep/);
  });

  it("keeps the edges of frozen steps for the first step after, and shows them to input only once", () => {
    // Steps 0 and 1 are frozen; the press is made in step 1.
    const log = drive(
      [
        { dt: 1 / 60, keys: 0 },
        { dt: 1 / 60, keys: PRESSED },
        { dt: 1 / 60, keys: TSE_KEY_DOWN },
        { dt: 1 / 60, keys: 0 },
      ],
      (n) => n < 2
    );
    assert.deepEqual(
      log.map((l) => (l.input & TSE_KEY_PRESSED) !== 0),
      [false, true, false, false],
      "input sees it in the step it was made"
    );
    assert.deepEqual(
      log.map((l) => (l.update & TSE_KEY_PRESSED) !== 0),
      [false, true, true, false],
      "update sees it in the first step after the freeze, and not again"
    );
  });

  it("keeps a release made in a freeze too, and drops what is kept once a step has run", () => {
    const log = drive(
      [
        { dt: 1 / 60, keys: TSE_KEY_RELEASED },
        { dt: 1 / 60, keys: 0 },
        { dt: 1 / 60, keys: 0 },
      ],
      (n) => n === 0
    );
    assert.deepEqual(
      log.map((l) => (l.update & TSE_KEY_RELEASED) !== 0),
      [true, true, false]
    );
  });

  it("clones its state, so a replay can branch", () => {
    const a = new FixedDriver(60, 1);
    a.advance(1 / 120, Uint8Array.of(PRESSED), () => false); // no step yet: the edge and half a step wait
    const b = a.clone();
    let seen = 0;
    a.advance(1 / 120, Uint8Array.of(0), (input) => ((seen = input[0] as number), false));
    assert.ok((seen & TSE_KEY_PRESSED) !== 0);
    seen = 0;
    b.advance(1 / 120, Uint8Array.of(0), (input) => ((seen = input[0] as number), false));
    assert.ok((seen & TSE_KEY_PRESSED) !== 0, "the copy had its own");
  });
});

describe("a freeze in the player", () => {
  it("shows onUpdate a press made during the freeze in the first step after it, and onInput only once", () => {
    const saw: string[] = [];
    class Pressed extends Entity {
      override onInput(input: InputState): void {
        saw.push(`in:${input.pressed("Space") ? "p" : "-"}`);
      }
      override onUpdate(_dt: number, input?: InputState): void {
        saw.push(`up:${input?.pressed("Space") ? "p" : "-"}`);
      }
    }
    const backend = new RecordingBackend();
    backend.queueInput({ dt: 1 / 60 }); // runs, and starts the freeze
    backend.queueInput({ dt: 1 / 60, pressed: ["Space"] }); // frozen
    backend.queueInput({ dt: 1 / 60 }); // frozen
    backend.queueInput({ dt: 1 / 60 }); // the first step after
    const player = createPlayer(backend, { fixedStep: 60, root: () => new Pressed() });
    player.step(); // the first step has no input yet
    freeze(2);
    for (let i = 0; i < 4; i++) player.step();
    player.close();
    assert.deepEqual(saw, ["in:-", "up:-", "in:p", "in:-", "in:-", "up:p"]);
  });
});
