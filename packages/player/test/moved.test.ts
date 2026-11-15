import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Collider, Entity, Shape, Sprite, Text, World, type GameObject } from "@rge/runtime";

import { CollisionTracker } from "../src/collide.ts";
import { FrameBuilder, type ColliderEntry } from "../src/draw.ts";
import { RGE_OP_RECT, RGE_OP_RECT_LEN, RGE_OP_SPRITE, RGE_OP_SPRITE_LEN, RGE_OP_VIEW_LEN } from "../src/protocol.ts";

interface ActorState {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  z: number;
  color: string;
  width: number;
  image: string;
  /** Where the shape is inside the actor: anything but 0 and the actor's records are no longer all at the actor's own transform. */
  offset: number;
}

/**
 * A component the way the compiler writes one now: `render()` writes only what differs and says what it wrote to
 * (`markMoved` for a transform, `markChanged` for anything else), so a render that only moves it leaves its content alone.
 */
class Actor extends Entity {
  protected override readonly reportsChanges = true;
  #state: ActorState = { x: 0, y: 0, rotation: 0, scale: 1, z: 0, color: "red", width: 10, image: "a.png", offset: 0 };
  #next: ActorState = { ...this.#state };
  readonly shape = new Shape({ kind: "rect", width: 10, height: 10, color: "red" });
  readonly sprite = new Sprite({ image: "a.png" });
  constructor() {
    super({ name: "actor" });
    this.addChild(this.shape);
    this.addChild(this.sprite);
  }
  set(change: Partial<ActorState>): void {
    Object.assign(this.#next, change);
    this.markDirty();
  }
  override commitState(): void {
    this.#state = { ...this.#next };
  }
  override render(): void {
    const s = this.#state;
    const t = this.transform;
    if (t.x !== s.x || t.y !== s.y || t.rotation !== s.rotation || t.scaleX !== s.scale || t.z !== s.z) {
      t.x = s.x;
      t.y = s.y;
      t.rotation = s.rotation;
      t.scaleX = s.scale;
      t.z = s.z;
      this.markMoved();
    }
    if (this.shape.color !== s.color || this.shape.width !== s.width) {
      this.shape.color = s.color;
      this.shape.width = s.width;
      this.shape.markChanged();
    }
    if (this.shape.transform.x !== s.offset) {
      this.shape.transform.x = s.offset;
      this.shape.markMoved();
    }
    if (this.sprite.image !== s.image) {
      this.sprite.image = s.image;
      this.sprite.markChanged();
    }
  }
}

/** A component rooted at a sprite, with nothing under it: a bullet. */
class Bullet extends Sprite {
  protected override readonly reportsChanges = true;
  x = 0;
  constructor() {
    super({ image: "b.png" });
  }
  moveTo(x: number): void {
    this.x = x;
    this.markDirty();
  }
  override render(): void {
    if (this.transform.x !== this.x) {
      this.transform.x = this.x;
      this.markMoved();
    }
  }
}

const options = { loadTexture: (path: string): number => (path.includes("missing") ? -1 : path.length), warn: () => {} };
/** What one actor draws: a rect and a sprite. */
const ACTOR_DOUBLES = RGE_OP_RECT_LEN + RGE_OP_SPRITE_LEN;

function random(seed: number): () => number {
  let state = seed * 7919;
  return () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
}

/** `count` actors under one root, each with a collider, mounted and built twice so that every actor's records are written down. */
function stage(count: number): {
  world: World;
  root: Entity;
  actors: Actor[];
  builder: FrameBuilder;
  frame: () => ReturnType<FrameBuilder["build"]>;
} {
  const world = new World();
  const root = new Entity();
  const actors = Array.from({ length: count }, (_, i) => {
    const actor = new Actor();
    actor.addChild(new Collider({ width: 10, height: 10 }));
    actor.set({ x: i * 20, y: i });
    root.addChild(actor);
    return actor;
  });
  world.mount(root);
  const builder = new FrameBuilder({ ...options, retain: "check" });
  const frame = (): ReturnType<FrameBuilder["build"]> => {
    world.tick(1 / 60);
    return builder.build(world.root, 800, 600); // throws if what was kept is not what a full rebuild draws
  };
  frame();
  for (const actor of actors) actor.set({ x: actor.transform.x + 1 });
  frame();
  return { world, root, actors, builder, frame };
}

describe("a component that only moved", () => {
  it("is drawn from last frame's records with its new transform in them, and its colliders are new entries at that transform", () => {
    const { actors, builder, frame } = stage(40);
    let before = frame().colliders.slice();
    for (let step = 0; step < 5; step++) {
      for (const actor of actors) actor.set({ x: actor.transform.x + 3, y: actor.transform.y + 1 });
      const built = frame();
      assert.equal(builder.movedRecords, 40 * ACTOR_DOUBLES, `step ${step}: every actor's records were last frame's, moved`);
      assert.equal(builder.reusedRecords, 0);
      built.colliders.forEach((entry: ColliderEntry, i) => {
        assert.notEqual(entry, before[i], "a new entry: the collision tracker takes the same entry for a collider that did not move");
        assert.equal(entry.collider, (before[i] as ColliderEntry).collider);
        assert.deepEqual({ ...entry.world }, { ...entry.collider.worldTransform() });
      });
      before = built.colliders.slice();
    }
    // The records themselves: a rect and a sprite for each actor, both at the actor's transform.
    const built = frame();
    const records = built.list.records;
    for (const [i, actor] of actors.entries()) {
      const at = RGE_OP_VIEW_LEN + i * ACTOR_DOUBLES;
      assert.deepEqual([records[at], records[at + 1], records[at + 2]], [RGE_OP_RECT, actor.transform.x, actor.transform.y]);
      assert.deepEqual([records[at + 9], records[at + 10], records[at + 11]], [RGE_OP_SPRITE, actor.transform.x, actor.transform.y]);
    }
  });

  it("is turned and scaled the same way: every record under it carries its transform", () => {
    const { actors, builder, frame } = stage(6);
    actors[0]!.set({ rotation: 0.5 });
    actors[1]!.set({ scale: -2, x: 500 });
    const built = frame();
    assert.equal(builder.movedRecords, 2 * ACTOR_DOUBLES);
    assert.equal(builder.reusedRecords, 4 * ACTOR_DOUBLES, "the four that stood still are copied as they are");
    assert.equal(built.list.records[RGE_OP_VIEW_LEN + 3], 0.5, "the turned actor's rect");
    assert.equal(built.list.records[RGE_OP_VIEW_LEN + ACTOR_DOUBLES + 4], -2, "the flipped actor's rect");
  });

  it("is drawn again when what it draws changed, and moved again after that", () => {
    const { actors, builder, frame } = stage(10);
    const all = (): void => actors.forEach((actor) => actor.set({ x: actor.transform.x + 1 }));
    const one = actors[4]!;
    for (const change of [
      { color: "blue" },
      { width: 12 },
      { image: "b.png" },
      { image: "" },
      { image: "missing.png" },
      { image: "a.png" },
    ] as Partial<ActorState>[]) {
      all();
      one.set(change);
      frame();
      assert.equal(
        builder.movedRecords,
        9 * ACTOR_DOUBLES,
        `${JSON.stringify(change)}: the one that changed is drawn again, the others are moved`
      );
      all();
      const built = frame();
      const expected =
        change.image === ""
          ? 9 * ACTOR_DOUBLES + RGE_OP_RECT_LEN
          : change.image === "missing.png"
            ? 9 * ACTOR_DOUBLES + 2 * RGE_OP_RECT_LEN
            : 10 * ACTOR_DOUBLES;
      assert.equal(builder.movedRecords, expected, `${JSON.stringify(change)}: and the frame after, it only moved`);
      assert.equal(built.colliders.length, 10);
    }
  });

  it("is drawn again while a record under it is somewhere else than its own transform, or it has a z", () => {
    const { actors, builder, frame } = stage(8);
    const all = (): void => actors.forEach((actor) => actor.set({ x: actor.transform.x + 1 }));
    // A shape off to one side is not at the actor's transform, so writing the transform into its record would be wrong.
    actors[0]!.set({ offset: 4 });
    // Draw order is not in the records: an actor with a z is found by the walk every frame.
    actors[1]!.set({ z: 2 });
    all();
    frame();
    for (let step = 0; step < 3; step++) {
      all();
      frame();
      assert.equal(builder.movedRecords, 6 * ACTOR_DOUBLES, `step ${step}`);
    }
    actors[0]!.set({ offset: 0 });
    actors[1]!.set({ z: 0 });
    all();
    frame();
    all();
    frame();
    assert.equal(builder.movedRecords, 8 * ACTOR_DOUBLES, "back in line, they are moved like the rest");
  });

  it("is drawn again when something is added under it, and when that leaves", () => {
    const { actors, builder, frame } = stage(5);
    const all = (): void => actors.forEach((actor) => actor.set({ x: actor.transform.x + 1 }));
    const label = new Text({ text: "boss" });
    actors[2]!.queueAddChild(label);
    all();
    frame();
    all();
    const withLabel = frame();
    assert.equal(
      builder.movedRecords,
      4 * ACTOR_DOUBLES,
      "a text may be shifted inside its width, so an actor with one is not moved as a block"
    );
    assert.deepEqual(withLabel.list.texts, ["boss"]);
    actors[2]!.queueRemoveChild(label);
    all();
    frame();
    all();
    const without = frame();
    assert.equal(builder.movedRecords, 5 * ACTOR_DOUBLES);
    assert.deepEqual(without.list.texts, []);
  });

  it("keeps everything when a render changes nothing that is drawn", () => {
    const { actors, builder, frame } = stage(10);
    frame();
    for (const actor of actors) actor.set({ x: actor.transform.x }); // a render, and the same values
    frame();
    assert.equal(builder.movedRecords, 0);
    assert.equal(builder.reusedRecords, 10 * ACTOR_DOUBLES);
  });

  it("moves a component that is itself a sprite, and an object moved by hand with markMoved", () => {
    const world = new World();
    const root = new Entity();
    const bullets = Array.from({ length: 5 }, () => new Bullet());
    for (const bullet of bullets) root.addChild(bullet);
    // A plain entity, moved from outside any render.
    const crate = new Entity();
    crate.addChild(new Shape({ kind: "rect", width: 4, height: 4 }));
    root.addChild(crate);
    world.mount(root);
    const builder = new FrameBuilder({ ...options, retain: "check" });
    const frame = (): void => {
      bullets.forEach((bullet, i) => bullet.moveTo(bullet.x + i + 1));
      crate.transform.y += 2;
      crate.markMoved();
      world.tick(1 / 60);
      builder.build(world.root, 800, 600);
    };
    frame();
    frame();
    frame();
    assert.equal(builder.movedRecords, 5 * RGE_OP_SPRITE_LEN + RGE_OP_RECT_LEN);
    // Told `markChanged` instead, which is always right, the crate is drawn again.
    crate.transform.y += 2;
    crate.markChanged();
    world.tick(1 / 60);
    builder.build(world.root, 800, 600);
    assert.equal(builder.movedRecords, 0);
  });

  it("draws a component that is itself a text again when it moves: its record refers to a string, and alignment may shift it", () => {
    class Label extends Text {
      protected override readonly reportsChanges = true;
      x = 0;
      constructor() {
        super({ text: "hi", width: 40, align: "right" });
      }
      override render(): void {
        if (this.transform.x !== this.x) {
          this.transform.x = this.x;
          this.markMoved();
        }
      }
    }
    const world = new World();
    const root = new Entity();
    const labels = Array.from({ length: 3 }, () => new Label());
    for (const label of labels) root.addChild(label);
    world.mount(root);
    const builder = new FrameBuilder({ ...options, retain: "check" });
    for (let i = 0; i < 5; i++) {
      labels.forEach((label) => {
        label.x += 3;
        label.markDirty();
      });
      world.tick(1 / 60);
      const built = builder.build(world.root, 800, 600); // throws if a text record were copied with a stale string
      assert.deepEqual(built.list.texts, ["hi", "hi", "hi"]);
      assert.equal(builder.movedRecords, 0);
    }
  });

  it("is not moved as a block when the class does not report what its render changed", () => {
    /** Hand-written, with no `reportsChanges`: a render is taken to have changed everything it owns. */
    class Plain extends Entity {
      static readonly managed = true;
      x = 0;
      readonly shape = new Shape({ kind: "rect", width: 3, height: 3 });
      constructor() {
        super();
        this.addChild(this.shape);
      }
      override render(): void {
        this.transform.x = this.x;
        this.shape.color = this.x % 2 === 0 ? "red" : "blue";
      }
    }
    const world = new World();
    const plain = new Plain();
    world.mount(plain);
    const builder = new FrameBuilder({ ...options, retain: "check" });
    for (let i = 0; i < 5; i++) {
      plain.x = i;
      plain.markDirty();
      world.tick(1 / 60);
      builder.build(world.root, 800, 600); // the colour changes every frame, and is drawn
      assert.equal(builder.movedRecords, 0);
    }
  });

  it("draws what a full rebuild draws, and reports the collisions a full sweep reports, through random moves and changes", () => {
    for (const seed of [1, 2, 3, 4]) {
      const next = random(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const world = new World();
      const root = new Entity();
      const groups: Entity[] = [];
      const actors: Actor[] = [];
      const names = new Map<GameObject, string>();
      const addActor = (parent: GameObject, queued: boolean): void => {
        const actor = new Actor();
        actor.set({ x: next() * 300, y: next() * 300 });
        if (next() < 0.7) {
          const collider = new Collider({ width: 14, height: 14 });
          names.set(collider, `c${names.size}`);
          actor.addChild(collider);
        }
        // Some hold another actor: a component inside a component, whose own moves are changes under the outer one.
        if (next() < 0.15) actor.addChild(new Actor());
        if (queued) parent.queueAddChild(actor);
        else parent.addChild(actor);
        actors.push(actor);
      };
      for (let g = 0; g < 8; g++) {
        const group = new Entity();
        groups.push(group);
        root.addChild(group);
        for (let k = 0; k < 8; k++) addActor(group, false);
      }
      world.mount(root);
      const builder = new FrameBuilder({ ...options, retain: "check" });
      const logs: string[][] = [[], []];
      const worlds = logs.map(
        (log) =>
          ({
            reportCollision: (a: GameObject, b: GameObject) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
            reportCollisionExit: (a: GameObject, b: GameObject) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
          }) as unknown as World
      );
      const trackers = [new CollisionTracker(), new CollisionTracker(undefined, false, false)];
      let moved = 0;
      let reports = 0;
      for (let frame = 0; frame < 160; frame++) {
        // Most frames most actors drift; now and then one changes in some other way, or the tree does.
        const busy = frame % 7 !== 0;
        for (const actor of actors) {
          if (busy && next() < 0.8) actor.set({ x: actor.transform.x + next() * 6 - 3, y: actor.transform.y + next() * 6 - 3 });
        }
        for (let c = Math.floor(next() * 4); c > 0; c--) {
          const actor = pick(actors);
          switch (Math.floor(next() * 11)) {
            case 0:
              actor.set({ color: pick(["red", "green", "blue"]) });
              break;
            case 1:
              actor.set({ width: 5 + Math.floor(next() * 10) });
              break;
            case 2:
              actor.set({ image: pick(["a.png", "b.png", "", "missing.png"]) });
              break;
            case 3:
              actor.set({ offset: pick([0, 0, 3]) });
              break;
            case 4:
              actor.set({ z: pick([0, 0, 0, 1, -1]) });
              break;
            case 5:
              actor.set({ rotation: next() * 6, scale: pick([1, 1, 2, -1]) });
              break;
            case 6:
              addActor(pick(groups), true);
              break;
            case 7: {
              if (actor.parent !== null && actor.parent.children.length > 3 && groups.includes(actor.parent as Entity)) {
                actor.parent.queueRemoveChild(actor);
                actors.splice(actors.indexOf(actor), 1);
              }
              break;
            }
            case 8: {
              // A whole group moved by hand: its actors are not at its transform, so it is walked, and they are drawn at their new places.
              const group = pick(groups);
              group.transform.x += next() * 10 - 5;
              group.markMoved();
              break;
            }
            case 9: {
              const label = actor.children.find((child) => child instanceof Text);
              if (label) actor.queueRemoveChild(label);
              else actor.queueAddChild(new Text({ text: "!" }));
              break;
            }
            default:
              actor.set({ x: next() * 300, y: next() * 300 });
              break;
          }
        }
        world.tick(1 / 60);
        const built = builder.build(world.root, 800, 600); // throws if what was kept or moved is not what a full rebuild draws
        moved += builder.movedRecords;
        logs.forEach((log) => (log.length = 0));
        trackers.forEach((tracker, k) => tracker.update(worlds[k] as World, built.colliders));
        assert.deepEqual(
          logs[0],
          logs[1],
          `seed ${seed} frame ${frame}: the tracker that looks only at new entries reports what a full sweep reports`
        );
        reports += (logs[1] as string[]).length;
      }
      assert.ok(moved > 160 * 20 * ACTOR_DOUBLES, `seed ${seed}: most moving actors were moved, not drawn again (${moved} doubles)`);
      assert.ok(reports > 100, `seed ${seed}: contacts came and went (${reports})`);
    }
  });
});
