import assert from "node:assert/strict";
/** `Session`: a game driven a step at a time, read as text, snapshotted and played again. */
import { describe, it } from "node:test";

import { Camera, createGameState, Entity, Hud, Pointer, Text, type InputState } from "@tsengine/runtime";

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

describe("Session's log", () => {
  it("lists what changed by frame, counts what happens often, and follows watched values", () => {
    const session = new Session(config, { bindings });
    assert.equal(session.takeLog(), null, "nothing has happened yet");
    assert.equal(session.watch("Walker.x"), 0);
    session.input("right*25, jump, _");
    const log = session.takeLog()!;
    assert.deepEqual(log.events, ['frame 20: "FAR"', "frame 26: state0.points 0→1  state0.best.run 0→1"]);
    assert.deepEqual(log.often, ['19 new texts like "x=38" (last at frame 19)']);
    assert.deepEqual(log.watched?.["Walker.x"]?.slice(0, 3), [
      [0, 0],
      [1, 2],
      [2, 4],
    ]);
    assert.deepEqual(log.watched?.["Walker.x"]?.at(-1), [25, 50]);
    session.step({ count: 3 });
    assert.equal(session.takeLog(), null, "nothing changed: no log, and a watched value that held still says nothing");
    assert.equal(session.valueOf("state0.points"), 1);
    assert.deepEqual(session.valueOf("Walker"), { x: 50, typed: "" });
    assert.equal(session.valueOf("Nobody.x"), undefined);
    assert.throws(() => session.watch("Nobody.x"), /nothing at 'Nobody\.x'/);
    assert.equal(session.unwatch("Walker.x"), true);
    assert.deepEqual(session.watching, []);
    session.close();
  });
});

/** A field with a camera on a hero far to the right, a button in the world near it and one on the HUD, and a list of keyed tiles. */
class Field extends Entity {
  static readonly managed = true;
  presses: string[] = [];
  constructor() {
    super({ name: "Field" });
    const camera = new Camera({});
    const hero = new Entity({ name: "Hero" });
    hero.transform.x = 1000;
    hero.transform.y = 500;
    camera.addChild(hero);
    this.addChild(camera);
    const button = new Pointer({ width: 20, height: 10 });
    button.onPress = () => this.presses.push("world");
    const holder = new Entity({ name: "WorldButton" });
    holder.transform.x = 990;
    holder.transform.y = 480;
    holder.addChild(button);
    this.addChild(holder);
    const hud = new Hud({});
    const menu = new Pointer({ width: 40, height: 12 });
    menu.onPress = () => this.presses.push("hud");
    const holderHud = new Entity({ name: "MenuButton" });
    holderHud.transform.x = 4;
    holderHud.transform.y = 4;
    holderHud.addChild(menu);
    hud.addChild(holderHud);
    this.addChild(hud);
    for (const key of [1, 2]) {
      const tile = new Entity({ name: "Tile" });
      tile.hotKey = key;
      const p = new Pointer({ width: 10, height: 10 });
      p.onPress = () => this.presses.push(`tile ${key}`);
      tile.transform.x = 900 + key * 20;
      tile.transform.y = 450;
      tile.addChild(p);
      this.addChild(tile);
    }
    this.addChild(new Entity({ name: "Plain" }));
  }
  override saveHotState(): Record<string, unknown> {
    return { "Field.presses": this.presses.join(",") };
  }
}

describe("Session.press and view", () => {
  it("clicks a thing by name through the camera, or through the HUD's view, as two recorded steps", () => {
    let field: Field | null = null;
    const session = new Session({ root: () => (field = new Field()), width: 320, height: 180 });
    assert.deepEqual(session.view(), { x: 840, y: 410, width: 320, height: 180 }, "the camera centres the hero");
    assert.deepEqual(session.press("WorldButton"), { x: 160, y: 75 }, "its middle (1000, 485), through the view");
    assert.equal(session.frame, 2);
    session.press("MenuButton");
    session.press("Tile[key=2]");
    assert.deepEqual(field!.presses, ["world", "hud", "tile 2"]);
    assert.deepEqual(session.history[0]?.pressed, ["MouseLeft"]);
    session.replay();
    assert.deepEqual(field!.presses, ["world", "hud", "tile 2"], "a replay clicks the same");
    assert.throws(() => session.press("Nobody"), /nothing called 'Nobody'/);
    assert.throws(() => session.press("Plain"), /'Plain' has nothing pressable.*Pressable now: .*WorldButton.*MenuButton/);
    assert.equal(session.find("Tile[key=1]").length, 1);
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
