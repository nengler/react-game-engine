import assert from "node:assert/strict";
/** `createGameState(data, actions)`: actions write a draft of the state directly; readers hear only what changed. */
import { describe, it } from "node:test";

import { createGameState, Entity } from "../src/index.ts";

type Screen = "title" | "play";

function make() {
  return createGameState(
    { screen: "title" as Screen, cursor: 0, open: false, run: { time: 0, finished: false }, gems: [] as number[] },
    {
      select(s, pad: number) {
        s.cursor = pad;
        s.open = true;
      },
      tick(s, dt: number) {
        if (!s.run.finished) s.run.time += dt;
      },
      gem(s, id: number) {
        s.gems.push(id);
        return s.gems.length;
      },
      begin(s) {
        s.screen = "play";
        useGame.actions().select(1);
      },
      fail(s) {
        s.cursor = 99;
        throw new Error("no");
      },
    }
  );
}
let useGame = make();

describe("createGameState(data, actions)", () => {
  it("binds the state: an action is called with its own arguments, and its writes are the state", () => {
    useGame = make();
    const { select, gem } = useGame.actions();
    select(3);
    assert.equal(useGame.getState().cursor, 3);
    assert.equal(useGame.getState().open, true);
    assert.equal(gem(7), 1, "an action's result is returned");
    assert.deepEqual(useGame.getState().gems, [7]);
  });

  it("keeps the identity of what an action did not change, and gives a new object for what it did", () => {
    useGame = make();
    const before = useGame.getState();
    useGame.actions().select(2);
    const after = useGame.getState();
    assert.equal(after.run, before.run, "run was not touched");
    assert.equal(after.gems, before.gems);
    useGame.actions().tick(0.5);
    assert.notEqual(useGame.getState().run, after.run);
    assert.equal(useGame.getState().run.time, 0.5);
    assert.equal(before.run.time, 0, "the state before is a snapshot: the action wrote a draft");
  });

  it("tells only the readers of a leaf that changed", () => {
    useGame = make();
    const cursorReader = new Entity();
    const runReader = new Entity();
    let marked: Entity[] = [];
    for (const e of [cursorReader, runReader]) e.markDirty = () => void marked.push(e);
    useGame.store.subscribe(cursorReader, ["cursor"]);
    useGame.store.subscribe(runReader, ["run.time"]);
    useGame.actions().select(4);
    assert.deepEqual(marked, [cursorReader]);
    marked = [];
    useGame.actions().select(4);
    assert.deepEqual(marked, [], "writing the same value changes nothing");
    useGame.actions().tick(1);
    assert.deepEqual(marked, [runReader]);
  });

  it("runs an action called from another on the same draft, and commits once, under the outer action's name", () => {
    useGame = make();
    useGame.store.recording = true;
    useGame.actions().begin();
    assert.equal(useGame.getState().screen, "play");
    assert.equal(useGame.getState().cursor, 1);
    assert.deepEqual(
      useGame.store.history.map((h) => [h.action, h.changes.map((c) => c.path).sort()]),
      [["begin", ["cursor", "open", "screen"]]]
    );
  });

  it("commits nothing when an action throws", () => {
    useGame = make();
    assert.throws(() => useGame.actions().fail(), /no/);
    assert.equal(useGame.getState().cursor, 0);
  });

  it("resets to the data it was made with, and keeps values without actions for rewind", () => {
    useGame = make();
    useGame.actions().select(5);
    assert.deepEqual(Object.keys(useGame.store.values()).sort(), ["cursor", "gems", "open", "run", "screen"]);
    useGame.store.reset();
    assert.equal(useGame.getState().cursor, 0);
    useGame.actions().gem(1);
    useGame.store.reset();
    assert.deepEqual(useGame.getState().gems, [], "the initial data was never written in place");
  });

  it("runs without structuredClone, which QuickJS-ng (the packaged build's engine) does not have", () => {
    const saved = globalThis.structuredClone;
    // @ts-expect-error: removed for this test, as it is under QuickJS-ng
    delete globalThis.structuredClone;
    try {
      useGame = make();
      useGame.actions().gem(3);
      useGame.actions().tick(0.25);
      assert.deepEqual(useGame.getState().gems, [3]);
      assert.equal(useGame.getState().run.time, 0.25);
    } finally {
      globalThis.structuredClone = saved;
    }
  });

  it("refuses a function in the data, and a name that is both", () => {
    assert.throws(() => createGameState({ f: () => 1 } as { f: () => number }, {}), /actions go in the second argument/);
    assert.throws(() => createGameState({ a: 1 }, { a() {} }), /both a value and an action/);
  });
});
