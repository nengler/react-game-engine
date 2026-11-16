import assert from "node:assert/strict";
/**
 * Input helpers for game feel: `pressedWithin` and `consumePress` (an input buffer), `grace` (coyote time) and `pressHandled` (a click
 * a button took, which the world should not also act on).
 */
import { describe, it } from "node:test";

import { createControls, createInputState, Entity, grace, Pointer, type InputState } from "@tsengine/runtime";

import { createPlayer, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend, type InputFrame } from "../src/recording.ts";

const STEP = 1 / 60;

/** Calls `look` with the input in every `useUpdate`, logging what it returns. */
class Probe extends Entity {
  readonly log: unknown[] = [];
  readonly look: (input: InputState) => unknown;
  constructor(look: (input: InputState) => unknown) {
    super();
    this.look = look;
  }
  override onUpdate(_dt: number, input?: InputState): void {
    this.log.push(this.look(input as InputState));
  }
}

function run(frames: readonly InputFrame[], root: () => Entity, config: Partial<PlayerConfig> = {}): void {
  const backend = new RecordingBackend();
  for (const f of frames) backend.queueInput(f);
  const player = createPlayer(backend, { width: 100, height: 100, title: "feel", hidden: true, root, ...config });
  for (let i = 0; i < frames.length; i++) player.step();
  player.close();
}

const idle = (n: number, dt = STEP): InputFrame[] => Array.from({ length: n }, () => ({ dt }));

describe("pressedWithin and consumePress", () => {
  it("sees a press for its window of game time, the step of the press included", () => {
    let probe: Probe | null = null;
    run([{ dt: STEP, pressed: ["Z"] }, ...idle(9)], () => (probe = new Probe((input) => input.pressedWithin("Z", 0.1))));
    // The first frame has no time (the player's first step), so the press is seen by the second step. 0.1 s is 6 steps of 1/60.
    assert.deepEqual((probe as unknown as Probe).log, [false, true, true, true, true, true, true, true, false, false]);
  });

  it("is pressed() with a window of 0, and never with a negative one", () => {
    let probe: Probe | null = null;
    run(
      [{ dt: STEP, pressed: ["Z"] }, ...idle(2)],
      () => (probe = new Probe((input) => [input.pressedWithin("Z", 0), input.pressedWithin("Z", -1)]))
    );
    assert.deepEqual((probe as unknown as Probe).log, [
      [false, false],
      [true, false],
      [false, false],
    ]);
  });

  it("stops seeing a press once it is consumed, and sees the next one", () => {
    let probe: Probe | null = null;
    run([{ dt: STEP, pressed: ["Z"] }, ...idle(2), { dt: STEP, pressed: ["Z"] }, ...idle(1)], () => {
      let jumps = 0;
      probe = new Probe((input) => {
        if (input.pressedWithin("Z", 0.1)) {
          jumps++;
          input.consumePress("Z");
        }
        return jumps;
      });
      return probe;
    });
    assert.deepEqual((probe as unknown as Probe).log, [0, 1, 1, 1, 2]);
  });

  it("answers for an action: any of its keys, and consuming takes them all", () => {
    const controls = createControls({ jump: ["Z", "Space"] });
    let probe: Probe | null = null;
    run(
      [{ dt: STEP, pressed: ["Space"] }, ...idle(1), { dt: STEP, pressed: ["Z"] }, ...idle(1)],
      () => {
        probe = new Probe((input) => {
          const seen = input.pressedWithin("jump", 0.5);
          if (seen) input.consumePress("jump");
          return seen;
        });
        return probe;
      },
      { controls }
    );
    assert.deepEqual((probe as unknown as Probe).log, [false, true, false, true]);
  });

  it("measures by game time under a fixed step: a press between steps is seen by the next step, and the window counts steps", () => {
    let probe: Probe | null = null;
    // Frames of half a step: a step every other frame. The press lands on a frame with no step.
    run(
      [...idle(2, STEP / 2), { dt: STEP / 2, pressed: ["Z"] }, ...idle(12, STEP / 2)],
      () => (probe = new Probe((input) => input.pressedWithin("Z", 2 * STEP))),
      {
        fixedStep: 60,
      }
    );
    assert.deepEqual((probe as unknown as Probe).log, [false, true, true, true, false, false, false]);
  });

  it("works on a snapshot: createInputState sees its presses within any window until consumed", () => {
    const input = createInputState({ pressed: ["Z"] });
    assert.equal(input.pressedWithin("Z", 0), true);
    assert.equal(input.pressedWithin("X", 1), false);
    input.consumePress("Z");
    assert.equal(input.pressedWithin("Z", 1), false);
    assert.equal(input.pressed("Z"), true, "pressed is not changed by consuming");
  });
});

describe("grace", () => {
  it("holds for its seconds after the condition was last true, then is 0", () => {
    let left = 0;
    const seen: number[] = [];
    for (const onGround of [true, true, false, false, false, false, true, false]) {
      left = grace(onGround, left, 0.05, 0.1);
      seen.push(+left.toFixed(3));
    }
    assert.deepEqual(seen, [0.1, 0.1, 0.05, 0, 0, 0, 0.1, 0.05]);
    assert.equal(grace(false, 0.1, -1, 0.1), 0.1, "a negative dt counts no time");
  });
});

describe("pressHandled", () => {
  /** A 50 × 50 button at the origin and a probe logging what each step sees of the left button. */
  function clicks(frames: readonly InputFrame[], config: Partial<PlayerConfig> = {}): unknown[] {
    let probe: Probe | null = null;
    run(
      frames,
      () => {
        const root = new Entity();
        root.addChild(new Pointer({ width: 50, height: 50, onPress: () => {} }));
        probe = new Probe((input) => [input.pressed("MouseLeft"), input.pressHandled]);
        root.addChild(probe);
        return root;
      },
      config
    );
    return (probe as unknown as Probe).log;
  }

  it("is true on the step that sees a click a pointer took, and only then", () => {
    const log = clicks([
      { dt: STEP, mouse: { x: 10, y: 10 } },
      { dt: STEP, mouse: { x: 10, y: 10 }, pressed: ["MouseLeft"] },
      { dt: STEP, mouse: { x: 10, y: 10 } },
      { dt: STEP, mouse: { x: 80, y: 80 }, pressed: ["MouseLeft"] },
      { dt: STEP, mouse: { x: 80, y: 80 } },
    ]);
    // The input of a frame is what the next step sees.
    assert.deepEqual(log, [
      [false, false],
      [false, false],
      [true, true],
      [false, false],
      [true, false],
    ]);
  });

  it("waits for the next step under a fixed step, as the press itself does", () => {
    const log = clicks(
      [
        { dt: STEP / 2, mouse: { x: 10, y: 10 } },
        { dt: STEP / 2, mouse: { x: 10, y: 10 } },
        { dt: STEP / 2, mouse: { x: 10, y: 10 }, pressed: ["MouseLeft"] },
        { dt: STEP / 2, mouse: { x: 10, y: 10 } },
        { dt: STEP / 2, mouse: { x: 10, y: 10 } },
        { dt: STEP / 2, mouse: { x: 10, y: 10 } },
      ],
      { fixedStep: 60 }
    );
    assert.deepEqual(log, [
      [false, false],
      [true, true],
    ]);
  });
});
