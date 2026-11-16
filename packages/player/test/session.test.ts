import assert from "node:assert/strict";
/** `Session`: a game driven a step at a time, read as text, snapshotted and played again. */
import { describe, it } from "node:test";

import { createGameState, Entity, Text, type InputState } from "@tsengine/runtime";

import { parseInputScript, runScript, Session, valueAt, type PlayerConfig } from "../src/index.ts";

const useScore = createGameState(
  { points: 0, best: { run: 0 } },
  {
    score(s: { points: number; best: { run: number } }) {
      s.points += 1;
      s.best = { run: Math.max(s.best.run, s.points) };
    },
  }
);

/** A hand-written component: moves right while ArrowRight is held, scores on Space, says where it is, and saves its x. */
class Walker extends Entity {
  static readonly managed = true;
  x = 0;
  readonly label = new Text({ text: "x=0" });
  typed = "";
  constructor() {
    super({ name: "Walker" });
    this.addChild(this.label);
  }
  override onUpdate(_dt: number, input: InputState): void {
    if (input.down("ArrowRight")) this.x += 2;
    if (input.pressed("Space")) useScore.store.getState().score();
    if (input.typed !== "") this.typed += input.typed;
    this.transform.x = this.x;
    this.label.text = this.x >= 40 ? "FAR" : `x=${this.x}`;
    this.markChanged();
  }
  override saveHotState(): Record<string, unknown> {
    return { "Walker.x": this.x, "Walker.typed": this.typed };
  }
  override loadHotState(saved: Record<string, unknown>): void {
    if (typeof saved["Walker.x"] === "number") this.x = saved["Walker.x"];
    if (typeof saved["Walker.typed"] === "string") this.typed = saved["Walker.typed"];
  }
}

const config: PlayerConfig = { root: () => new Walker(), width: 320, height: 180 };
const bindings = { right: "ArrowRight", jump: "Space" };
const walker = (session: Session): Record<string, unknown> => session.find("Walker")[0]!.state;

describe("Session", () => {
  it("plays an input script a step a frame, as runScript does", () => {
    const script = "right*10, jump, _, jump, right*5";
    const session = new Session(config, { bindings });
    assert.equal(session.input(script), 18);
    assert.equal(session.frame, 18);
    assert.deepEqual(walker(session), { x: 30, typed: "" });
    const run = runScript(config, parseInputScript(script, { bindings }), () => useScore.store.values());
    session.close();
    const again = new Session(config, { bindings });
    again.input(script);
    assert.deepEqual(again.gameState(), { state0: run.states.at(-1) }, "the same game state as the harness");
    again.close();
  });

  it("steps until a text shows, a component's state or the game state passes, or gives up", () => {
    const session = new Session(config, { bindings });
    session.input("right");
    assert.deepEqual(session.step({ until: { text: "FAR" }, maxSteps: 10 }), { steps: 10, reached: false }, "nothing is held: never");
    session.input("right*25");
    assert.equal(session.holds({ text: "FAR" }), true);
    assert.equal(session.holds({ gone: "FAR" }), false);
    assert.equal(session.holds({ component: "Walker", path: "x", above: 40 }), true);
    assert.equal(session.holds({ component: "Walker", path: "x", below: 40 }), false);
    assert.equal(session.holds({ component: "Nobody", absent: true }), true);
    session.input("jump, _, jump");
    assert.equal(session.holds({ path: "points", equals: 2 }), true, "one game state: the path needs no name");
    assert.equal(session.holds({ path: "state0.best.run", not: 0 }), true);
    const capped = session.step({ until: { text: "never" }, maxSteps: 5 });
    assert.deepEqual(capped, { steps: 5, reached: false });
    assert.equal(session.step({ count: 3 }).steps, 3);
    session.close();
  });

  it("describes the scene and reads texts", () => {
    const session = new Session(config, { bindings });
    session.input("right*3");
    assert.deepEqual(session.texts(), ["x=6"]);
    assert.equal(session.sceneText(), ['Walker @(6,0) state={x: 6, typed: ""}', '  Text "x=6"'].join("\n"));
    assert.equal(session.scene().children[0]?.text, "x=6");
    session.close();
  });

  it("snapshots and restores the game, and a replay of the same input reaches the same state", () => {
    const session = new Session(config, { bindings });
    session.input("right*5, jump");
    session.snapshot("start");
    const hash = session.hash();
    session.input("right*20, jump, _, jump");
    assert.notEqual(session.hash(), hash);
    session.restore("start");
    assert.equal(session.frame, 6);
    assert.equal(session.hash(), hash, "game state and tree as they were");
    assert.deepEqual(walker(session), { x: 10, typed: "" });
    assert.deepEqual(session.gameState(), { state0: { points: 1, best: { run: 1 } } });
    session.input("right*2");
    const after = session.hash();
    assert.equal(session.replay(), 8);
    assert.equal(session.hash(), after, "the same input from the start reaches the same state");
    assert.deepEqual(session.snapshots(), [{ name: "start", frame: 6 }]);
    assert.throws(() => session.restore("nope"), /No snapshot called 'nope' \(there are: start\)/);
    session.close();
  });

  it("types text into the step after, and keeps it in the history a replay plays", () => {
    const session = new Session(config, { bindings });
    assert.equal(session.type("hi"), 2);
    assert.equal(walker(session)["typed"], "hi");
    session.replay();
    assert.equal(walker(session)["typed"], "hi");
    session.close();
  });

  it("keeps the mouse where a script put it, as a held key", () => {
    const session = new Session(config, { bindings });
    session.input("mouse@30,40");
    session.step({ count: 2 });
    assert.deepEqual(session.history.at(-1)?.mouse, { x: 30, y: 40 });
    session.close();
  });

  it("collects the game's warnings until they are taken, and names the game states it is given", () => {
    const session = new Session(config, { bindings, storeNames: new Map([[useScore.store, "useScore"]]) });
    assert.deepEqual(Object.keys(session.gameState()), ["useScore"]);
    assert.deepEqual(session.takeWarnings(), []);
    session.close();
  });
});

describe("valueAt", () => {
  it("reads a dotted path through objects and arrays", () => {
    assert.equal(valueAt({ a: { b: [1, { c: 2 }] } }, "a.b.1.c"), 2);
    assert.equal(valueAt({ list: [1, 2, 3] }, "list.length"), 3);
    assert.equal(valueAt({ a: null }, "a.b"), undefined);
  });
});
