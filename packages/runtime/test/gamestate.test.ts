import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World, createGameState, resetGameState } from "../src/index.ts";

/** An object that reads the given paths of a store, the way generated code declares it. */
function reader(store: ReturnType<typeof counter>["store"], paths: string[]): Entity & { renders: number } {
  return new (class extends Entity {
    override readonly gameStateStore = store;
    override readonly gameStateKeys = paths;
    renders = 0;
    override render(): void {
      this.renders++;
    }
  })();
}

function counter() {
  return createGameState({ coins: 0, player: { hp: 10, name: "Ada" }, muted: false });
}

describe("createGameState", () => {
  it("reads a leaf by its dotted path", () => {
    const { store } = counter();
    assert.equal(store.get("coins"), 0);
    assert.equal(store.get("player.hp"), 10);
    assert.equal(store.get("player.name"), "Ada");
    assert.throws(() => store.get("player"), /no value at 'player'/);
    assert.throws(() => store.get("coins.x"), /nothing at 'coins\.x'/);
    assert.throws(() => store.get("nope"), /no value at 'nope'/);
  });

  it("is a compile-time declaration when called", () => {
    const useGame = counter();
    assert.throws(() => (useGame as unknown as () => void)(), /compile-time declaration/);
  });

  it("sets a leaf to a value, or to what an updater makes of the latest value", () => {
    const { store } = counter();
    store.set("coins", 5);
    store.set<number>("coins", (n) => n + 1);
    store.set<number>("coins", (n) => n * 10);
    store.set("player.name", "Bo");
    assert.deepEqual([store.get("coins"), store.get("player.name")], [60, "Bo"]);
  });

  it("tells exactly the readers of a leaf that changed, once each", () => {
    const { store } = counter();
    const world = new World();
    const root = new Entity();
    const coins = reader(store, ["coins"]);
    const hp = reader(store, ["player.hp"]);
    const both = reader(store, ["coins", "player.hp"]);
    for (const object of [coins, hp, both]) root.addChild(object);
    world.mount(root);
    world.flush();
    const base = [coins, hp, both].map((o) => o.renders);
    const delta = () => [coins, hp, both].map((o, i) => o.renders - base[i]!);
    store.set<number>("coins", (n) => n + 1);
    store.set<number>("coins", (n) => n + 1);
    world.flush();
    assert.deepEqual(delta(), [1, 0, 1], "readers of coins render once, for two writes");
    store.set("player.hp", 1);
    world.flush();
    assert.deepEqual(delta(), [1, 1, 2]);
    store.set("player.hp", 1);
    assert.equal(world.flush(), 0, "writing the value it already has renders nothing");
  });

  it("stops telling an object that left the world", () => {
    const { store } = counter();
    const world = new World();
    const root = new Entity();
    const object = reader(store, ["coins"]);
    root.addChild(object);
    world.mount(root);
    world.flush();
    root.removeChild(object);
    store.set("coins", 1);
    assert.equal(object.isDirty, false);
  });

  it("goes back to its initial state with resetGameState, telling readers", () => {
    const { store } = counter();
    const world = new World();
    const root = new Entity();
    const object = reader(store, ["coins"]);
    root.addChild(object);
    world.mount(root);
    world.flush();
    store.set("coins", 5);
    world.flush();
    const before = object.renders;
    resetGameState();
    assert.equal(store.get("coins"), 0);
    world.flush();
    assert.equal(object.renders, before + 1);
  });

  it("does not let the initial state be changed through what it was created from", () => {
    const initial = { coins: 0 };
    const { store } = createGameState(initial);
    store.set("coins", 3);
    assert.equal(initial.coins, 0);
  });
});
