import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, GameStateStore, World, getGameStateStore, readGameState, resetGameState, setGameState, setGameStateStore } from "../src/index.ts";

/** An object that reads `coins`, the way generated code declares it. */
class Reader extends Entity {
  override readonly gameStateKeys: readonly string[] = ["coins"];
  renders = 0;
  override render(): void {
    this.renders++;
  }
}

describe("GameStateStore", () => {
  it("creates a key from the initial value of whoever touches it first, then keeps its own value", () => {
    const store = new GameStateStore();
    assert.equal(store.read("coins", 5), 5);
    assert.equal(store.read("coins", 99), 5, "a later initial value is ignored");
    store.set("coins", 0, 7);
    assert.equal(store.read("coins", 0), 7);
  });

  it("chains updaters on the latest value, and does nothing for an unchanged write", () => {
    const store = new GameStateStore();
    const world = new World();
    const reader = new Reader();
    world.mount(reader);
    world.flush();
    store.subscribe(reader, ["coins"]);
    store.set<number>("coins", 0, (n) => n + 1);
    store.set<number>("coins", 0, (n) => n + 1);
    assert.equal(store.read("coins", 0), 2);
    assert.equal(world.flush(), 1, "one render for two writes");
    store.set("coins", 0, 2);
    assert.equal(world.flush(), 0, "the same value renders nothing");
  });

  it("tells only the objects that read the key, and only while they are in a world", () => {
    const store = new GameStateStore();
    setGameStateStore(store);
    const world = new World();
    const root = new Entity();
    const a = new Reader();
    const b = new Reader();
    const other = new Reader();
    (other as { gameStateKeys: readonly string[] }).gameStateKeys = ["lives"];
    root.addChild(a);
    root.addChild(b);
    root.addChild(other);
    world.mount(root);
    world.flush();
    const before = [a.renders, b.renders, other.renders];
    setGameState("coins", 0, 1);
    world.flush();
    assert.deepEqual([a.renders - before[0]!, b.renders - before[1]!, other.renders - before[2]!], [1, 1, 0]);
    root.removeChild(b);
    setGameState("coins", 0, 2);
    assert.equal(b.isDirty, false, "b left the world");
    assert.equal(world.flush(), 1);
  });

  it("resets to a store with nothing in it", () => {
    setGameState("coins", 0, 9);
    const old = getGameStateStore();
    const fresh = resetGameState();
    assert.notEqual(fresh, old);
    assert.equal(readGameState("coins", 0), 0);
  });
});
