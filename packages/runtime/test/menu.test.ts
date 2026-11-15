/** `<Button>` and `<Menu>`: a focusable box with a look, and a column whose items keep the focus, go round at the ends and hear `back`. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUTTON_DEFAULTS, Button, createControls, createInputState, Entity, Flex, Menu, Pointer, World, type GameObject, type InputSnapshot } from "../src/index.ts";

const controls = createControls({ left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"], confirm: ["Z"], back: ["X"] });
const press = (world: World, ...pressed: string[]): void => {
  const snapshot: InputSnapshot = { pressed };
  world.tick(1 / 60, createInputState(snapshot, controls));
};

function at<T extends GameObject>(object: T, x: number, y: number): T {
  object.transform.x = x;
  object.transform.y = y;
  return object;
}

/** A menu of three buttons, ten pixels apart down the screen, and a pointer outside it below. */
function threeItems(menuProps: ConstructorParameters<typeof Menu>[0] = {}) {
  const log: string[] = [];
  const world = new World();
  const root = new Entity();
  const menu = new Menu({ onBack: () => log.push("back"), ...menuProps });
  const items = ["a", "b", "c"].map((name, i) => at(new Button({ autoFocus: i === 0, onPress: () => log.push(`press ${name}`) }), 0, i * 10));
  for (const item of items) menu.addChild(item);
  const outside = at(new Pointer({ width: 4, height: 4, focusable: true }), 0, 35);
  root.addChild(menu);
  root.addChild(outside);
  world.mount(root);
  world.flush();
  press(world);
  return { log, world, items: items as [Button, Button, Button], outside };
}

describe("Button", () => {
  it("takes the focus and has a look of its own, which any prop replaces", () => {
    const plain = new Button();
    assert.equal(plain.focusable, true);
    assert.equal(plain.background, BUTTON_DEFAULTS.background);
    assert.equal(plain.focusBorderColor, BUTTON_DEFAULTS.focusBorderColor);
    assert.equal(plain.alignItems, "center");
    const styled = new Button({ background: "#ff0000", focusable: false, paddingX: undefined });
    assert.equal(styled.background, "#ff0000");
    assert.equal(styled.focusable, false);
    assert.equal(styled.paddingX, BUTTON_DEFAULTS.paddingX, "an undefined prop keeps the default");
  });
});

describe("Menu", () => {
  it("is a column, moves the focus among its items, and confirm presses the focused one", () => {
    const { log, world, items } = threeItems();
    assert.equal(new Menu().direction, "column");
    assert.equal(world.focused, items[0]);
    press(world, "ArrowDown");
    assert.equal(world.focused, items[1]);
    press(world, "Z");
    assert.deepEqual(log, ["press b"]);
  });

  it("goes round at the ends and never leaves for a focusable outside it", () => {
    const { world, items } = threeItems();
    press(world, "ArrowDown");
    press(world, "ArrowDown");
    assert.equal(world.focused, items[2]);
    press(world, "ArrowDown");
    assert.equal(world.focused, items[0], "down from the last is the first, not the pointer below");
    press(world, "ArrowUp");
    assert.equal(world.focused, items[2], "up from the first is the last");
  });

  it("with loop={false} stops at the ends", () => {
    const { world, items } = threeItems({ loop: false });
    press(world, "ArrowUp");
    assert.equal(world.focused, items[0]);
    press(world, "ArrowDown");
    press(world, "ArrowDown");
    press(world, "ArrowDown");
    assert.equal(world.focused, items[2]);
  });

  it("calls onBack for back while one of its items has the focus, and not otherwise", () => {
    const { log, world, outside } = threeItems();
    press(world, "X");
    world.focus(outside);
    press(world, "X");
    assert.deepEqual(log, ["back"]);
  });

  it("uses Escape for back when the controls have no back action", () => {
    const log: string[] = [];
    const world = new World();
    const menu = new Menu({ onBack: () => log.push("back") });
    menu.addChild(new Button({ autoFocus: true }));
    world.mount(menu);
    world.flush();
    world.tick(1 / 60, createInputState({ pressed: [] }));
    world.tick(1 / 60, createInputState({ pressed: ["Escape"] }));
    assert.deepEqual(log, ["back"]);
  });
});

describe("onAdjust", () => {
  it("hears left and right while the box has the focus, and keeps the focus; up and down still move it", () => {
    const log: string[] = [];
    const world = new World();
    const root = new Entity();
    const volume = at(new Flex({ width: 10, height: 10, focusable: true, autoFocus: true, onAdjust: (d) => log.push(`adjust ${d}`) }), 0, 0);
    const beside = at(new Flex({ width: 10, height: 10, focusable: true }), 20, 0);
    const below = at(new Flex({ width: 10, height: 10, focusable: true }), 0, 20);
    for (const box of [volume, beside, below]) root.addChild(box);
    world.mount(root);
    world.flush();
    press(world);
    press(world, "ArrowRight");
    press(world, "ArrowLeft");
    assert.equal(world.focused, volume, "left and right were used up");
    press(world, "ArrowDown");
    assert.equal(world.focused, below);
    press(world, "ArrowUp");
    press(world, "ArrowRight");
    assert.deepEqual(log, ["adjust 1", "adjust -1", "adjust 1"]);
  });
});
