import assert from "node:assert/strict";
/**
 * When collisions are found, relative to steps and frames. Contacts are found after every step (fixed or not), so a handler
 * runs in the step that made the contact, what it changes is drawn in that frame, and a run collides at the same steps
 * whatever the frame rate.
 */
import { describe, it } from "node:test";

import { Collider, Entity, Shape, type GameObject } from "@tsengine/runtime";

import { createPlayer, type PlayerConfig } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

const STEP = 1 / 60;

/** A 10 × 10 box that moves `speed` pixels right each step, with a white square that its own handler turns red. */
class Mover extends Entity {
  readonly square = new Shape({ kind: "rect", width: 10, height: 10, color: "white" });
  readonly log: string[];
  readonly speed: number;
  steps = 0;
  hit = false;
  constructor(log: string[], speed: number) {
    super();
    this.log = log;
    this.speed = speed;
    this.addChild(this.square);
    this.addChild(
      new Collider({
        width: 10,
        height: 10,
        tag: "mover",
        onCollisionEnter: (other) => {
          this.hit = true;
          this.square.color = "red";
          this.square.markChanged();
          log.push(`enter ${String(other.tag)} after step ${this.steps}`);
        },
        onCollisionExit: (other) => log.push(`exit ${String(other.tag)} after step ${this.steps}`),
      })
    );
  }
  override onUpdate(): void {
    this.log.push(`step ${this.steps + 1} starts${this.hit ? " (hit)" : ""}`);
    this.steps++;
    this.placement.x += this.speed;
  }
}

/** A collider of `width` at `x`, tagged `tag`. */
function zone(x: number, width: number, tag: string): GameObject {
  const at = new Entity();
  at.placement.x = x;
  at.addChild(new Collider({ width, height: 10, tag }));
  return at;
}

function play(
  frames: number,
  frameDt: number,
  speed: number,
  zones: GameObject[],
  config: Partial<PlayerConfig> = {}
): { log: string[]; mover: Mover; drawn: DecodedRecord[][] } {
  const backend = new RecordingBackend();
  for (let i = 0; i < frames; i++) backend.queueInput({ dt: frameDt });
  const log: string[] = [];
  const mover = new Mover(log, speed);
  const player = createPlayer(backend, {
    fixedStep: 60,
    // The frames here are about which step a contact is drawn in, so each draws its latest step, not one blended with the step before.
    interpolate: false,
    retain: "check",
    ...config,
    root: () => {
      const root = new Entity();
      for (const z of zones) root.addChild(z);
      root.addChild(mover);
      return root;
    },
  });
  const drawn: DecodedRecord[][] = [];
  for (let i = 0; i < frames; i++) {
    player.step();
    drawn.push([...backend.lastFrame.records]);
  }
  player.close();
  return { log, mover, drawn };
}

const squareOf = (frame: readonly DecodedRecord[]): Extract<DecodedRecord, { op: "rect" }> => {
  const rects = frame.filter((r): r is Extract<DecodedRecord, { op: "rect" }> => r.op === "rect");
  assert.equal(rects.length, 1, "one square is drawn");
  return rects[0]!;
};

describe("collisions: when they are found", () => {
  it("draws what a handler changed in the frame where the contact is first drawn", () => {
    // The mover is at x 10 × steps, so it overlaps the wall at x 50 from step 5 (touching edges do not count). Find the first frame drawn overlapping it.
    const { drawn } = play(8, STEP, 10, [zone(50, 10, "wall")]);
    const first = drawn.findIndex((frame) => squareOf(frame).x + 10 > 50);
    assert.ok(first > 0, "the mover reaches the wall");
    assert.equal(squareOf(drawn[first - 1]!).color, "#ffffffff", "white before it touches");
    assert.equal(squareOf(drawn[first]!).color, "#ff0000ff", "red in the first frame that shows it touching, not the next");
  });

  it("finds contacts after every fixed step, so one that starts and ends within a frame is reported", () => {
    // Two steps a frame. The mover is at x 10 × steps; a 4-pixel zone at x 36 is overlapped only after step 3 (x 30 to 40), and
    // only touched at an edge after step 4. Frames end after steps 2 and 4: checked once a frame, the contact would be missed.
    const { log } = play(3, 2 * STEP, 10, [zone(36, 4, "thin")]);
    const contacts = log.filter((line) => !line.startsWith("step"));
    assert.deepEqual(contacts, ["enter thin after step 3", "exit thin after step 4"]);
  });

  it("collides at the same steps whatever the frame rate, and the next step's update already knows", () => {
    // Compared over the first ten steps: how many steps a run of frames holds depends on its first frame, not on collisions.
    const upTo10 = (log: string[]): string[] => log.slice(0, log.findIndex((line) => line.startsWith("step 11")) >>> 0);
    const at60 = upTo10(play(14, STEP, 10, [zone(50, 10, "wall")]).log);
    const at30 = upTo10(play(7, 2 * STEP, 10, [zone(50, 10, "wall")]).log);
    const at20 = upTo10(play(5, 3 * STEP, 10, [zone(50, 10, "wall")]).log);
    assert.equal(at60.at(-1), "step 10 starts (hit)", "ten steps at each rate");
    assert.deepEqual(at30, at60, "two steps a frame: the same steps and the same contacts");
    assert.deepEqual(at20, at60, "three steps a frame: the same");
    const enter = at60.indexOf("enter wall after step 5");
    assert.ok(enter >= 0, `the mover (x 50 to 60 after step 5) overlaps the wall at 50: ${JSON.stringify(at60)}`);
    assert.equal(at60[enter + 1], "step 6 starts (hit)", "the update right after the contact sees it");
  });

  it("finds contacts after each tick without a fixed step too", () => {
    const { drawn, log } = play(8, STEP, 10, [zone(50, 10, "wall")], { fixedStep: undefined });
    const first = drawn.findIndex((frame) => squareOf(frame).x + 10 > 50);
    assert.equal(squareOf(drawn[first]!).color, "#ff0000ff");
    assert.ok(log.includes("enter wall after step 5"), JSON.stringify(log));
  });
});
