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
  return createGameState({
    state: { coins: 0, player: { hp: 10, name: "Ada" }, muted: false },
    actions: {
      collect(s, n: number) {
        s.coins += n;
      },
      hurt(s) {
        s.player.hp -= 1;
      },
      both(s) {
        s.coins += 1;
        s.player.hp -= 1;
      },
      same(s) {
        s.coins = s.coins;
      },
      explode(s) {
        s.coins = -1;
        throw new Error("explode");
      },
    },
  });
}

describe("createGameState", () => {
  it("reads a leaf by its dotted path", () => {
    const { store } = counter();
    assert.equal(store.get("coins"), 0);
    assert.equal(store.get("player.hp"), 10);
    assert.equal(store.get("player.name"), "Ada");
    assert.throws(() => store.get("player"), /no value at 'player'/);
    assert.throws(() => store.get("coins.x"), /nothing at 'coins\.x'/);
  });

  it("is a compile-time declaration when called", () => {
    const useGame = counter();
    assert.throws(() => (useGame as unknown as () => void)(), /compile-time declaration/);
  });

  it("runs an action on a copy, with its arguments, and keeps the result", () => {
    const { store } = counter();
    store.run("collect", [3]);
    store.run("collect", [4]);
    store.run("hurt");
    assert.deepEqual([store.get("coins"), store.get("player.hp")], [7, 9]);
  });

  it("drops everything an action did when it throws", () => {
    const { store } = counter();
    assert.throws(() => store.run("explode"), /explode/);
    assert.equal(store.get("coins"), 0);
  });

  it("tells exactly the readers of the paths an action changed, once each", () => {
    const { store } = counter();
    const world = new World();
    const root = new Entity();
    const coins = reader(store, ["coins"]);
    const hp = reader(store, ["player.hp"]);
    const both = reader(store, ["coins", "player.hp"]);
    const name = reader(store, ["player.name"]);
    for (const object of [coins, hp, both, name]) root.addChild(object);
    world.mount(root);
    world.flush();
    const base = [coins, hp, both, name].map((o) => o.renders);
    store.run("collect", [1]);
    world.flush();
    assert.deepEqual([coins, hp, both, name].map((o, i) => o.renders - base[i]!), [1, 0, 1, 0], "only readers of coins");
    store.run("both");
    world.flush();
    assert.deepEqual([coins, hp, both, name].map((o, i) => o.renders - base[i]!), [2, 1, 2, 0], "a reader of two changed paths renders once");
    store.run("same");
    assert.equal(world.flush(), 0, "an action that changes nothing renders nothing");
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
    store.run("collect", [1]);
    assert.equal(object.isDirty, false);
  });

  it("goes back to its initial state with resetGameState, telling readers, and keeps its actions", () => {
    const { store } = counter();
    const world = new World();
    const root = new Entity();
    const object = reader(store, ["coins"]);
    root.addChild(object);
    world.mount(root);
    world.flush();
    store.run("collect", [5]);
    world.flush();
    const before = object.renders;
    resetGameState();
    assert.equal(store.get("coins"), 0);
    world.flush();
    assert.equal(object.renders, before + 1);
    store.run("collect", [1]);
    assert.equal(store.get("coins"), 1);
  });

  it("does not let the initial state be changed through what it was created from", () => {
    const initial = { coins: 0 };
    const { store } = createGameState({ state: initial, actions: { collect(s) { s.coins += 1; } } });
    store.run("collect");
    assert.equal(initial.coins, 0);
  });
});
