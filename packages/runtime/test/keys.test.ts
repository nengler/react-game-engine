/** Keys that press things: `pressKey` (a button's own shortcut), the focus (`focusable`, `autoFocus`) and the arrow keys moving it. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createControls, createInputState, Entity, Flex, Pointer, World, type InputSnapshot, type Pressable } from "../src/index.ts";

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
    world.focus(a);
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

describe("disabled", () => {
  it("swallows a click without pressing or focusing, so what is under it gets nothing, and answers neither pressKey nor confirm", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const off = new Flex({ width: 10, height: 10, disabled: true, focusable: true, autoFocus: true, pressKey: "wave", onPress: () => log.push("off"), onFocus: () => log.push("focus off") });
    root.addChild(off);
    world.mount(root);
    world.flush();
    press(world, "Space");
    press(world, "Z");
    assert.equal(world.focused, null, "autoFocus does not take a disabled one");
    off.box.size[0] = 10;
    off.box.size[1] = 10;
    assert.equal(world.reportPress(off, 5, 5), true, "a click on it is hit, which keeps it from reaching what is under it");
    assert.equal(world.reportPress(off, 50, 5), false, "and a click off it is not");
    assert.equal(world.pressed, null, "it is never pressed");
    assert.equal(world.focused, null, "and a click does not focus it");
    assert.deepEqual(log, []);
    off.disabled = false;
    press(world, "Space");
    assert.deepEqual(log, ["focus off", "off"], "switched back on, it takes its autoFocus and answers its key");
  });

  it("is skipped by the arrow keys, and loses the focus it had when it is switched off", () => {
    const world = new World();
    const root = new Entity();
    const a = at(new Pointer({ width: 10, height: 10, focusable: true }), 0, 0);
    const b = at(new Pointer({ width: 10, height: 10, focusable: true, disabled: true }), 40, 0);
    const c = at(new Pointer({ width: 10, height: 10, focusable: true }), 80, 0);
    root.addChild(a);
    root.addChild(b);
    root.addChild(c);
    world.mount(root);
    world.flush();
    world.focus(a);
    assert.equal(world.focused, a);
    press(world, "ArrowRight");
    assert.equal(world.focused, c, "the focus goes past the disabled one");
    c.disabled = true;
    press(world);
    assert.equal(world.focused, null, "a focused one that is switched off lets go of the focus");
  });
});

describe("onPressAt and onNavigate", () => {
  it("tells a pressable where it was pressed, before onPress, and not when it is disabled or the press missed", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const button: Pointer & Pressable = new Pointer({ width: 10, height: 10, onPress: () => log.push("press") });
    button.onPressAt = (x: number, y: number) => log.push(`at ${x},${y}`);
    root.addChild(button);
    world.mount(root);
    world.flush();
    world.reportPress(button, 4, 6);
    world.reportPress(button, 40, 6);
    button.disabled = true;
    world.reportPress(button, 4, 6);
    assert.deepEqual(log, ["at 4,6", "press"]);
  });

  it("lets a focused pressable use a direction itself, so the focus stays, and moves the focus on when it does not", () => {
    const world = new World();
    const root = new Entity();
    const used: string[] = [];
    const a: Pointer & Pressable = at(new Pointer({ width: 10, height: 10, focusable: true }), 0, 0);
    a.onNavigate = (dx: number, dy: number) => {
      used.push(`${dx},${dy}`);
      return dx !== 0; // left and right are its; up and down are not
    };
    const right = at(new Pointer({ width: 10, height: 10, focusable: true }), 40, 0);
    const below = at(new Pointer({ width: 10, height: 10, focusable: true }), 0, 40);
    for (const p of [a, right, below]) root.addChild(p);
    world.mount(root);
    world.flush();
    world.focus(a);
    press(world, "ArrowRight");
    assert.equal(world.focused, a, "it used right");
    press(world, "ArrowDown");
    assert.equal(world.focused, below, "it did not use down");
    assert.deepEqual(used, ["1,0", "0,1"]);
  });
});

describe("pressed", () => {
  it("is the pressable a click landed on, until the button is let go", () => {
    const world = new World();
    const root = new Entity();
    const button = new Pointer({ width: 10, height: 10, onPress: () => {} });
    root.addChild(button);
    world.mount(root);
    world.flush();
    assert.equal(world.pressed, null);
    world.reportPress(button, 5, 5);
    assert.equal(world.pressed, button);
    world.reportRelease();
    assert.equal(world.pressed, null);
    world.reportPress(button, 5, 5);
    root.removeChild(button);
    world.flush();
    assert.equal(world.pressed, null, "a removed one is not pressed any more");
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
