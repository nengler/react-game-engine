import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, GameObject, World } from "@rge/runtime";
import { Hero } from "../../example/generated/Hero.ts";
import { boundsOverlap, colliderBounds, CollisionTracker } from "../src/collide.ts";
import { walkTree, type ColliderEntry } from "../src/draw.ts";
import { createPlayer } from "../src/loop.ts";
import { RecordingBackend } from "../src/recording.ts";

const IDENTITY = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

function close(actual: number, expected: number, what: string, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${what}: ${actual} ≈ ${expected}`);
}

function boundsOf(width: number, height: number, world: Partial<typeof IDENTITY>): number[] {
  const b = colliderBounds(width, height, { ...IDENTITY, ...world });
  assert.ok(b !== null, "the collider has a box");
  return [b.minX, b.minY, b.maxX, b.maxY];
}

describe("colliderBounds", () => {
  it("is the box width × height with its top-left corner at the position", () => {
    assert.deepEqual(boundsOf(30, 40, { x: 10, y: 20 }), [10, 20, 40, 60]);
  });

  it("scales by the world scale, each axis on its own", () => {
    assert.deepEqual(boundsOf(30, 40, { x: 10, y: 20, scaleX: 2, scaleY: 3 }), [10, 20, 70, 140]);
  });

  it("flips with a negative scale, as a sprite does", () => {
    assert.deepEqual(boundsOf(30, 40, { x: 10, y: 20, scaleX: -1 }), [-20, 20, 10, 60]);
    assert.deepEqual(boundsOf(30, 40, { x: 10, y: 20, scaleY: -1 }), [10, -20, 40, 20]);
  });

  it("is exact for a quarter turn, which is clockwise on a y-down screen", () => {
    const [minX, minY, maxX, maxY] = boundsOf(20, 10, { x: 100, y: 100, rotation: Math.PI / 2 });
    close(minX as number, 90, "minX");
    close(minY as number, 100, "minY");
    close(maxX as number, 100, "maxX");
    close(maxY as number, 120, "maxY");
  });

  it("boxes a rotated collider in the smallest upright box around it", () => {
    const [minX, minY, maxX, maxY] = boundsOf(10, 10, { rotation: Math.PI / 4 });
    const diagonal = 10 * Math.SQRT2;
    close((maxX as number) - (minX as number), diagonal, "width of the box around a 45° square");
    close((maxY as number) - (minY as number), diagonal, "height");
    close(minX as number, -10 / Math.SQRT2, "it reaches left of the origin: the corner (0, 10) turned");
  });

  it("follows the tree: a scaled, moved parent places and scales its collider", () => {
    const parent = new Entity();
    parent.transform.x = 50;
    parent.transform.y = 50;
    parent.transform.scaleX = 2;
    parent.transform.scaleY = 2;
    const collider = new Collider({ width: 10, height: 10 });
    collider.transform.x = 5;
    collider.transform.y = 5;
    parent.addChild(collider);
    walkTree(parent, (object, world) => {
      if (object === collider) assert.deepEqual(boundsOf(10, 10, world), [60, 60, 80, 80]);
    });
  });

  it("is null when the collider has no area or is not finite", () => {
    for (const [w, h, world] of [
      [0, 10, {}], [10, 0, {}], [-5, 10, {}], [10, -5, {}], [Number.NaN, 10, {}], [Infinity, 10, {}],
      [10, 10, { scaleX: 0 }], [10, 10, { scaleY: 0 }], [10, 10, { x: Number.NaN }], [10, 10, { x: Infinity }],
    ] as const) {
      assert.equal(colliderBounds(w, h, { ...IDENTITY, ...world }), null, `${w} × ${h} ${JSON.stringify(world)}`);
    }
  });
});

describe("boundsOverlap", () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });
  it("is true for boxes that overlap, including one inside the other", () => {
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(5, 5, 15, 15)), true);
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(2, 2, 4, 4)), true);
  });
  it("is false for boxes that only share an edge or a corner, and for apart boxes", () => {
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(10, 0, 20, 10)), false);
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(0, 10, 10, 20)), false);
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(10, 10, 20, 20)), false);
    assert.equal(boundsOverlap(box(0, 0, 10, 10), box(30, 0, 40, 10)), false);
  });
});

/** The colliders of a world as the frame's tree walk finds them, in draw order. */
function collidersOf(world: World): ColliderEntry[] {
  const out: ColliderEntry[] = [];
  walkTree(world.root, (object, transform) => {
    if (object instanceof Collider) out.push({ collider: object, world: transform });
  });
  return out;
}

/** A collider inside its own entity, at x, with a log of what it is told. */
function actor(name: string, x: number, log: string[], size = 10): { entity: Entity; collider: Collider } {
  const entity = new Entity({ name });
  entity.transform.x = x;
  const collider = new Collider({ width: size, height: size, onCollisionEnter: (other) => log.push(`${name} met ${(other.parent as Entity).name}`) });
  entity.addChild(collider);
  return { entity, collider };
}

describe("CollisionTracker", () => {
  it("reports a pair once, to both colliders, when they start overlapping, and not while they stay overlapped", () => {
    const world = new World();
    const log: string[] = [];
    const a = actor("a", 0, log);
    const b = actor("b", 100, log);
    world.mount(a.entity);
    world.mount(b.entity);
    const tracker = new CollisionTracker();
    assert.equal(tracker.update(world, collidersOf(world)), 0, "apart");
    b.entity.transform.x = 5;
    assert.equal(tracker.update(world, collidersOf(world)), 1);
    assert.deepEqual(log, ["a met b", "b met a"]);
    b.entity.transform.x = 6;
    assert.equal(tracker.update(world, collidersOf(world)), 0, "still overlapping");
    assert.equal(tracker.update(world, collidersOf(world)), 0);
    assert.equal(log.length, 2);
  });

  it("reports again when a pair separates and touches again", () => {
    const world = new World();
    const log: string[] = [];
    const a = actor("a", 0, log);
    const b = actor("b", 5, log);
    world.mount(a.entity);
    world.mount(b.entity);
    const tracker = new CollisionTracker();
    tracker.update(world, collidersOf(world));
    b.entity.transform.x = 100;
    tracker.update(world, collidersOf(world));
    b.entity.transform.x = 5;
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log, ["a met b", "b met a", "a met b", "b met a"]);
  });

  it("does not count boxes that only touch at an edge", () => {
    const world = new World();
    const log: string[] = [];
    world.mount(actor("a", 0, log).entity);
    world.mount(actor("b", 10, log).entity);
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 0);
  });

  it("never collides colliders with the same parent: a hitbox and a shield do not hit each other", () => {
    const world = new World();
    const log: string[] = [];
    const owner = new Entity({ name: "owner" });
    owner.addChild(new Collider({ width: 10, height: 10, onCollisionEnter: () => log.push("hitbox") }));
    owner.addChild(new Collider({ width: 20, height: 20, onCollisionEnter: () => log.push("shield") }));
    world.mount(owner);
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 0);
    // ...but another entity's collider meets both of them.
    const other = actor("other", 2, log);
    world.mount(other.entity);
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 2);
    assert.deepEqual(log.slice().sort(), ["hitbox", "other met owner", "other met owner", "shield"]);
  });

  it("forgets a collider that leaves the world, so one that comes back touching is a new contact", () => {
    const world = new World();
    const log: string[] = [];
    const a = actor("a", 0, log);
    const b = actor("b", 5, log);
    world.mount(a.entity);
    world.mount(b.entity);
    const tracker = new CollisionTracker();
    tracker.update(world, collidersOf(world));
    assert.equal(log.length, 2);
    world.root.removeChild(b.entity);
    assert.equal(tracker.update(world, collidersOf(world)), 0);
    world.mount(b.entity);
    assert.equal(tracker.update(world, collidersOf(world)), 1);
    assert.equal(log.length, 4);
  });

  it("ignores a collider with no area, and one with no callback does no harm", () => {
    const world = new World();
    const log: string[] = [];
    const flat = new Entity();
    flat.addChild(new Collider({ width: 0, height: 10, onCollisionEnter: () => log.push("flat") }));
    const silent = new Entity();
    silent.addChild(new Collider({ width: 10, height: 10 }));
    world.mount(flat);
    world.mount(silent);
    world.mount(actor("a", 0, log).entity);
    const tracker = new CollisionTracker();
    assert.equal(tracker.update(world, collidersOf(world)), 1, "only the silent one and a overlap");
    assert.deepEqual(log, ["a met "], "a was told; the silent one's missing callback is fine");
  });

  it("reports every pair among three overlapping colliders, in draw order", () => {
    const world = new World();
    const log: string[] = [];
    for (const [name, x] of [["a", 0], ["b", 3], ["c", 6]] as const) world.mount(actor(name, x, log).entity);
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 3);
    assert.deepEqual(log, ["a met b", "b met a", "a met c", "c met a", "b met c", "c met b"]);
  });

  it("does not call a collider that an earlier callback removed from the world", () => {
    const world = new World();
    const log: string[] = [];
    const a = actor("a", 0, log);
    const b = actor("b", 5, log);
    world.mount(a.entity);
    world.mount(b.entity);
    a.collider.onCollisionEnter = (other) => {
      log.push("a met b");
      (other.parent as GameObject).parent?.removeChild(other.parent as GameObject);
    };
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 1);
    assert.deepEqual(log, ["a met b"], "b left the world, so b's callback is skipped");
  });
});

describe("collisions in the frame loop", () => {
  const WINDOW = { width: 200, height: 100, title: "test" };

  it("reports two Heroes walking into each other once, again after they part and meet again, and renders the effect next tick", () => {
    const backend = new RecordingBackend();
    const left = new Hero();
    const right = new Hero();
    right.placement.x = 100;
    const player = createPlayer(backend, {
      ...WINDOW,
      root: () => {
        const root = new Entity();
        root.addChild(left);
        root.addChild(right);
        return root;
      },
    });
    player.step();
    assert.deepEqual(backend.plays, [], "apart");

    right.placement.x = 10; // each Hero's collider is 16 × 24 from its position
    player.step();
    assert.deepEqual(backend.plays, ["assets/hurt.wav", "assets/hurt.wav"], "each Hero heard it once");
    assert.equal(left.health, 100, "setHealth was queued: it renders in the next tick");
    player.step();
    // The hit takes 10. Hero also regenerates `dt` in that same tick, since it is not poisoned yet in the snapshot it reads.
    close(left.health, 90, "left's health after the hit", 0.1);
    close(right.health, 90, "right's health after the hit", 0.1);
    assert.ok(left.health < 100 && right.health < 100);
    player.step();
    player.step();
    assert.equal(backend.plays.length, 2, "still overlapping: no new reports");

    right.placement.x = 100;
    player.step();
    right.placement.x = 10;
    player.step();
    assert.equal(backend.plays.length, 4, "met again");
    player.close();
  });

  it("does not report colliders that never overlap", () => {
    const backend = new RecordingBackend();
    const player = createPlayer(backend, {
      ...WINDOW,
      root: () => {
        const root = new Entity();
        const far = new Hero();
        far.placement.x = 150;
        root.addChild(new Hero());
        root.addChild(far);
        return root;
      },
    });
    for (let i = 0; i < 5; i++) player.step();
    assert.deepEqual(backend.plays, []);
    player.close();
  });
});
