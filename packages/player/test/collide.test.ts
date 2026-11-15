import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Collider, Entity, GameObject, World } from "@rge/runtime";

import { Hero } from "../../example/generated/Hero.ts";
import { boundsOverlap, colliderBounds, CollisionTracker, type Overlaps } from "../src/collide.ts";
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
      [0, 10, {}],
      [10, 0, {}],
      [-5, 10, {}],
      [10, -5, {}],
      [Number.NaN, 10, {}],
      [Infinity, 10, {}],
      [10, 10, { scaleX: 0 }],
      [10, 10, { scaleY: 0 }],
      [10, 10, { x: Number.NaN }],
      [10, 10, { x: Infinity }],
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
  const collider = new Collider({ width: size, height: size, onCollisionEnter: (other) => log.push(`${name} met ${other.owner}`) });
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
    const silent = new Entity({ name: "silent" });
    silent.addChild(new Collider({ width: 10, height: 10 }));
    world.mount(flat);
    world.mount(silent);
    world.mount(actor("a", 0, log).entity);
    const tracker = new CollisionTracker();
    assert.equal(tracker.update(world, collidersOf(world)), 1, "only the silent one and a overlap");
    assert.deepEqual(log, ["a met silent"], "a was told; the silent one's missing callback is fine");
  });

  it("ignores a collider whose box is not finite, wherever it is in the list", () => {
    const world = new World();
    const log: string[] = [];
    const actors = ["a", "b", "c", "d", "e"].map((name, i) => actor(name, i, log));
    for (const { entity } of actors) world.mount(entity);
    const [, b, c, d] = actors as [
      (typeof actors)[number],
      (typeof actors)[number],
      (typeof actors)[number],
      (typeof actors)[number],
      (typeof actors)[number],
    ];
    // Infinitely wide, infinitely tall, and nowhere: none of them is a box.
    b.entity.transform.scaleX = Infinity;
    c.entity.transform.scaleY = -Infinity;
    d.entity.transform.y = Number.NaN;
    const tracker = new CollisionTracker();
    assert.equal(tracker.update(world, collidersOf(world)), 1);
    assert.deepEqual(log, ["a met e", "e met a"]);
    // Back to a box, it is found like any other.
    b.entity.transform.scaleX = 1;
    assert.equal(tracker.update(world, collidersOf(world)), 2);
    assert.deepEqual(log.slice(2), ["a met b", "b met a", "b met e", "e met b"]);
  });

  it("reports every pair among three overlapping colliders, in draw order", () => {
    const world = new World();
    const log: string[] = [];
    for (const [name, x] of [
      ["a", 0],
      ["b", 3],
      ["c", 6],
    ] as const)
      world.mount(actor(name, x, log).entity);
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
      const body = (other as Collider).parent as GameObject;
      body.parent?.removeChild(body);
    };
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 1);
    assert.deepEqual(log, ["a met b"], "b left the world, so b's callback is skipped");
  });
});

describe("CollisionTracker against every-pair testing", () => {
  /** A small deterministic generator, so a failure can be repeated. */
  function random(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  it("reports exactly the pairs, and the order, that testing every pair would, over many random scenes and frames", () => {
    let totalPairs = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const next = random(seed);
      const world = new World();
      const parents: Entity[] = [];
      const colliders: Collider[] = [];
      const reported: string[] = [];
      const exited: string[] = [];
      const layers = ["a", "b", "c"];
      const count = 5 + Math.floor(next() * 40);
      // A few parents hold several colliders each (so the same-parent rule matters); boxes are scaled, flipped, turned and sometimes empty.
      for (let i = 0; i < count; i++) {
        if (parents.length === 0 || next() < 0.6) {
          const parent = new Entity({ name: `p${parents.length}` });
          parents.push(parent);
          world.mount(parent);
        }
        const parent = parents[parents.length - 1] as Entity;
        const index = colliders.length;
        const collider = new Collider({
          width: next() < 0.05 ? 0 : 4 + next() * 30,
          height: 4 + next() * 30,
          layer: layers[Math.floor(next() * 3)] as string,
          // Often no list (touches everything); otherwise a random subset, sometimes empty.
          hits: next() < 0.5 ? undefined : layers.filter(() => next() < 0.6),
          onCollisionEnter: (other) => reported.push(`${index}>${colliders.indexOf(other as Collider)}`),
          onCollisionExit: (other) =>
            exited.push(
              `${Math.min(index, colliders.indexOf(other as Collider))}>${Math.max(index, colliders.indexOf(other as Collider))}`
            ),
        });
        collider.transform.x = next() * 120;
        collider.transform.y = next() * 120;
        if (next() < 0.3) collider.transform.rotation = next() * 6.28;
        if (next() < 0.2) collider.transform.scaleX = -0.5 - next();
        if (next() < 0.2) collider.transform.scaleY = 0.5 + next() * 2;
        parent.addChild(collider);
        colliders.push(collider);
      }

      const tracker = new CollisionTracker();
      let touching = new Set<string>();
      for (let frame = 0; frame < 6; frame++) {
        const entries = collidersOf(world);
        // Every pair, in draw order: the definition the sweep must agree with.
        const now = new Set<string>();
        const expected: string[] = [];
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const a = entries[i] as ColliderEntry;
            const b = entries[j] as ColliderEntry;
            if (a.collider.parent === b.collider.parent) continue;
            if (!a.collider.hitsLayer(b.collider.layer) || !b.collider.hitsLayer(a.collider.layer)) continue;
            const boxA = colliderBounds(a.collider.width, a.collider.height, a.world);
            const boxB = colliderBounds(b.collider.width, b.collider.height, b.world);
            if (boxA === null || boxB === null || !boundsOverlap(boxA, boxB)) continue;
            const key = `${colliders.indexOf(a.collider)}>${colliders.indexOf(b.collider)}`;
            now.add(key);
            if (!touching.has(key)) expected.push(key);
          }
        }
        // Pairs that touched last frame and do not now; keys are `from>to` in draw order, so normalise to collider indexes.
        const normal = (key: string): string =>
          key
            .split(">")
            .map(Number)
            .sort((x, y) => x - y)
            .join(">");
        const wantExits = [...touching]
          .filter((key) => !now.has(key))
          .map(normal)
          .sort();
        touching = now;
        reported.length = 0;
        exited.length = 0;
        const count = tracker.update(world, entries);
        // reportCollision tells both sides; keep one line per pair: the earlier collider's.
        const pairs = reported.filter((line) => {
          const [from, to] = line.split(">").map(Number) as [number, number];
          return (
            entries.findIndex((e) => colliders.indexOf(e.collider) === from) <
            entries.findIndex((e) => colliders.indexOf(e.collider) === to)
          );
        });
        totalPairs += expected.length;
        assert.equal(count, expected.length, `seed ${seed} frame ${frame}: how many`);
        assert.deepEqual(pairs, expected, `seed ${seed} frame ${frame}: which, and in what order`);
        // Each exit is told to both sides: one line per side, so every key appears twice.
        assert.deepEqual([...new Set(exited)].sort(), wantExits, `seed ${seed} frame ${frame}: which pairs ended`);
        assert.equal(exited.length, wantExits.length * 2, `seed ${seed} frame ${frame}: each exit reaches both sides once`);
        // Move things so pairs start and stop touching between frames.
        for (const collider of colliders) {
          collider.transform.x += (next() - 0.5) * 40;
          collider.transform.y += (next() - 0.5) * 40;
        }
      }
    }
    assert.ok(totalPairs > 200, `the scenes should produce plenty of contacts to compare, not ${totalPairs}`);
  });

  it("reports a contact again when a full sweep finds last full sweep's pairs after a frame that looked only at what moved ended one", () => {
    // 16 colliders, so a frame with one new entry looks only at what moved, and one with all new entries takes the full sweep.
    const log: string[] = [];
    const world = {
      reportCollision: (a: Collider) => void log.push(`in ${a.tag}`),
      reportCollisionExit: (a: Collider) => void log.push(`out ${a.tag}`),
    } as unknown as World;
    const colliders = Array.from({ length: 16 }, (_, i) => {
      const c = new Collider({ width: 10, height: 10, tag: `c${i}` });
      new Entity().addChild(c);
      return c;
    });
    // c0 and c1 overlap; the rest are far apart.
    const at = (i: number, moved = false): ColliderEntry => ({
      collider: colliders[i] as Collider,
      world: { ...IDENTITY, x: i === 1 ? (moved ? 500 : 5) : i * 40, y: 0 },
    });
    const tracker = new CollisionTracker();
    tracker.update(
      world,
      colliders.map((_, i) => at(i))
    );
    tracker.update(
      world,
      colliders.map((_, i) => at(i))
    ); // the same pairs as the frame before: nothing reported
    assert.deepEqual(log, ["in c0"]);
    const first = colliders.map((_, i) => at(i));
    tracker.update(world, first);
    const moved = first.slice();
    moved[1] = at(1, true);
    tracker.update(world, moved);
    assert.equal(tracker.incrementalFrames > 0, true, "the move was handled by looking only at what moved");
    assert.deepEqual(log, ["in c0", "out c0"]);
    tracker.update(
      world,
      colliders.map((_, i) => at(i))
    ); // every entry new: a full sweep, whose pairs are the last full sweep's
    assert.deepEqual(
      log,
      ["in c0", "out c0", "in c0"],
      "touching again is a new contact, though the full sweep's pairs are what they were"
    );
  });

  it("keeps reporting the same contacts when it runs out of ids and renumbers, while colliders come and go", () => {
    const next = random(7);
    const reports = (log: string[]) =>
      ({
        reportCollision: (a: Collider, b: Collider) => void log.push(`${a.width}|${b.width}`),
        reportCollisionExit: () => {},
      }) as unknown as World;
    const roomy = new CollisionTracker();
    const tight = new CollisionTracker(12); // renumbers every few frames
    const expected: string[] = [];
    const actual: string[] = [];
    let live: ColliderEntry[] = [];
    let made = 0;
    for (let frame = 0; frame < 200; frame++) {
      // Drop some colliders and make new ones, so ids keep being handed out; widths name them in the log.
      live = live.filter(() => next() > 0.3);
      while (live.length < 6) {
        const collider = new Collider({ width: 10 + made++ / 1000, height: 10 });
        new Entity().addChild(collider); // each has its own parent, so the same-parent rule does not apply
        live.push({ collider, world: { ...IDENTITY } });
      }
      live = live.map((entry) => ({ collider: entry.collider, world: { ...IDENTITY, x: Math.floor(next() * 4) * 8, y: 0 } }));
      roomy.update(reports(expected), live);
      tight.update(reports(actual), live);
    }
    assert.ok(expected.length > 100, `the frames should produce plenty of contacts, not ${expected.length}`);
    assert.deepEqual(actual, expected);
  });

  it("still reports each contact once when ids grow past the compact range (more than 2^15)", () => {
    const log: string[] = [];
    const world = {
      reportCollision: (a: Collider, b: Collider) => void log.push(`${a.width}|${b.width}`),
      reportCollisionExit: () => {},
    } as unknown as World;
    const tracker = new CollisionTracker();
    const spread = (count: number, first: number): ColliderEntry[] =>
      Array.from({ length: count }, (_, i) => {
        const collider = new Collider({ width: first + i, height: 1 });
        new Entity().addChild(collider);
        return { collider, world: { ...IDENTITY, x: i * 1e6, y: 0 } }; // wider apart than any is wide
      });
    tracker.update(world, spread(17000, 1)); // ids 0 .. 16999, nothing touching
    const late = spread(17000, 100000); // ids 17000 .. 33999: the last ones are past 2^15
    const a = late[16998] as ColliderEntry;
    const b = late[16999] as ColliderEntry;
    const low = late[0] as ColliderEntry; // id 17000, paired with one past 2^15
    const frame = (touchingLow: boolean): ColliderEntry[] => [
      ...late.slice(1, 16998),
      { collider: low.collider, world: { ...IDENTITY, x: touchingLow ? -1e9 + 5 : -1e9 + 5e5 } },
      { collider: a.collider, world: { ...IDENTITY, x: -1e9 } },
      { collider: b.collider, world: { ...IDENTITY, x: -1e9 + 10 } },
    ];
    tracker.update(world, frame(true));
    tracker.update(world, frame(true));
    const [lowId, aId, bId] = [100000, 100000 + 16998, 100000 + 16999];
    assert.deepEqual(log, [`${lowId}|${aId}`, `${lowId}|${bId}`, `${aId}|${bId}`], "each pair once, while it lasts");
    tracker.update(world, frame(false));
    tracker.update(world, frame(true));
    assert.deepEqual(
      log.slice(3),
      [`${lowId}|${aId}`, `${lowId}|${bId}`],
      "the pairs that parted and met again are reported again; the one that stayed is not"
    );
  });
});

describe("collisions in the frame loop", () => {
  const WINDOW = { width: 200, height: 100, title: "test" };

  it("reports two Heroes walking into each other once, again after they part and meet again, and renders the effect in the same step", () => {
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
    // The hit takes 10, rendered right after the step that made the contact (so the frame that shows them touching shows it).
    assert.equal(left.s.health, 90, "left's health in the step of the hit");
    assert.equal(right.s.health, 90, "right's health in the step of the hit");
    player.step();
    // Poisoned by the hit, a Hero no longer regenerates: the next step's update already reads the new state.
    assert.ok(left.s.health < 90 && right.s.health < 90, "poison, not regeneration, in the very next step");
    close(left.s.health, 90, "left's health a step after the hit", 0.1);
    player.step();
    player.step();
    assert.equal(backend.plays.length, 2, "still overlapping: no new reports");

    // Moved by hand, outside any render, so the player is told: a Hero whose render changes nothing it draws is not drawn again.
    right.placement.x = 100;
    right.markMoved();
    player.step();
    right.placement.x = 10;
    right.markMoved();
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

describe("CollisionTracker: layers and exits", () => {
  /** Two colliders in their own named entities: `a` at x = 0 and `b` at x = 5, size 10, so they overlap. */
  function pair(
    a: ConstructorParameters<typeof Collider>[0],
    b: ConstructorParameters<typeof Collider>[0]
  ): { world: World; a: Collider; b: Collider; ea: Entity; eb: Entity } {
    const world = new World();
    const ea = new Entity({ name: "ea" });
    const eb = new Entity({ name: "eb" });
    eb.transform.x = 5;
    const ca = new Collider(a);
    const cb = new Collider(b);
    ea.addChild(ca);
    eb.addChild(cb);
    world.mount(ea);
    world.mount(eb);
    return { world, a: ca, b: cb, ea, eb };
  }
  const box = { width: 10, height: 10 };

  it("gives a handler the other collider's tag and its owner's name", () => {
    const seen: string[] = [];
    const { world } = pair(
      { ...box, tag: "coin", onCollisionEnter: (o) => seen.push(`a: ${o.tag}/${o.owner}`) },
      { ...box, tag: "player", onCollisionEnter: (o) => seen.push(`b: ${o.tag}/${o.owner}`) }
    );
    new CollisionTracker().update(world, collidersOf(world));
    assert.deepEqual(seen, ["a: player/eb", "b: coin/ea"]);
    const bare = new Collider(box);
    assert.equal(bare.tag, "", "no tag reads as the empty string");
    assert.equal(bare.owner, "Collider", "no named entity above it: its class name");
  });

  it("skips a pair unless each side's hits allows the other's layer", () => {
    const touches = (a: object, b: object): number => {
      const { world } = pair({ ...box, ...a }, { ...box, ...b });
      return new CollisionTracker().update(world, collidersOf(world));
    };
    assert.equal(touches({}, {}), 1, "no layers, no hits: everything touches");
    assert.equal(touches({ layer: "bullet", hits: ["enemy"] }, { layer: "bullet", hits: ["enemy"] }), 0, "bullets ignore bullets");
    assert.equal(touches({ layer: "bullet", hits: ["enemy"] }, { layer: "enemy" }), 1, "a bullet hits an enemy");
    assert.equal(touches({ layer: "bullet", hits: ["enemy"] }, { layer: "ground" }), 0, "the ground does not stop it, by its own hits");
    assert.equal(touches({ layer: "bullet" }, { layer: "ground", hits: ["player"] }), 0, "the other side's hits count too");
    assert.equal(touches({ hits: [] }, {}), 0, "an empty hits list touches nothing");
  });

  it("reports an exit once when a pair moves apart, to both sides, and not again", () => {
    const log: string[] = [];
    const { world, eb } = pair(
      { ...box, onCollisionEnter: (o) => log.push(`a in ${o.owner}`), onCollisionExit: (o) => log.push(`a out ${o.owner}`) },
      { ...box, onCollisionEnter: (o) => log.push(`b in ${o.owner}`), onCollisionExit: (o) => log.push(`b out ${o.owner}`) }
    );
    const tracker = new CollisionTracker();
    tracker.update(world, collidersOf(world));
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log, ["a in eb", "b in ea"], "staying together reports nothing more");
    eb.transform.x = 50;
    assert.equal(tracker.update(world, collidersOf(world)), 0, "an exit is not an enter");
    assert.deepEqual(log.slice(2), ["a out eb", "b out ea"]);
    tracker.update(world, collidersOf(world));
    assert.equal(log.length, 4, "once");
    eb.transform.x = 5;
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log.slice(4), ["a in eb", "b in ea"], "touching again is a new contact");
  });

  it("reports an exit when one collider leaves the world, to the one still mounted only", () => {
    const log: string[] = [];
    const { world, eb } = pair(
      { ...box, onCollisionExit: (o) => log.push(`a out ${o.owner}`) },
      { ...box, onCollisionExit: () => log.push("b out") }
    );
    const tracker = new CollisionTracker();
    tracker.update(world, collidersOf(world));
    eb.parent?.removeChild(eb);
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log, ["a out eb"], "b is gone, so it hears nothing");
  });

  it("reports an exit when a collider loses its area, and when layers stop matching", () => {
    const log: string[] = [];
    const { world, a, b } = pair({ ...box, onCollisionExit: () => log.push("a out") }, { ...box });
    const tracker = new CollisionTracker();
    tracker.update(world, collidersOf(world));
    b.width = 0;
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log, ["a out"]);
    b.width = 10;
    tracker.update(world, collidersOf(world));
    a.hits = [];
    tracker.update(world, collidersOf(world));
    assert.deepEqual(log, ["a out", "a out"]);
  });

  it("reports exits before enters in a frame, and keeps exits that renumbering would have dropped", () => {
    const log: string[] = [];
    const world = {
      reportCollision: (a: Collider) => void log.push(`in ${a.width}`),
      reportCollisionExit: (a: Collider) => void log.push(`out ${a.width}`),
    } as unknown as World;
    const tracker = new CollisionTracker(4);
    const collider = (width: number, x: number): ColliderEntry => {
      const c = new Collider({ width, height: 10 });
      new Entity().addChild(c); // its own parent: colliders that share one never collide
      return { collider: c, world: { ...IDENTITY, x } };
    };
    const [p, q] = [collider(10, 0), collider(11, 5)];
    tracker.update(world, [p, q]);
    // Both leave; two fresh colliders arrive, enough of them to force a renumber (compactAt 4).
    const fresh = [collider(12, 0), collider(13, 5), collider(14, 100), collider(15, 200)];
    tracker.update(world, fresh);
    assert.deepEqual(
      log,
      ["in 10", "out 10", "in 12"],
      "the old pair's exit comes first, though neither of its colliders is in the list now"
    );
  });

  it("reports what the full sweep and testing every pair report, through every kind of change, including frames that look only at what moved", () => {
    for (const seed of [1, 2, 3, 4]) {
      let state = seed * 7919;
      const next = (): number => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
      const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
      const names = new Map<Collider, string>();
      const logs: string[][] = [[], []];
      const worlds = logs.map(
        (log) =>
          ({
            reportCollision: (a: Collider, b: Collider) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
            reportCollisionExit: (a: Collider, b: Collider) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
          }) as unknown as World
      );
      const incremental = new CollisionTracker();
      const full = new CollisionTracker(undefined, false);
      const parents: Entity[] = Array.from({ length: 40 }, () => new Entity());
      const make = (label: string): ColliderEntry => {
        const c = new Collider({ width: 10, height: 10, layer: pick(["a", "b", ""]), hits: next() < 0.3 ? ["a"] : undefined });
        names.set(c, label);
        pick(parents).addChild(c); // 40 parents for ~120 colliders: some share one, and those never touch each other
        return { collider: c, world: { ...IDENTITY, x: next() * 150, y: next() * 150 } };
      };
      let entries: ColliderEntry[] = Array.from({ length: 120 }, (_, i) => make(`c${i}`));
      let serial = 120;
      let touching = new Set<string>();
      for (let frame = 0; frame < 300; frame++) {
        // A collider with no area is put back the frame after, so most frames can take the path that looks only at what moved.
        const restore = entries.findIndex((e) => e.collider.width === 0);
        const kind =
          frame < 3
            ? "same"
            : restore >= 0
              ? "restore"
              : pick(["same", "same", "few", "few", "few", "few", "few", "few", "jump", "add", "remove", "area", "layer", "grow", "grow"]);
        const replace = (i: number, at: Partial<typeof IDENTITY>, size?: number): void => {
          const old = entries[i] as ColliderEntry;
          if (size !== undefined) old.collider.width = size;
          entries[i] = { collider: old.collider, world: { ...old.world, ...at } }; // a new entry, never a changed one
        };
        entries = entries.slice();
        if (kind === "few") {
          for (let k = Math.floor(next() * 12); k > 0; k--) {
            const i = Math.floor(next() * entries.length);
            const e = entries[i] as ColliderEntry;
            replace(
              i,
              next() < 0.7 ? { x: e.world.x + next() * 4 - 2, y: e.world.y + next() * 4 - 2 } : { x: next() * 150, y: next() * 150 }
            );
          }
        } else if (kind === "jump") entries.forEach((_, i) => replace(i, { x: next() * 150, y: next() * 150 }));
        else if (kind === "add") entries.splice(Math.floor(next() * entries.length), 0, make(`c${serial++}`));
        else if (kind === "remove" && entries.length > 20) entries.splice(Math.floor(next() * entries.length), 1);
        else if (kind === "restore") replace(restore, {}, 10);
        else if (kind === "grow") {
          // One collider far wider than any box before, and two earlier in the list moved into it from its right: finding it
          // means looking far to the left of them, which only a widened search window does.
          const i = 3 + Math.floor(next() * (entries.length - 3));
          const wide = entries[i] as ColliderEntry;
          replace(i, {}, 60 + next() * 30);
          for (let k = 0; k < 2; k++) replace(Math.floor(next() * i), { x: wide.world.x + 25 + next() * 20, y: wide.world.y + next() * 8 });
        } else if (kind === "area") {
          const i = Math.floor(next() * entries.length);
          replace(i, {}, 0); // no area; the next frame puts it back
        } else if (kind === "layer") {
          const i = Math.floor(next() * entries.length);
          (entries[i] as ColliderEntry).collider.layer = pick(["a", "b", ""]);
          replace(i, {});
        }
        for (const log of logs) log.length = 0;
        incremental.update(worlds[0] as World, entries);
        full.update(worlds[1] as World, entries);
        assert.deepEqual(logs[0], logs[1], `seed ${seed} frame ${frame} (${kind}): the same reports in the same order as the full sweep`);

        // Testing every pair, by the rules.
        const expected = new Set<string>();
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const a = entries[i] as ColliderEntry;
            const b = entries[j] as ColliderEntry;
            const boxA = colliderBounds(a.collider.width, a.collider.height, a.world);
            const boxB = colliderBounds(b.collider.width, b.collider.height, b.world);
            if (boxA === null || boxB === null || !boundsOverlap(boxA, boxB)) continue;
            if (a.collider.parent === b.collider.parent) continue;
            if (!a.collider.hitsLayer(b.collider.layer) || !b.collider.hitsLayer(a.collider.layer)) continue;
            expected.add(`${names.get(a.collider)} ${names.get(b.collider)}`);
          }
        }
        const entered = logs[0]!.filter((l) => l.startsWith("in ")).map((l) => l.slice(3));
        const exited = logs[0]!.filter((l) => l.startsWith("out ")).map((l) => l.slice(4));
        const norm = (pair: string): string => pair.split(" ").sort().join(" ");
        const was = new Set([...touching].map(norm));
        const now = new Set([...expected].map(norm));
        assert.deepEqual(
          entered.map(norm).sort(),
          [...now].filter((k) => !was.has(k)).sort(),
          `seed ${seed} frame ${frame} (${kind}): enters`
        );
        assert.deepEqual(
          exited.map(norm).sort(),
          [...was].filter((k) => !now.has(k)).sort(),
          `seed ${seed} frame ${frame} (${kind}): exits`
        );
        touching = expected;
      }
      assert.ok(
        incremental.incrementalFrames > 30,
        `seed ${seed}: the frames that look only at what moved ran (${incremental.incrementalFrames})`
      );
    }
  });
});

describe("CollisionTracker: the sweep in bands", () => {
  const random = (seed: number): (() => number) => {
    let state = seed * 7919;
    return () => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  };
  /** A world that only writes down what it is told, by the names given to the colliders. */
  const logging = (names: Map<Collider, string>, log: string[]): World =>
    ({
      reportCollision: (a: Collider, b: Collider) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
      reportCollisionExit: (a: Collider, b: Collider) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
    }) as unknown as World;

  // Where the boxes are, and how big: each puts the bands somewhere awkward.
  const layouts: Record<string, (next: () => number) => { x: number; y: number; width: number; height: number }> = {
    // Mostly small boxes, and a few tall enough to reach through every band.
    mixed: (next) => ({
      x: next() * 300 - 50,
      y: next() * 300 - 150,
      width: 4 + next() * 20,
      height: next() < 0.08 ? 150 + next() * 300 : 4 + next() * 20,
    }),
    // Tiles on a grid: edges land exactly on band edges, and boxes that only share an edge do not touch.
    tiles: (next) => ({ x: Math.floor(next() * 12) * 16, y: Math.floor(next() * 12) * 16 + (next() < 0.2 ? 8 : 0), width: 16, height: 16 }),
    // Far taller than the most bands there can be, so the bands are stretched and the last one takes the bottom edge.
    deep: (next) => ({ x: next() * 40, y: next() * 9000, width: 6, height: 1 + next() * 3 }),
    // One box far below the rest: every other box shares the first band.
    outlier: (next) => ({ x: next() * 120, y: next() < 0.02 ? 1e9 : next() * 120, width: 10, height: 10 }),
    // A row and a pile: one band, or two thin ones.
    row: (next) => ({ x: next() * 2000, y: 5, width: 10, height: 10 }),
    pile: (next) => ({ x: next() * 6, y: next() * 6, width: 10, height: 10 }),
  };

  it("reports what the plain sweep and testing every pair report, for boxes of every size, wherever the bands fall", () => {
    let bandedFrames = 0;
    for (const [layout, place] of Object.entries(layouts)) {
      for (const seed of [1, 2, 3]) {
        const next = random(seed);
        const names = new Map<Collider, string>();
        const parents: Entity[] = Array.from({ length: 50 }, () => new Entity());
        const make = (label: string): ColliderEntry => {
          const at = place(next);
          const c = new Collider({
            width: at.width,
            height: at.height,
            layer: next() < 0.3 ? "a" : "",
            hits: next() < 0.2 ? ["a"] : undefined,
          });
          names.set(c, label);
          (parents[Math.floor(next() * parents.length)] as Entity).addChild(c);
          return { collider: c, world: { ...IDENTITY, x: at.x, y: at.y } };
        };
        let entries: ColliderEntry[] = Array.from({ length: 140 }, (_, i) => make(`c${i}`));
        let serial = entries.length;
        // In bands whenever two can be made; never; and as the tracker decides for itself, with and without looking only at what moved.
        const trackers = [
          new CollisionTracker(undefined, false, "always"),
          new CollisionTracker(undefined, false, false),
          new CollisionTracker(undefined, false),
          new CollisionTracker(),
        ];
        const logs: string[][] = trackers.map(() => []);
        const worlds = logs.map((log) => logging(names, log));
        let touching = new Set<string>();
        for (let frame = 0; frame < 40; frame++) {
          const kind =
            frame === 0
              ? "same"
              : (["drift", "drift", "drift", "jump", "add", "remove", "resize", "same"] as const)[Math.floor(next() * 8)];
          entries = entries.slice();
          const replace = (i: number, world: ColliderEntry["world"]): void =>
            void (entries[i] = { collider: (entries[i] as ColliderEntry).collider, world });
          if (kind === "drift")
            entries.forEach((e, i) => replace(i, { ...e.world, x: e.world.x + next() * 6 - 3, y: e.world.y + next() * 6 - 3 }));
          else if (kind === "jump") entries.forEach((_, i) => replace(i, { ...IDENTITY, ...(({ x, y }) => ({ x, y }))(place(next)) }));
          else if (kind === "add") entries.splice(Math.floor(next() * (entries.length + 1)), 0, make(`c${serial++}`));
          else if (kind === "remove") entries.splice(next() < 0.5 ? entries.length - 1 : Math.floor(next() * entries.length), 1);
          else if (kind === "resize") {
            const i = Math.floor(next() * entries.length);
            const e = entries[i] as ColliderEntry;
            e.collider.height = next() < 0.5 ? 2 + next() * 10 : 100 + next() * 400;
            replace(i, { ...e.world, scaleY: next() < 0.3 ? -1 : 1 });
          }
          logs.forEach((log) => (log.length = 0));
          trackers.forEach((tracker, k) => tracker.update(worlds[k] as World, entries));
          for (let k = 1; k < trackers.length; k++)
            assert.deepEqual(
              logs[k],
              logs[0],
              `${layout} seed ${seed} frame ${frame} (${kind}): tracker ${k} reports what the banded sweep reports, in the same order`
            );

          const expected = new Set<string>();
          for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
              const a = entries[i] as ColliderEntry;
              const b = entries[j] as ColliderEntry;
              const boxA = colliderBounds(a.collider.width, a.collider.height, a.world);
              const boxB = colliderBounds(b.collider.width, b.collider.height, b.world);
              if (boxA === null || boxB === null || !boundsOverlap(boxA, boxB)) continue;
              if (a.collider.parent === b.collider.parent) continue;
              if (!a.collider.hitsLayer(b.collider.layer) || !b.collider.hitsLayer(a.collider.layer)) continue;
              expected.add([names.get(a.collider), names.get(b.collider)].sort().join(" "));
            }
          }
          const norm = (pair: string): string => pair.split(" ").sort().join(" ");
          const entered = (logs[0] as string[]).filter((l) => l.startsWith("in ")).map((l) => norm(l.slice(3)));
          const exited = (logs[0] as string[]).filter((l) => l.startsWith("out ")).map((l) => norm(l.slice(4)));
          assert.deepEqual(
            entered.sort(),
            [...expected].filter((k) => !touching.has(k)).sort(),
            `${layout} seed ${seed} frame ${frame} (${kind}): enters`
          );
          assert.deepEqual(
            exited.sort(),
            [...touching].filter((k) => !expected.has(k)).sort(),
            `${layout} seed ${seed} frame ${frame} (${kind}): exits`
          );
          touching = expected;
        }
        const banded = (trackers[0] as CollisionTracker).bandedFrames;
        // (A row or a pile has one band until its boxes drift apart or one grows tall, so nothing is asked of those.)
        if (layout !== "row" && layout !== "pile")
          assert.ok(banded >= 35, `${layout} seed ${seed}: the sweep ran in bands (${banded} frames of 40)`);
        assert.equal((trackers[1] as CollisionTracker).bandedFrames, 0, "a tracker told not to never does");
        bandedFrames += banded;
      }
    }
    assert.ok(bandedFrames > 400);
  });

  /** `side × side` boxes in a square, each drifting its own way a little, so contacts come and go. */
  const square = (side: number, frame: number, extra: ColliderEntry[], colliders: Collider[]): ColliderEntry[] => {
    const entries: ColliderEntry[] = [];
    for (let i = 0; i < side * side; i++) {
      const wobble = Math.sin(frame * 0.3 + i) * 3;
      entries.push({
        collider: colliders[i] as Collider,
        world: { ...IDENTITY, x: (i % side) * 11 + wobble, y: Math.floor(i / side) * 11 - wobble },
      });
    }
    return entries.concat(extra);
  };

  it("goes into bands by itself when boxes are spread both ways, and reports the same as the plain sweep", () => {
    const names = new Map<Collider, string>();
    const colliders = Array.from({ length: 900 }, (_, i) => {
      const c = new Collider({ width: 10, height: 10 });
      names.set(c, `c${i}`);
      new Entity().addChild(c);
      return c;
    });
    const trackers = [new CollisionTracker(), new CollisionTracker(undefined, true, false)];
    const logs: string[][] = [[], []];
    let reports = 0;
    for (let frame = 0; frame < 80; frame++) {
      const entries = square(30, frame, [], colliders);
      logs.forEach((log) => (log.length = 0));
      trackers.forEach((tracker, k) => tracker.update(logging(names, logs[k] as string[]), entries));
      assert.deepEqual(logs[0], logs[1], `frame ${frame}`);
      reports += (logs[0] as string[]).length;
    }
    assert.ok(reports > 1000, `contacts come and go (${reports} reports)`);
    // The first sweep is plain and counts what it tested (14 pairs for each box here); every one after it is in bands.
    assert.equal((trackers[0] as CollisionTracker).bandedFrames, 79);

    // In a row there is one band, so the sweep is plain again at once.
    const before = (trackers[0] as CollisionTracker).bandedFrames;
    for (let frame = 0; frame < 10; frame++) {
      const row = colliders.map((collider, i) => ({ collider, world: { ...IDENTITY, x: i * 11 + frame, y: 0 } }));
      trackers.forEach((tracker, k) => tracker.update(logging(names, logs[k] as string[]), row));
    }
    assert.equal((trackers[0] as CollisionTracker).bandedFrames, before);
  });

  it("gives the bands up when they save nothing: one box far away stretches them until the rest share one", () => {
    const names = new Map<Collider, string>();
    const colliders = Array.from({ length: 901 }, (_, i) => {
      const c = new Collider({ width: 10, height: 10 });
      names.set(c, `c${i}`);
      new Entity().addChild(c);
      return c;
    });
    const far: ColliderEntry = { collider: colliders[900] as Collider, world: { ...IDENTITY, x: 0, y: 1e9 } };
    const trackers = [new CollisionTracker(), new CollisionTracker(undefined, true, false)];
    const logs: string[][] = [[], []];
    for (let frame = 0; frame < 400; frame++) {
      const entries = square(30, frame, [{ ...far }], colliders);
      logs.forEach((log) => (log.length = 0));
      trackers.forEach((tracker, k) => tracker.update(logging(names, logs[k] as string[]), entries));
      assert.deepEqual(logs[0], logs[1], `frame ${frame}`);
    }
    // 64 frames in bands, then the check; the plain sweep for 64 frames and bands tried again, then for 128, …
    const banded = (trackers[0] as CollisionTracker).bandedFrames;
    assert.ok(banded >= 64 && banded <= 200, `in bands for ${banded} of 400 frames`);
  });

  it("keeps ids and exits right when a steady list loses its last collider, has one swapped, or empties", () => {
    const names = new Map<Collider, string>();
    const make = (name: string): Collider => {
      const c = new Collider({ width: 10, height: 10 });
      names.set(c, name);
      new Entity().addChild(c);
      return c;
    };
    const [a, b, c, d] = ["a", "b", "c", "d"].map(make) as [Collider, Collider, Collider, Collider];
    const log: string[] = [];
    const world = logging(names, log);
    const tracker = new CollisionTracker();
    // New entries every frame, as when everything moves: the list is the same colliders, and the frame is a full sweep.
    const frame = (...colliders: Collider[]): string[] => {
      log.length = 0;
      tracker.update(
        world,
        colliders.map((collider, i) => ({ collider, world: { ...IDENTITY, x: i } }))
      );
      return log.slice();
    };
    assert.deepEqual(frame(a, b, c), ["in a b", "in a c", "in b c"]);
    assert.deepEqual(frame(a, b, c), []);
    assert.deepEqual(frame(a, b, c), []);
    assert.deepEqual(frame(a, b), ["out a c", "out b c"], "the last one left");
    assert.deepEqual(frame(a, b), []);
    assert.deepEqual(frame(a, d), ["out a b", "in a d"], "another collider in the same place");
    assert.deepEqual(frame(a, d), []);
    assert.deepEqual(frame(c, a, d), ["in c a", "in c d"], "one put in front");
    assert.deepEqual(frame(c, a, d), []);
    assert.deepEqual(frame(), ["out a c", "out a d", "out c d"], "all gone");
    assert.deepEqual(frame(a, b), ["in a b"]);
  });
});

describe("CollisionTracker: a host's broad phase", () => {
  /**
   * What `Backend.overlaps` promises, done the slow way: every overlapping pair once, one first index's pairs together (here
   * from the last box to the first, and the later box named first, since no order is promised), `order` put by left edge, and
   * the count of all pairs whatever the room.
   */
  const calls = { count: 0, short: 0 };
  const overlaps: Overlaps = (boxes, count, order, pairs) => {
    calls.count++;
    let found = 0;
    for (let a = count - 1; a >= 0; a--) {
      for (let b = 0; b < a; b++) {
        if (
          !(
            boxes[a * 4]! < boxes[b * 4 + 2]! &&
            boxes[a * 4 + 2]! > boxes[b * 4]! &&
            boxes[a * 4 + 1]! < boxes[b * 4 + 3]! &&
            boxes[a * 4 + 3]! > boxes[b * 4 + 1]!
          )
        )
          continue;
        if (found * 2 + 1 < pairs.length) {
          pairs[found * 2] = a;
          pairs[found * 2 + 1] = b;
        }
        found++;
      }
    }
    if (found * 2 > pairs.length) calls.short++;
    const sorted = Array.from({ length: count }, (_, i) => i).sort((p, q) => boxes[p * 4]! - boxes[q * 4]! || p - q);
    order.set(sorted);
    return found;
  };

  it("reports what the tracker's own sweep reports, in the same order, and asks again when the pairs did not fit", () => {
    let state = 99;
    const next = (): number => (state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
    const names = new Map<Collider, string>();
    const parents: Entity[] = Array.from({ length: 30 }, () => new Entity());
    const make = (label: string): ColliderEntry => {
      const c = new Collider({
        width: 10 + next() * 30,
        height: 10 + next() * 30,
        layer: next() < 0.3 ? "a" : "",
        hits: next() < 0.2 ? ["a"] : undefined,
      });
      names.set(c, label);
      (parents[Math.floor(next() * parents.length)] as Entity).addChild(c);
      return { collider: c, world: { ...IDENTITY, x: next() * 200, y: next() * 200 } };
    };
    let entries: ColliderEntry[] = Array.from({ length: 150 }, (_, i) => make(`c${i}`));
    let serial = entries.length;
    const logs: string[][] = [[], [], []];
    const worlds = logs.map(
      (log) =>
        ({
          reportCollision: (a: Collider, b: Collider) => void log.push(`in ${names.get(a)} ${names.get(b)}`),
          reportCollisionExit: (a: Collider, b: Collider) => void log.push(`out ${names.get(a)} ${names.get(b)}`),
        }) as unknown as World
    );
    const trackers = [
      new CollisionTracker(undefined, true, true, overlaps),
      new CollisionTracker(undefined, false, true, overlaps),
      new CollisionTracker(undefined, false, false),
    ];
    let reports = 0;
    for (let frame = 0; frame < 150; frame++) {
      const kind =
        frame === 0 ? "same" : (["drift", "few", "few", "few", "jump", "add", "remove", "area", "same"] as const)[Math.floor(next() * 9)];
      entries = entries.slice();
      const move = (i: number, x: number, y: number): void =>
        void (entries[i] = { collider: (entries[i] as ColliderEntry).collider, world: { ...IDENTITY, x, y } });
      const lost = entries.findIndex((e) => e.collider.width === 0);
      if (lost >= 0) {
        (entries[lost] as ColliderEntry).collider.width = 12;
        move(lost, (entries[lost] as ColliderEntry).world.x, (entries[lost] as ColliderEntry).world.y);
      } else if (kind === "drift") entries.forEach((e, i) => move(i, e.world.x + next() * 6 - 3, e.world.y + next() * 6 - 3));
      else if (kind === "few") for (let k = 0; k < 4; k++) move(Math.floor(next() * entries.length), next() * 200, next() * 200);
      else if (kind === "jump") entries.forEach((_, i) => move(i, next() * 200, next() * 200));
      else if (kind === "add") entries.splice(Math.floor(next() * (entries.length + 1)), 0, make(`c${serial++}`));
      else if (kind === "remove") entries.splice(Math.floor(next() * entries.length), 1);
      else if (kind === "area") {
        const i = Math.floor(next() * entries.length);
        (entries[i] as ColliderEntry).collider.width = 0; // no box this frame; back in the next
        move(i, (entries[i] as ColliderEntry).world.x, (entries[i] as ColliderEntry).world.y);
      }
      logs.forEach((log) => (log.length = 0));
      trackers.forEach((tracker, k) => tracker.update(worlds[k] as World, entries));
      assert.deepEqual(logs[0], logs[2], `frame ${frame} (${kind})`);
      assert.deepEqual(logs[1], logs[2], `frame ${frame} (${kind}), every frame a full sweep`);
      reports += (logs[2] as string[]).length;
    }
    assert.ok(reports > 3000, `contacts come and go (${reports} reports)`);
    assert.ok(calls.short > 0, "more pairs than the first buffer held, at least once");
    assert.ok(
      (trackers[0] as CollisionTracker).incrementalFrames > 20,
      "frames that look only at what moved ran between the host's sweeps"
    );
    assert.equal((trackers[0] as CollisionTracker).bandedFrames, 0, "the script's bands are not used with a host's broad phase");
  });

  it("is handed to the tracker by the player when the backend has one, and not otherwise", () => {
    for (const withHost of [true, false]) {
      calls.count = 0;
      const met: string[] = [];
      const backend = new RecordingBackend();
      if (withHost) (backend as RecordingBackend & { overlaps?: Overlaps }).overlaps = overlaps;
      const player = createPlayer(backend, {
        width: 100,
        height: 100,
        title: "t",
        root: () => {
          const root = new Entity();
          for (const x of [0, 5]) {
            const entity = new Entity({ name: `x${x}` });
            entity.transform.x = x;
            entity.addChild(new Collider({ width: 10, height: 10, onCollisionEnter: (other) => void met.push(other.owner) }));
            root.addChild(entity);
          }
          return root;
        },
      });
      player.step();
      player.step();
      player.close();
      assert.deepEqual(met, ["x5", "x0"], withHost ? "with a host's broad phase" : "without");
      assert.equal(calls.count > 0, withHost);
    }
  });
});

describe("CollisionTracker with shaped colliders", () => {
  /** `collidersOf`, keeping the entry of a collider that has not moved, as the frame builder does, so the tracker sees what moved. */
  function stableColliders(): (world: World) => ColliderEntry[] {
    const last = new Map<Collider, ColliderEntry>();
    return (world) =>
      collidersOf(world).map((entry) => {
        const before = last.get(entry.collider);
        const same = before !== undefined && before.world.x === entry.world.x && before.world.y === entry.world.y;
        const kept = same ? before : entry;
        last.set(entry.collider, kept);
        return kept;
      });
  }

  function shaped(name: string, x: number, y: number, log: string[], shape: "box" | "circle"): Entity {
    const entity = new Entity({ name });
    entity.transform.x = x;
    entity.transform.y = y;
    entity.addChild(new Collider({ width: 10, height: 10, shape, onCollisionEnter: (other) => log.push(`${name} met ${other.owner}`) }));
    return entity;
  }

  for (const [path, tracker] of [
    ["the sweep", () => new CollisionTracker(undefined, false)],
    ["the incremental update", () => new CollisionTracker()],
  ] as const) {
    it(`reports two circles only once they overlap, not when their boxes meet at the corners (${path})`, () => {
      const world = new World();
      const log: string[] = [];
      const a = shaped("a", 0, 0, log, "circle");
      const b = shaped("b", 100, 100, log, "circle");
      world.mount(a);
      world.mount(b);
      // Colliders far away, so one that moves is few enough for the incremental update to take it.
      for (let i = 0; i < 16; i++) world.mount(shaped(`far${i}`, 1000 + i * 20, 1000, log, "box"));
      const t = tracker();
      const entries = stableColliders();
      t.update(world, entries(world));
      b.transform.x = 8;
      b.transform.y = 8;
      assert.equal(t.update(world, entries(world)), 0, "boxes overlap at a corner; circles do not");
      b.transform.x = 6;
      b.transform.y = 6;
      assert.equal(t.update(world, entries(world)), 1);
      assert.deepEqual(log, ["a met b", "b met a"]);
      if (path === "the incremental update") assert.ok(t.incrementalFrames >= 2, "the moves were taken incrementally");
      else assert.equal(t.incrementalFrames, 0);
    });
  }

  it("leaves a pair of plain boxes as it was: their boxes are what touches", () => {
    const world = new World();
    const log: string[] = [];
    world.mount(shaped("a", 0, 0, log, "box"));
    world.mount(shaped("b", 8, 8, log, "box"));
    assert.equal(new CollisionTracker().update(world, collidersOf(world)), 1);
  });
});
