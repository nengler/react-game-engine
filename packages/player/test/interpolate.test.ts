import assert from "node:assert/strict";
/**
 * Drawing between fixed steps (`<Game interpolate>`): a frame is drawn a fraction of the way from the step before last to the last
 * step, and the game itself only ever sees whole steps.
 */
import { describe, it } from "node:test";

import { Camera, Entity, Shape, type GameObject } from "@tsengine/runtime";

import { INTERPOLATE_SNAP } from "../src/interpolate.ts";
import { createPlayer, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

const STEP = 1 / 60;

/** A 10 × 10 square that moves `speed` pixels right each step (by its transform, or by its placement), logging where its step saw it. */
class Mover extends Entity {
  readonly seen: number[] = [];
  readonly speed: number;
  readonly byPlacement: boolean;
  /** Steps at which it jumps by `jump` pixels instead. */
  jumpAt = -1;
  jump = 0;
  steps = 0;
  constructor(speed: number, byPlacement = false) {
    super();
    this.speed = speed;
    this.byPlacement = byPlacement;
    this.addChild(new Shape({ kind: "rect", width: 10, height: 10, color: "white" }));
  }
  override onUpdate(): void {
    const at = this.byPlacement ? this.placement : this.transform;
    this.seen.push(at.x);
    this.steps++;
    at.x += this.steps === this.jumpAt ? this.jump : this.speed;
    this.markMoved();
  }
}

function rects(records: readonly DecodedRecord[]): number[] {
  return records.flatMap((r) => (r.op === "rect" ? [r.x] : []));
}

/** Run `frames` frames of `frameDt` with `root`, returning the x of the first rect drawn in each frame. */
function play(root: () => GameObject, frames: number, frameDt: number, config: Partial<PlayerConfig> = {}): number[] {
  const backend = new RecordingBackend();
  const player = createPlayer(backend, {
    width: 100,
    height: 100,
    title: "interpolate",
    hidden: true,
    fixedStep: 60,
    interpolate: true,
    retain: "check",
    root,
    ...config,
  });
  for (let i = 0; i < frames; i++) backend.queueInput({ dt: frameDt });
  for (let i = 0; i < frames; i++) player.step();
  player.close();
  return backend.frames.map((f) => rects(f.records)[0] as number);
}

describe("interpolation under a fixed step", () => {
  it("draws a 120 Hz frame halfway between two 60 Hz steps, one step behind", () => {
    const xs = play(() => new Mover(6), 9, STEP / 2);
    // The first frame has no time; then frames 2, 4, 6 and 8 run a step. Each step's frame draws the step before (alpha 0) and the
    // frame after it is halfway to the step: 3 pixels a frame. The first step has nothing before it, so it is drawn as it is.
    assert.deepEqual(xs, [0, 0, 6, 6, 6, 9, 12, 15, 18]);
  });

  it("blends a placement as well as a transform", () => {
    const xs = play(() => new Mover(6, true), 8, STEP / 2);
    assert.deepEqual(xs, [0, 0, 6, 6, 6, 9, 12, 15]);
  });

  it("leaves the game's own state alone: every step sees whole steps, as without interpolation", () => {
    let blended: Mover | null = null;
    let plain: Mover | null = null;
    play(() => (blended = new Mover(6)), 15, STEP / 2.5);
    play(() => (plain = new Mover(6)), 15, STEP / 2.5, { interpolate: false });
    assert.ok(blended !== null && plain !== null);
    const a = blended as Mover;
    const b = plain as Mover;
    assert.deepEqual(a.seen, b.seen);
    assert.deepEqual(a.seen, [0, 6, 12, 18, 24]);
    assert.equal(a.transform.x, b.transform.x);
  });

  it("draws the latest step with interpolate off, or by default in a hidden window", () => {
    assert.deepEqual(
      play(() => new Mover(6), 6, STEP / 2, { interpolate: false }),
      [0, 0, 6, 6, 12, 12]
    );
    assert.deepEqual(
      play(() => new Mover(6), 6, STEP / 2, { interpolate: undefined }),
      [0, 0, 6, 6, 12, 12]
    );
  });

  it("does not blend a jump further than INTERPOLATE_SNAP: it is drawn where it lands", () => {
    const xs = play(
      () => {
        const m = new Mover(6);
        m.jumpAt = 2;
        m.jump = INTERPOLATE_SNAP + 1;
        return m;
      },
      8,
      STEP / 2
    );
    // Step 2 (frame 4) jumps from 6 to 71: frames 4 and 5 draw 71, not 6 and 38.5. Step 3 moves on by 6, which is blended again.
    assert.deepEqual(xs, [0, 0, 6, 6, 71, 71, 71, 74]);
  });

  it("blends a camera's smoothing, and leaves the camera as the steps left it", () => {
    const run = (interpolate: boolean): { views: number[]; camera: Camera } => {
      let camera: Camera | null = null;
      const backend = new RecordingBackend();
      const player = createPlayer(backend, {
        width: 100,
        height: 100,
        title: "camera",
        hidden: true,
        fixedStep: 60,
        interpolate,
        retain: "check",
        root: () => {
          const root = new Entity();
          camera = new Camera({ smoothing: 0.1 });
          camera.addChild(new Mover(6));
          root.addChild(camera);
          return root;
        },
      });
      for (let i = 0; i < 12; i++) backend.queueInput({ dt: STEP / 2 });
      for (let i = 0; i < 12; i++) player.step();
      player.close();
      const views = backend.frames.flatMap((f) => f.records.flatMap((r) => (r.op === "view" ? [r.e] : [])).slice(0, 1));
      return { views, camera: camera as unknown as Camera };
    };
    const blended = run(true);
    const plain = run(false);
    // Without interpolation the view holds still on every frame with no step; with it, it moves on every frame once moving.
    const moves = (views: number[]): number => views.slice(5).filter((e, i) => e !== views[4 + i]).length;
    assert.equal(moves(plain.views), 3, `plain: ${plain.views}`);
    assert.equal(moves(blended.views), 7, `blended: ${blended.views}`);
    // And the camera ends where a run without interpolation leaves it: drawing changed nothing the next step would see.
    assert.deepEqual(blended.camera.saveView(), plain.camera.saveView());
  });

  it("moves a camera to new bounds, and slides it there, as a run without interpolation does (the collisions place no frame)", () => {
    // With interpolation the step's colliders are found without a build, and the frame is drawn from blended transforms and put back:
    // what the camera remembers of its view (a change of bounds, which starts the slide) must still move on each step.
    class Door extends Entity {
      steps = 0;
      readonly camera: Camera;
      constructor(camera: Camera) {
        super();
        this.camera = camera;
      }
      override onUpdate(): void {
        if (++this.steps === 4) {
          this.camera.bounds = [400, 0, 320, 180];
          this.camera.markChanged();
        }
      }
    }
    const run = (interpolate: boolean): string[] => {
      let camera: Camera | null = null;
      const views: string[] = [];
      const backend = new RecordingBackend();
      const player = createPlayer(backend, {
        width: 100,
        height: 100,
        title: "camera bounds",
        hidden: true,
        fixedStep: 60,
        interpolate,
        // Not "check": that builds for the collisions too, which would move the camera on as before.
        root: () => {
          const root = new Entity();
          camera = new Camera({ bounds: [0, 0, 320, 180], slide: 0.2 });
          camera.addChild(new Mover(3));
          root.addChild(camera);
          root.addChild(new Door(camera));
          return root;
        },
      });
      for (let i = 0; i < 20; i++) backend.queueInput({ dt: STEP });
      for (let i = 0; i < 20; i++) {
        player.step();
        views.push(JSON.stringify((camera as unknown as Camera).saveView()));
      }
      player.close();
      return views;
    };
    const blended = run(true);
    const plain = run(false);
    assert.deepEqual(blended, plain);
    assert.notEqual(plain[3], plain[6], "the bounds changed and the view moved");
  });
});
