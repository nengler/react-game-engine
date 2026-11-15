import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AnimatedSprite,
  Camera,
  Collider,
  Entity,
  Flex,
  Hud,
  Pointer,
  Shape,
  Sprite,
  Text,
  World,
  type GameObject,
} from "@tsengine/runtime";

import { CollisionTracker } from "../src/collide.ts";
import { FrameBuilder } from "../src/draw.ts";

/**
 * A component the way the compiler writes one: state changes queue, `commitState` applies them, `render` writes the
 * transform and the elements it owns. It overrides no per-tick hook, so a frame builder may reuse what it drew.
 */
interface DynState {
  x: number;
  y: number;
  z: number;
  color: string;
  label: string;
}

class Dyn extends Entity {
  x = 0;
  y = 0;
  z = 0;
  color = "red";
  label = "";
  #next: DynState = { x: 0, y: 0, z: 0, color: "red", label: "" };
  readonly shape = new Shape({ kind: "rect", width: 10, height: 10 });
  readonly text = new Text({ text: "" });
  constructor() {
    super({ name: "dyn" });
    this.addChild(this.shape);
    this.addChild(this.text);
  }
  set(change: Partial<DynState>): void {
    Object.assign(this.#next, change);
    this.markDirty();
  }
  override commitState(): void {
    ({ x: this.x, y: this.y, z: this.z, color: this.color, label: this.label } = this.#next);
  }
  override render(): void {
    this.transform.x = this.x;
    this.transform.y = this.y;
    this.transform.z = this.z;
    this.shape.color = this.color;
    this.text.text = this.label;
  }
}

/** A tiny deterministic generator, so a failure reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** An entity with a shape in it, added to `parent`: the kind of thing a scene is mostly made of. */
function everything(root: GameObject): GameObject[] {
  const out: GameObject[] = [];
  const visit = (o: GameObject): void => {
    out.push(o);
    o.children.forEach(visit);
  };
  visit(root);
  return out;
}

function addStill(parent: GameObject, width = 3): void {
  const entity = new Entity();
  entity.addChild(new Shape({ kind: "rect", width, height: 3 }));
  parent.addChild(entity);
}

describe("reusing draw records", () => {
  it("draws what a full rebuild draws, through random changes, and reuses most of a still scene", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const next = random(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const world = new World();
      const root = new Entity();
      const dyns: Dyn[] = [];
      // Three levels of components, plus things the walk has to see every frame: a camera, a pointer, a floating box and a HUD.
      const containers: Entity[] = [root];
      for (let i = 0; i < 12; i++) {
        const group = new Entity();
        group.placement.x = i * 3;
        pick(containers).addChild(group);
        containers.push(group);
        for (let k = 0; k < 6; k++) {
          const d = new Dyn();
          d.set({ x: next() * 100, y: next() * 100 });
          group.addChild(d);
          dyns.push(d);
          if (next() < 0.3) d.addChild(new Collider({ width: 8, height: 8 }));
        }
      }
      root.addChild(new Camera());
      root.addChild(new Pointer({ width: 5, height: 5 }));
      const hud = new Hud();
      hud.addChild(new Text({ text: "score" }));
      root.addChild(hud);
      const flex = new Flex({ width: 80, height: 40, background: "blue" });
      flex.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
      root.addChild(flex);
      world.mount(root);
      const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });

      let reused = 0;
      let drawn = 0;
      for (let frame = 0; frame < 120; frame++) {
        // A few changes a frame, of every kind a component can make: state, structure, order and z.
        const changes = frame < 5 ? 0 : Math.floor(next() * 4);
        for (let c = 0; c < changes; c++) {
          const d = pick(dyns);
          switch (Math.floor(next() * 8)) {
            case 0:
              d.set({ x: next() * 100 });
              break;
            case 1:
              d.set({ color: pick(["red", "green", "blue"]) });
              break;
            case 2:
              d.set({ label: pick(["", "a", "bb", "ccc"]) });
              break;
            case 3:
              d.set({ z: pick([0, 0, 1, -1, 2]) });
              break;
            case 4: {
              const parent = pick(containers);
              const fresh = new Dyn();
              fresh.set({ x: next() * 100 });
              parent.queueAddChild(fresh);
              dyns.push(fresh);
              break;
            }
            case 5: {
              if (d.parent !== null && d.parent.children.length > 2) {
                d.parent.queueRemoveChild(d);
                dyns.splice(dyns.indexOf(d), 1);
              }
              break;
            }
            case 6: {
              const moved = pick(containers);
              moved.placement.x += 1;
              moved.markChanged();
              break;
            }
            default:
              d.shape.width = 5 + Math.floor(next() * 10);
              d.markChanged();
              break;
          }
        }
        world.tick(1 / 60);
        builder.build(world.root, 800, 600); // throws if the reused frame is not the full rebuild
        reused += builder.reusedRecords;
        drawn += 1;
      }
      assert.ok(reused > 0, `seed ${seed}: nothing was ever reused over ${drawn} frames`);
    }
  });

  it("hands the collision tracker the same entry for a collider it reused, so only what moved is tested again", () => {
    for (const seed of [11, 12, 13]) {
      const next = random(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const world = new World();
      const root = new Entity();
      const dyns: Dyn[] = [];
      for (let i = 0; i < 60; i++) {
        const group = new Entity();
        for (let k = 0; k < 4; k++) {
          const d = new Dyn();
          d.set({ x: next() * 300, y: next() * 300 });
          d.addChild(new Collider({ width: 12, height: 12, layer: pick(["a", "b"]) }));
          group.addChild(d);
          dyns.push(d);
        }
        root.addChild(group);
      }
      world.mount(root);
      const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
      const logs: string[][] = [[], []];
      const names = new Map<GameObject, string>();
      everything(root).forEach((o, i) => names.set(o, `o${i}`));
      const worlds = logs.map(
        (log) =>
          ({
            reportCollision: (a: GameObject, b: GameObject) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
            reportCollisionExit: (a: GameObject, b: GameObject) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
          }) as unknown as World
      );
      const incremental = new CollisionTracker();
      const full = new CollisionTracker(undefined, false);
      let frames = 0;
      for (let frame = 0; frame < 150; frame++) {
        // A few things move or recolour each frame; now and then something is added or removed.
        if (frame > 3) {
          for (let c = Math.floor(next() * 6); c > 0; c--)
            pick(dyns).set(next() < 0.8 ? { x: next() * 300 } : { y: next() * 300, color: pick(["red", "blue"]) });
          if (next() < 0.05) {
            const fresh = new Dyn();
            fresh.set({ x: next() * 300, y: next() * 300 });
            fresh.addChild(new Collider({ width: 12, height: 12 }));
            names.set(fresh.children[2] as GameObject, `n${frame}`);
            pick(root.children).queueAddChild(fresh);
            dyns.push(fresh);
          }
        }
        world.tick(1 / 60);
        const built = builder.build(world.root, 800, 600);
        for (const log of logs) log.length = 0;
        incremental.update(worlds[0] as World, built.colliders);
        full.update(worlds[1] as World, built.colliders);
        assert.deepEqual(logs[0], logs[1], `seed ${seed} frame ${frame}`);
        frames++;
      }
      assert.ok(
        incremental.incrementalFrames > 40,
        `seed ${seed}: ${incremental.incrementalFrames} of ${frames} frames looked only at what moved`
      );
    }
  });

  it("copies nearly everything when nothing changes", () => {
    const world = new World();
    const root = new Entity();
    for (let i = 0; i < 200; i++) {
      const d = new Dyn();
      d.set({ x: i, label: i % 10 === 0 ? "t" : "" });
      root.addChild(d);
      d.addChild(new Collider({ width: 4, height: 4 }));
    }
    world.mount(root);
    const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    const sizes: number[] = [];
    for (let frame = 0; frame < 6; frame++) {
      world.tick(1 / 60);
      const built = builder.build(world.root, 800, 600);
      sizes.push(builder.reusedRecords);
      assert.equal(built.colliders.length, 200);
    }
    assert.equal(sizes[0], 0, "the first frame has nothing to copy");
    assert.ok((sizes[5] as number) > 200 * 9, `a still frame copies its records, got ${sizes[5]}`);
  });

  it("is told by markChanged about a write that no render made, and check mode finds it when nobody is", () => {
    const world = new World();
    const root = new Entity();
    const mover = new Entity();
    const shape = new Shape({ kind: "rect", width: 10, height: 10 });
    mover.addChild(shape);
    root.addChild(mover);
    for (let i = 0; i < 30; i++) addStill(root);
    world.mount(root);
    const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    for (let i = 0; i < 4; i++) builder.build(world.root, 800, 600);
    mover.transform.x = 50; // a direct write, outside any render
    assert.throws(() => builder.build(world.root, 800, 600), /differ from a full rebuild/);
    const quiet = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    for (let i = 0; i < 4; i++) quiet.build(world.root, 800, 600);
    mover.transform.x = 60;
    mover.markChanged();
    assert.doesNotThrow(() => quiet.build(world.root, 800, 600));
  });

  it("redraws a hand-written class that overrides a hook every frame, and everything under it", () => {
    class Drifter extends Entity {
      override onUpdate(dt: number): void {
        this.transform.x += dt * 60; // written in a hook, reported by nothing
      }
    }
    const world = new World();
    const root = new Entity();
    const drifter = new Drifter();
    drifter.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
    root.addChild(drifter);
    for (let i = 0; i < 30; i++) addStill(root);
    world.mount(root);
    const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    for (let i = 0; i < 12; i++) {
      world.tick(1 / 60);
      builder.build(world.root, 800, 600);
    }
    assert.ok(builder.reusedRecords > 0, "its still siblings are reused");
  });

  it("reuses around, and under, a compiled-style class that has hooks but is marked managed", () => {
    class Ticker extends Dyn {
      static readonly managed = true; // what the compiler writes on every component it generates
      override onUpdate(dt: number): void {
        if (Math.floor(this.x) % 7 === 0) this.set({ x: this.x + dt * 100 });
      }
    }
    const world = new World();
    const root = new Entity();
    const ticker = new Ticker();
    ticker.set({ x: 7 });
    for (let i = 0; i < 40; i++) addStill(ticker); // a big still subtree under a class with a hook
    root.addChild(ticker);
    for (let i = 0; i < 40; i++) addStill(root);
    world.mount(root);
    const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    let reused = 0;
    for (let i = 0; i < 40; i++) {
      world.tick(1 / 60);
      builder.build(world.root, 800, 600);
      reused = builder.reusedRecords;
    }
    assert.ok(reused > 40 * 9, `the still siblings and the still subtree are copied, got ${reused}`);
  });

  it("follows an animated sprite's frame, and a sprite's image set by a render", () => {
    const world = new World();
    const root = new Entity();
    const sprite = new AnimatedSprite({ frames: ["a.png", "b.png", "c.png"], fps: 30 });
    const still = new Sprite({ image: "a.png" });
    root.addChild(sprite);
    root.addChild(still);
    for (let i = 0; i < 20; i++) addStill(root);
    world.mount(root);
    const builder = new FrameBuilder({ loadTexture: (path) => path.charCodeAt(path.length - 5), retain: "check" });
    for (let i = 0; i < 30; i++) {
      world.tick(1 / 20);
      builder.build(world.root, 800, 600);
    }
  });

  it("does not reuse when the builder is not given a world's tree, and rebuilds when the root changes", () => {
    const loose = new Entity();
    loose.addChild(new Shape({ kind: "rect", width: 3, height: 3 }));
    const builder = new FrameBuilder({ loadTexture: () => 0, retain: "check" });
    for (let i = 0; i < 4; i++) builder.build(loose, 800, 600);
    assert.equal(builder.reusedRecords, 0, "a tree outside a world reports no changes, so nothing may be assumed");
    const world = new World();
    const other = new World();
    const a = new Entity();
    const b = new Entity();
    for (const [w, e] of [
      [world, a],
      [other, b],
    ] as const) {
      for (let i = 0; i < 10; i++) addStill(e, 3 + (e === b ? 1 : 0));
      w.mount(e);
    }
    for (let i = 0; i < 5; i++) builder.build(world.root, 800, 600);
    for (let i = 0; i < 5; i++) {
      builder.build(i % 2 === 0 ? world.root : other.root, 800, 600); // alternating trees must never copy the other's records
    }
  });
});
