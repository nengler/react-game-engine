import assert from "node:assert/strict";
/**
 * `nearby` finds the colliders of a tag within a circle, nearest first; `send` delivers a value to the colliders of a tag in a
 * circle (or to one `nearby` found) at the end of the step's update phase, in a fixed order. What a tower defense's moves need:
 * the enemies in reach, and a blast that reaches them in the step it lands.
 */
import { describe, it } from "node:test";

import { Collider, Entity, World, type GameObject, type Nearby } from "../src/index.ts";

/** An enemy-like collider: a `size` box with its top left at (x, y), carrying `{ id }`, logging what it receives. */
function enemy(id: number, x: number, y: number, log: string[], tag = "enemy", size = 10): Collider {
  const c = new Collider({
    width: size,
    height: size,
    tag,
    data: { id },
    onReceive: (value) => log.push(`${id}:${JSON.stringify(value)}`),
  });
  c.transform.x = x;
  c.transform.y = y;
  return c;
}

/** A component that runs `update(self)` in each step's update. */
class Asker extends Entity {
  readonly update: (self: Asker) => void;
  constructor(update: (self: Asker) => void) {
    super();
    this.update = update;
  }
  override onUpdate(): void {
    this.update(this);
  }
}

function worldOf(...children: GameObject[]): World {
  const world = new World();
  const root = new Entity();
  for (const child of children) root.addChild(child);
  world.mount(root);
  world.flush();
  return world;
}

const ids = (found: readonly Nearby[]): number[] => found.map((f) => (f.data as { id: number }).id);

describe("nearby", () => {
  it("finds the colliders of a tag whose boxes come within the circle, nearest first, with their data, middle and distance", () => {
    const log: string[] = [];
    // Boxes of 10: the first's nearest point is 30 away, the second contains the point, the third's corner is just out of a
    // 40 circle though its bounding square is in it, the fourth is a wall.
    const world = worldOf(enemy(1, 130, 95, log), enemy(2, 95, 95, log), enemy(3, 130, 130, log), enemy(4, 102, 102, log, "wall"));
    const found = world.nearby("enemy", 100, 100, 40);
    assert.deepEqual(ids(found), [2, 1], "a circle, not a square: the corner at (130, 130) is 42 away");
    assert.deepEqual(
      found.map((f) => [f.tag, f.x, f.y, Math.round(f.distance * 100) / 100]),
      [
        ["enemy", 100, 100, 0],
        ["enemy", 135, 100, 30],
      ]
    );
    assert.deepEqual(ids(world.nearby("enemy", 100, 100, 43)), [2, 1, 3]);
    assert.deepEqual(ids(world.nearby("wall", 100, 100, 5)), [4], "only the tag asked for");
    assert.deepEqual(world.nearby("enemy", 100, 100, -1), []);
  });

  it("is in world space under moved parents, leaves out the asker's own colliders, and breaks ties in joining order", () => {
    const log: string[] = [];
    const group = new Entity();
    group.transform.x = 200;
    group.addChild(enemy(1, 0, 0, log));
    const asker = new Asker(() => {});
    asker.addChild(enemy(9, 200, 0, log));
    const world = worldOf(group, asker, enemy(2, 210, 0, log));
    assert.deepEqual(ids(world.nearby("enemy", 210, 5, 1)), [1, 9, 2], "equally near (touching): in the order they joined");
    assert.deepEqual(ids(world.nearby("enemy", 210, 5, 1, asker)), [1, 2], "a component's own colliders do not count");
    assert.deepEqual(ids(world.nearby("enemy", 5, 5, 20)), [], "the group's collider is at 200, not 0");
  });

  it("answers the same as a scan of every collider when there are many (the grid)", () => {
    const log: string[] = [];
    const colliders: Collider[] = [];
    let seed = 3;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i++) colliders.push(enemy(i, next() * 600, next() * 340, log));
    const world = worldOf(...colliders);
    const scan = (x: number, y: number, r: number): number[] =>
      colliders
        .map((c, order) => {
          const dx = Math.max(c.transform.x - x, 0, x - (c.transform.x + 10));
          const dy = Math.max(c.transform.y - y, 0, y - (c.transform.y + 10));
          return { id: order, distance: Math.hypot(dx, dy), order };
        })
        .filter((e) => e.distance <= r)
        .sort((a, b) => a.distance - b.distance || a.order - b.order)
        .map((e) => e.id);
    for (const [x, y, r] of [
      [300, 170, 60],
      [0, 0, 100],
      [600, 340, 5],
      [300, 170, 1000],
    ] as const)
      assert.deepEqual(ids(world.nearby("enemy", x, y, r)), scan(x, y, r), `${x},${y} r${r}`);
  });
});

describe("send and onReceive", () => {
  it("delivers to every collider of the tag in the circle, nearest first, after every update of the step, and before it renders", () => {
    const log: string[] = [];
    const order: string[] = [];
    const sender = new Asker((self) => {
      order.push("sender update");
      self.send("enemy", { x: 100, y: 100, radius: 40 }, { damage: 3 });
    });
    const later = new Asker(() => order.push("later update"));
    const world = worldOf(
      sender,
      later,
      enemy(1, 130, 95, log),
      enemy(2, 95, 95, log),
      enemy(3, 300, 300, log),
      enemy(4, 95, 95, log, "ally")
    );
    world.tick(1 / 60);
    assert.deepEqual(log, ['2:{"damage":3}', '1:{"damage":3}'], "the tag's colliders in the circle, nearest first");
    assert.deepEqual(order, ["sender update", "later update"], "delivery waits for every update");
    world.tick(1 / 60);
    assert.equal(log.length, 4, "a send is delivered once, in its own step");
  });

  it("reaches the one collider a nearby result is, and nothing once that collider has left", () => {
    const log: string[] = [];
    const target = enemy(2, 95, 95, log);
    let keep: Nearby | null = null;
    const sender = new Asker((self) => {
      const found = self.nearby("enemy", 100, 100, 50);
      keep ??= found[0] ?? null;
      if (keep !== null) self.send("enemy", keep, "hit");
    });
    const world = worldOf(sender, enemy(1, 110, 95, log), target);
    world.tick(1 / 60);
    assert.deepEqual(log, ['2:"hit"'], "only the one found, not its neighbour");
    target.parent!.removeChild(target);
    world.flush();
    world.tick(1 / 60);
    assert.deepEqual(log, ['2:"hit"'], "it left: nothing is delivered, and nothing else is hit instead");
  });

  it("delivers a value sent from onReceive later in the same step, and stops a loop of receivers sending to each other", () => {
    const log: string[] = [];
    let world: World | null = null;
    const relay = new Collider({
      width: 10,
      height: 10,
      tag: "relay",
      onReceive: (value) => {
        log.push(`relay:${String(value)}`);
        world!.send("enemy", { x: 5, y: 5, radius: 100 }, `${String(value)}+relayed`);
      },
    });
    const sender = new Asker((self) => self.send("relay", { x: 5, y: 5, radius: 10 }, "ping"));
    world = worldOf(sender, relay, enemy(1, 20, 0, log));
    world.tick(1 / 60);
    assert.deepEqual(log, ["relay:ping", '1:"ping+relayed"'], "both in the step the first was sent");

    const echo = new Collider({ width: 10, height: 10, tag: "echo", onReceive: () => world2.send("echo", { x: 5, y: 5, radius: 10 }, 0) });
    const world2: World = worldOf(new Asker((self) => self.send("echo", { x: 5, y: 5, radius: 10 }, 0)), echo);
    assert.throws(() => world2.tick(1 / 60), /sending to each other without end/);
  });

  it("repeats exactly: the same sends give the same deliveries in the same order", () => {
    const run = (): string[] => {
      const log: string[] = [];
      const colliders = [0, 1, 2, 3, 4, 5].map((i) => enemy(i, (i * 37) % 90, (i * 53) % 90, log));
      let step = 0;
      const sender = new Asker((self) => {
        step++;
        for (const found of self.nearby("enemy", 45, 45, 40)) self.send("enemy", found, step);
        self.send("enemy", { x: 30, y: 60, radius: 25 }, -step);
      });
      const world = worldOf(sender, ...colliders);
      for (let i = 0; i < 5; i++) world.tick(1 / 60);
      return log;
    };
    const first = run();
    assert.ok(first.length > 10);
    assert.deepEqual(run(), first);
  });

  it("asks nothing and sends nothing for an object outside a world", () => {
    const loose = new Asker(() => {});
    assert.deepEqual(loose.nearby("enemy", 0, 0, 100), []);
    assert.doesNotThrow(() => loose.send("enemy", { x: 0, y: 0, radius: 10 }, 1));
  });
});
