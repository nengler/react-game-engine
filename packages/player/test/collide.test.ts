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
        const collider = new Collider({ width: next() < 0.05 ? 0 : 4 + next() * 30, height: 4 + next() * 30,
          layer: layers[Math.floor(next() * 3)] as string,
          // Often no list (touches everything); otherwise a random subset, sometimes empty.
          hits: next() < 0.5 ? undefined : layers.filter(() => next() < 0.6),
          onCollisionEnter: (other) => reported.push(`${index}>${colliders.indexOf(other as Collider)}`),
          onCollisionExit: (other) => exited.push(`${Math.min(index, colliders.indexOf(other as Collider))}>${Math.max(index, colliders.indexOf(other as Collider))}`),
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
        const normal = (key: string): string => key.split(">").map(Number).sort((x, y) => x - y).join(">");
        const wantExits = [...touching].filter((key) => !now.has(key)).map(normal).sort();
        touching = now;
        reported.length = 0;
        exited.length = 0;
        const count = tracker.update(world, entries);
        // reportCollision tells both sides; keep one line per pair: the earlier collider's.
        const pairs = reported.filter((line) => {
          const [from, to] = line.split(">").map(Number) as [number, number];
          return entries.findIndex((e) => colliders.indexOf(e.collider) === from) < entries.findIndex((e) => colliders.indexOf(e.collider) === to);
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

  it("keeps reporting the same contacts when it runs out of ids and renumbers, while colliders come and go", () => {
    const next = random(7);
    const reports = (log: string[]) => ({ reportCollision: (a: Collider, b: Collider) => void log.push(`${a.width}|${b.width}`), reportCollisionExit: () => {} }) as unknown as World;
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
    const world = { reportCollision: (a: Collider, b: Collider) => void log.push(`${a.width}|${b.width}`), reportCollisionExit: () => {} } as unknown as World;
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
    assert.deepEqual(log.slice(3), [`${lowId}|${aId}`, `${lowId}|${bId}`], "the pairs that parted and met again are reported again; the one that stayed is not");
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

describe("CollisionTracker: layers and exits", () => {
  /** Two colliders in their own named entities: `a` at x = 0 and `b` at x = 5, size 10, so they overlap. */
  function pair(a: ConstructorParameters<typeof Collider>[0], b: ConstructorParameters<typeof Collider>[0]): { world: World; a: Collider; b: Collider; ea: Entity; eb: Entity } {
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
    const { world } = pair({ ...box, tag: "coin", onCollisionEnter: (o) => seen.push(`a: ${o.tag}/${o.owner}`) }, { ...box, tag: "player", onCollisionEnter: (o) => seen.push(`b: ${o.tag}/${o.owner}`) });
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
      { ...box, onCollisionEnter: (o) => log.push(`b in ${o.owner}`), onCollisionExit: (o) => log.push(`b out ${o.owner}`) },
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
    const { world, eb } = pair({ ...box, onCollisionExit: (o) => log.push(`a out ${o.owner}`) }, { ...box, onCollisionExit: () => log.push("b out") });
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
    const world = { reportCollision: (a: Collider) => void log.push(`in ${a.width}`), reportCollisionExit: (a: Collider) => void log.push(`out ${a.width}`) } as unknown as World;
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
    assert.deepEqual(log, ["in 10", "out 10", "in 12"], "the old pair's exit comes first, though neither of its colliders is in the list now");
  });
});
