import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Entity, World, createGameState, resetGameState } from "../src/index.ts";

function counter() {
  return createGameState(
    { coins: 0, player: { hp: 10, name: "Ada" } },
    {
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
        s.coins = s.coins + 0;
      },
    }
  );
}

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

describe("createGameState", () => {
  it("refuses the removed `(set) => ({ … })` form with what to write", () => {
    assert.throws(() => (createGameState as (...a: unknown[]) => unknown)(() => ({ n: 1 })), /takes the data and the actions/);
  });

  it("reads a leaf, an object or an array by its dotted path", () => {
    const { store } = counter();
    assert.equal(store.get("coins"), 0);
    assert.equal(store.get("player.hp"), 10);
    assert.equal(store.get("player.name"), "Ada");
    assert.deepEqual(store.get("player"), { hp: 10, name: "Ada" });
    assert.throws(() => store.get("collect"), /'collect' is an action/);
    assert.throws(() => store.get("coins.x"), /nothing at 'coins\.x'/);
    assert.throws(() => store.get("nope"), /nothing at 'nope'/);
  });

  it("is a compile-time declaration when called", () => {
    const useGame = counter();
    assert.throws(() => (useGame as unknown as () => void)(), /compile-time declaration/);
  });

  it("runs actions, and setState (for tests and tools) merges shallowly like Zustand", () => {
    const useGame = counter();
    useGame.getState().collect(3);
    useGame.getState().collect(4);
    useGame.getState().hurt();
    assert.deepEqual([useGame.getState().coins, useGame.getState().player], [7, { hp: 9, name: "Ada" }]);
    useGame.setState({ player: { hp: 1, name: "Bo" } });
    assert.deepEqual(useGame.getState().player, { hp: 1, name: "Bo" }, "a nested object is replaced whole");
    assert.equal(useGame.getState().coins, 7, "keys not mentioned are kept");
    assert.equal(typeof useGame.getState().collect, "function", "so are the actions");
    useGame.setState((s) => ({ coins: s.coins * 2 }));
    assert.equal(useGame.getState().coins, 14);
    useGame.setState(null as never);
    assert.equal(useGame.getState().coins, 14);
  });

  it("refuses setState while an action runs, whose commit would overwrite it", () => {
    const useGame = createGameState(
      { n: 0 },
      {
        bad(s) {
          s.n = 1;
          useGame.setState({ n: 5 });
        },
      }
    );
    assert.throws(() => useGame.actions().bad(), /setState was called while the action 'bad' runs/);
    assert.equal(useGame.getState().n, 0, "the action's changes were not committed");
    useGame.setState({ n: 2 });
    assert.equal(useGame.getState().n, 2, "and the store works afterwards");
  });

  it("tells exactly the readers of a leaf that changed, once each, finding it inside a replaced object", () => {
    const useGame = counter();
    const { store } = useGame;
    const world = new World();
    const root = new Entity();
    const coins = reader(store, ["coins"]);
    const hp = reader(store, ["player.hp"]);
    const name = reader(store, ["player.name"]);
    const both = reader(store, ["coins", "player.hp"]);
    for (const object of [coins, hp, name, both]) root.addChild(object);
    world.mount(root);
    world.flush();
    const base = [coins, hp, name, both].map((o) => o.renders);
    const delta = () => [coins, hp, name, both].map((o, i) => o.renders - base[i]!);
    useGame.getState().collect(1);
    useGame.getState().collect(1);
    world.flush();
    assert.deepEqual(delta(), [1, 0, 0, 1], "readers of coins render once, for two writes");
    useGame.getState().hurt();
    world.flush();
    assert.deepEqual(delta(), [1, 1, 0, 2], "player was replaced, but only hp differs: name's reader is not told");
    useGame.getState().both();
    world.flush();
    assert.deepEqual(delta(), [2, 2, 0, 3], "a reader of two changed leaves renders once");
    useGame.getState().same();
    assert.equal(world.flush(), 0, "an action that changes no leaf renders nothing");
  });

  it("stops telling an object that left the world", () => {
    const useGame = counter();
    const world = new World();
    const root = new Entity();
    const object = reader(useGame.store, ["coins"]);
    root.addChild(object);
    world.mount(root);
    world.flush();
    root.removeChild(object);
    useGame.getState().collect(1);
    assert.equal(object.isDirty, false);
  });

  it("goes back to its initial data with resetGameState, telling readers", () => {
    const useGame = counter();
    const world = new World();
    const root = new Entity();
    const object = reader(useGame.store, ["coins"]);
    root.addChild(object);
    world.mount(root);
    world.flush();
    useGame.getState().collect(5);
    world.flush();
    const before = object.renders;
    resetGameState();
    assert.equal(useGame.getState().coins, 0);
    world.flush();
    assert.equal(object.renders, before + 1);
    useGame.getState().collect(1);
    assert.equal(useGame.getState().coins, 1, "its actions still work");
  });
});

describe("carrying a game state across a hot reload", () => {
  it("takes the old values that still fit and keeps the new actions", () => {
    const older = createGameState(
      { coins: 0, player: { hp: 10, name: "a" }, gone: 1 },
      {
        add(s) {
          s.coins += 1;
        },
      }
    );
    older.getState().add();
    older.setState({ player: { hp: 3, name: "b" } });

    const newer = createGameState(
      { coins: 0, player: { hp: 10, name: 0, mp: 5 }, list: [1] },
      {
        add(s) {
          s.coins += 10;
        },
      }
    );
    newer.store.carryFrom(older.store as never);
    const state = newer.getState();
    assert.equal(state.coins, 1);
    assert.deepEqual(state.player, { hp: 3, name: 0, mp: 5 }, "a leaf whose type changed, and a new leaf, keep the new values");
    assert.deepEqual(state.list, [1]);
    assert.equal("gone" in state, false);
    state.add();
    assert.equal(newer.getState().coins, 11, "the new build's action runs on the carried value");

    // The old store is forgotten: a reset no longer touches it, while the new one goes back to its own initial values.
    resetGameState();
    assert.equal(older.getState().coins, 1);
    assert.equal(newer.getState().coins, 0);
  });
});
