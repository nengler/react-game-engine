import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GameObject, World } from "../src/index.ts";

/**
 * The order a frame's handlers run in: `onInput`, then `onUpdate`, each over the tree from the top, a parent before its children
 * and siblings in the order they are children of their parent (depth first). A component reads what an earlier handler wrote
 * in the step, so this order is part of what a game does (docs/MUTABLE_STATE.md, "Shared lists: live everywhere"): it holds
 * for objects that join the tree later, move within it, or are added in the middle of a frame, not only for the first mount.
 */
class Probe extends GameObject {
  readonly name: string;
  readonly log: string[];
  constructor(name: string, log: string[]) {
    super();
    this.name = name;
    this.log = log;
  }
  override onInput(): void {
    this.log.push(`input ${this.name}`);
  }
  override onUpdate(): void {
    this.log.push(`update ${this.name}`);
  }
}

function frame(world: World, log: string[]): string[] {
  log.length = 0;
  world.tick(1 / 60);
  world.flush();
  return log.filter((line) => line.startsWith("update ")).map((line) => line.slice("update ".length));
}

describe("the order handlers run in", () => {
  it("is depth first, a parent before its children, as the tree was mounted", () => {
    const log: string[] = [];
    const world = new World();
    const [p, a, a1, b] = ["P", "A", "A1", "B"].map((n) => new Probe(n, log)) as [Probe, Probe, Probe, Probe];
    a.addChild(a1);
    p.addChild(a);
    p.addChild(b);
    world.mount(p);
    world.flush();
    assert.deepEqual(frame(world, log), ["P", "A", "A1", "B"]);
    assert.deepEqual(log.filter((line) => line.startsWith("input ")), ["input P", "input A", "input A1", "input B"], "and so is onInput");
  });

  it("puts a child added later where it is in the tree, not after everything that was mounted before it", () => {
    const log: string[] = [];
    const world = new World();
    const [p, a, b, a2] = ["P", "A", "B", "A2"].map((n) => new Probe(n, log)) as [Probe, Probe, Probe, Probe];
    p.addChild(a);
    p.addChild(b);
    world.mount(p);
    world.flush();
    a.addChild(a2);
    assert.deepEqual(frame(world, log), ["P", "A", "A2", "B"]);
  });

  it("follows a reorder of siblings", () => {
    const log: string[] = [];
    const world = new World();
    const [p, a, b, c] = ["P", "A", "B", "C"].map((n) => new Probe(n, log)) as [Probe, Probe, Probe, Probe];
    p.addChild(a, 0);
    p.addChild(b, 0);
    p.addChild(c, 0);
    world.mount(p);
    world.flush();
    assert.deepEqual(frame(world, log), ["P", "A", "B", "C"]);
    p.queueReorder(0, [c, a, b]);
    world.flush();
    assert.deepEqual(frame(world, log), ["P", "C", "A", "B"]);
  });

  it("puts an object that is removed and added back where it now is", () => {
    const log: string[] = [];
    const world = new World();
    const [p, a, b] = ["P", "A", "B"].map((n) => new Probe(n, log)) as [Probe, Probe, Probe];
    p.addChild(a);
    p.addChild(b);
    world.mount(p);
    world.flush();
    p.removeChild(a);
    assert.deepEqual(frame(world, log), ["P", "B"], "removed");
    p.addChild(a);
    assert.deepEqual(frame(world, log), ["P", "B", "A"], "added back at the end");
  });

  it("starts a child added during a frame next frame, in its place", () => {
    const log: string[] = [];
    const world = new World();
    const [p, a, b, a2] = ["P", "A", "B", "A2"].map((n) => new Probe(n, log)) as [Probe, Probe, Probe, Probe];
    p.addChild(a);
    p.addChild(b);
    world.mount(p);
    world.flush();
    // `A`'s own update adds a child under itself.
    a.onUpdate = function (this: Probe): void {
      log.push("update A");
      if (a2.parent === null) this.addChild(a2);
    };
    assert.deepEqual(frame(world, log), ["P", "A", "B"], "the frame it is added in");
    assert.deepEqual(frame(world, log), ["P", "A", "A2", "B"], "the next frame");
  });
});
