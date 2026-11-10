import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Route, Router, Shape, World, type Transition } from "@rge/runtime";
import { createPlayer, RecordingBackend, type DecodedRecord } from "../src/index.ts";

const box = (color: string): Shape => new Shape({ kind: "rect", width: 4, height: 4, color });

function screens(initial: string, transition?: Transition, duration = 1): { router: Router; a: Route; b: Route; c: Route } {
  const router = new Router({ route: initial, transition, duration });
  const a = new Route({ name: "a" });
  const b = new Route({ name: "b" });
  const c = new Route({ name: "c" });
  a.addChild(box("#ff0000"));
  b.addChild(box("#00ff00"));
  c.addChild(box("#0000ff"));
  router.addChild(a);
  router.addChild(b);
  router.addChild(c);
  return { router, a, b, c };
}

const inWorld = (...routes: Route[]): boolean[] => routes.map((r) => r.world !== null);

describe("<Router>", () => {
  it("has only the shown route in the world, and switches at once without a transition", () => {
    const { router, a, b, c } = screens("a");
    const world = new World();
    world.mount(router);
    assert.deepEqual(inWorld(a, b, c), [true, false, false]);
    router.route = "b";
    world.tick(1 / 60);
    assert.deepEqual(inWorld(a, b, c), [false, true, false]);
    assert.equal(router.current, "b");
    assert.equal(router.transitioning, false);
  });

  it("keeps both screens in the world while a transition runs, asks the function for each frame, and settles at the end", () => {
    const calls: [number, string, string][] = [];
    const slide: Transition = (t, from, to) => {
      calls.push([t, from, to]);
      return { fromX: -100 * t, toX: 100 - 100 * t, cover: t < 0.5 ? t * 2 : 2 - t * 2, toVisible: t > 0.25 };
    };
    const { router, a, b } = screens("a", slide, 1);
    const world = new World();
    world.mount(router);
    router.route = "b";
    world.tick(0.1);
    assert.deepEqual(inWorld(a, b), [true, true], "both while it runs");
    assert.ok(router.transitioning);
    world.tick(0.4);
    assert.equal(calls.at(-1)?.[0], 0.5);
    assert.deepEqual(calls.at(-1)?.slice(1), ["a", "b"]);
    assert.equal(a.transform.x, -50);
    assert.equal(b.transform.x, 50);
    assert.equal(b.visible, true);
    assert.equal(router.cover, 1);
    world.tick(0.2);
    world.tick(0.4);
    assert.deepEqual(inWorld(a, b), [false, true], "the old screen leaves");
    assert.deepEqual([b.transform.x, b.visible, router.cover, router.transitioning], [0, true, 0, false], "the new one is where it belongs");
  });

  it("finishes a running transition before starting the next, and rejects a route that does not exist", () => {
    const { router, a, b, c } = screens("a", () => ({}), 1);
    const world = new World();
    world.mount(router);
    router.route = "b";
    world.tick(0.2);
    router.route = "c";
    world.tick(0.1);
    assert.deepEqual(inWorld(a, b, c), [false, true, true], "a is gone, b is being left for c");
    assert.throws(() => (router.route = "nope"), /no <Route name="nope"> \(routes: a, b, c\)/);
  });

  it("runs useMount and useUnmount of a screen as it comes and goes: the screen's children join and leave with it", () => {
    const events: string[] = [];
    class Probe extends Entity {
      override onMount(): void {
        events.push("mount");
      }
      override onUnmount(): void {
        events.push("unmount");
      }
    }
    const router = new Router({ route: "a" });
    const a = new Route({ name: "a" });
    const b = new Route({ name: "b" });
    b.addChild(new Probe());
    router.addChild(a);
    router.addChild(b);
    const world = new World();
    world.mount(router);
    assert.deepEqual(events, []);
    router.route = "b";
    world.tick(1 / 60);
    router.route = "a";
    world.tick(1 / 60);
    assert.deepEqual(events, ["mount", "unmount"]);
  });
});

describe("<Router> in a frame", () => {
  const rects = (frame: readonly DecodedRecord[]): Extract<DecodedRecord, { op: "rect" }>[] => frame.filter((r): r is Extract<DecodedRecord, { op: "rect" }> => r.op === "rect");

  it("draws only the shown screens (a hidden one is skipped), offset where the transition puts it, and a cover over everything", () => {
    const hide: Transition = (t) => ({ fromVisible: t < 0.5, toX: 10, cover: 0.5 });
    const { router } = screens("a", hide, 0.4);
    const backend = new RecordingBackend();
    for (let i = 0; i < 8; i++) backend.queueInput({ dt: 0.1 });
    const player = createPlayer(backend, { root: () => router, retain: "check" });
    player.step(); // warm-up, dt 0
    player.step();
    assert.deepEqual(rects(backend.lastFrame.records).map((r) => r.color), ["#ff0000ff"], "only a");
    router.route = "b";
    player.step(); // a quarter of the way: both screens, and the cover
    const mid = rects(backend.lastFrame.records);
    assert.deepEqual(mid.map((r) => r.color.slice(0, 7)), ["#ff0000", "#00ff00", "#000000"], "a, b, then the cover");
    assert.equal(mid[1]?.x, 10, "b is where the transition put it");
    assert.equal(mid[2]?.color, "#00000080", "half covered");
    player.step(); // half way: a is hidden
    assert.deepEqual(rects(backend.lastFrame.records).map((r) => r.color.slice(0, 7)), ["#00ff00", "#000000"], "a is skipped once the transition hides it");
    player.step();
    player.step();
    player.step();
    assert.deepEqual(rects(backend.lastFrame.records).map((r) => r.color), ["#00ff00ff"], "settled: only b, in place, no cover");
    player.close();
  });
});
