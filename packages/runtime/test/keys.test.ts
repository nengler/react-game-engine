/** Keys that press things: `pressKey` (a button's own shortcut), the focus (`focusable`, `autoFocus`) and the arrow keys moving it. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createControls, createInputState, Entity, Flex, Pointer, World, type InputSnapshot } from "../src/index.ts";

const controls = createControls({ wave: ["Space"], left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"], confirm: ["Z"] });
const press = (world: World, ...pressed: string[]): void => {
  const snapshot: InputSnapshot = { pressed };
  world.tick(1 / 60, createInputState(snapshot, controls));
};

function at(pointer: Pointer, x: number, y: number): Pointer {
  pointer.transform.x = x;
  pointer.transform.y = y;
  return pointer;
}

describe("pressKey", () => {
  it("presses a mounted pressable when its key or action is pressed, not an inert or removed one", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const button = new Flex({ pressKey: "wave", onPress: () => log.push("wave") });
    const key = new Pointer({ width: 1, height: 1, pressKey: "S", onPress: () => log.push("S") });
    root.addChild(button);
    root.addChild(key);
    world.mount(root);
    world.flush();
    press(world, "Space");
    press(world, "S");
    press(world, "Z");
    world.setInert(button, true);
    press(world, "Space");
    world.setInert(button, false);
    root.removeChild(key);
    world.flush();
    press(world, "S");
    assert.deepEqual(log, ["wave", "S"]);
  });
});

describe("focus", () => {
  it("auto-focuses, moves with the direction actions to the nearest focusable that way, and confirm presses it", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const make = (name: string, x: number, y: number, auto = false): Pointer =>
      at(new Pointer({ width: 10, height: 10, focusable: true, autoFocus: auto, onPress: () => log.push(`press ${name}`), onFocus: () => log.push(`focus ${name}`), onBlur: () => log.push(`blur ${name}`) }), x, y);
    const a = make("a", 0, 0, true);
    const b = make("b", 40, 2);
    const c = make("c", 100, 0);
    const d = make("d", 0, 40);
    for (const p of [a, b, c, d]) root.addChild(p);
    root.addChild(at(new Pointer({ width: 10, height: 10 }), 20, 0)); // not focusable: skipped
    world.mount(root);
    world.flush();
    press(world);
    assert.equal(world.focused, a);
    press(world, "ArrowRight");
    assert.equal(world.focused, b, "the nearest to the right, not the farther one");
    press(world, "ArrowRight");
    press(world, "ArrowRight"); // nothing further right: stays
    press(world, "Z");
    press(world, "ArrowLeft");
    press(world, "ArrowLeft");
    press(world, "ArrowDown");
    assert.deepEqual(log, ["focus a", "blur a", "focus b", "blur b", "focus c", "press c", "blur c", "focus b", "blur b", "focus a", "blur a", "focus d"]);
  });

  it("a click on a focusable focuses it before pressing it; a removed focused one lets the next autoFocus take it", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const one = new Pointer({ width: 10, height: 10, focusable: true, onFocus: () => log.push("focus one"), onPress: () => log.push("press one") });
    const two = at(new Pointer({ width: 10, height: 10, focusable: true, autoFocus: true, onFocus: () => log.push("focus two") }), 50, 0);
    root.addChild(one);
    root.addChild(two);
    world.mount(root);
    world.flush();
    assert.equal(world.reportPress(one, 5, 5), true);
    assert.equal(world.focused, one);
    root.removeChild(one);
    world.flush();
    press(world);
    assert.equal(world.focused, two);
    assert.deepEqual(log, ["focus one", "press one", "focus two"]);
  });

  it("uses the arrow keys and Enter when the controls have no direction or confirm actions", () => {
    const world = new World();
    const root = new Entity();
    let pressed = 0;
    const a = new Pointer({ width: 4, height: 4, focusable: true, autoFocus: true });
    const b = at(new Pointer({ width: 4, height: 4, focusable: true, onPress: () => pressed++ }), 0, 20);
    root.addChild(a);
    root.addChild(b);
    world.mount(root);
    world.flush();
    world.tick(1 / 60, createInputState({ pressed: ["ArrowDown"] }));
    world.tick(1 / 60, createInputState({ pressed: ["Enter"] }));
    assert.equal(world.focused, b);
    assert.equal(pressed, 1);
  });
});

describe("Pointer origin", () => {
  it("moves the area so its origin is at the pointer's position", () => {
    const pointer = new Pointer({ width: 10, height: 10, originX: 5, originY: 5 });
    assert.equal(pointer.contains(-4, -4), true);
    assert.equal(pointer.contains(6, 0), false);
    assert.deepEqual(pointer.focusPoint(), { x: 0, y: 0 });
  });
});

describe("Controls.label", () => {
  it("names an action's first key for the screen", () => {
    const c = createControls({ wave: ["Space", "PadY"], pause: ["Escape"], left: ["ArrowLeft"], one: ["1"] });
    assert.deepEqual([c.label("wave"), c.label("pause"), c.label("left"), c.label("one"), c.label("other")], ["Space", "Esc", "Left", "1", "other"]);
  });
});
