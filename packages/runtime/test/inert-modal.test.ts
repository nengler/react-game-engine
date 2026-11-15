import assert from "node:assert/strict";
// `inert` and `modal` on a container: which subtrees hear input, as the HTML attribute and a `<dialog>` opened with `showModal()`.
import { describe, it } from "node:test";

import { Entity, Pointer, World, createInputState, type InputState } from "../src/index.ts";

/** An entity that writes what its `onInput` and `onUpdate` heard of Enter. */
class Listener extends Entity {
  readonly heard: string[] = [];
  constructor(name: string, host: { inert?: boolean; modal?: boolean } = {}) {
    super({ name, ...host });
  }
  override onInput(input: InputState): void {
    if (input.pressed("Enter")) this.heard.push("input");
  }
  override onUpdate(_dt: number, input?: InputState): void {
    if (input?.pressed("Enter")) this.heard.push("update");
  }
}

const enter = createInputState({ pressed: ["Enter"] });

/** Tick once with Enter pressed and return who heard it, then forget. */
function press(world: World, ...listeners: Listener[]): string[] {
  world.tick(0.016, enter);
  const out = listeners.filter((l) => l.heard.length > 0).map((l) => l.name);
  for (const l of listeners) l.heard.length = 0;
  return out;
}

describe("inert", () => {
  it("silences a subtree's input, set in the props or later, and its pointers cannot be pressed", () => {
    const world = new World();
    const root = new Listener("root");
    const menu = new Listener("menu", { inert: true });
    const item = new Listener("item");
    const button = new Pointer({ width: 10, height: 10, onPress: () => item.heard.push("press") });
    menu.addChild(item);
    menu.addChild(button);
    root.addChild(menu);
    world.mount(root);
    assert.deepEqual(press(world, root, menu, item), ["root"]);
    assert.equal(world.reportPress(button, 5, 5), false);
    menu.inert = false;
    assert.deepEqual(press(world, root, menu, item), ["root", "menu", "item"]);
    assert.equal(world.reportPress(button, 5, 5), true);
  });

  it("is kept across leaving and joining a world", () => {
    const world = new World();
    const a = new Listener("a", { inert: true });
    world.mount(a);
    world.root.removeChild(a);
    world.mount(a);
    assert.deepEqual(press(world, a), []);
  });
});

describe("modal", () => {
  it("makes everything outside it inert, its ancestors too, while it is mounted", () => {
    const world = new World();
    const play = new Listener("play");
    const side = new Listener("side");
    const pause = new Listener("pause", { modal: true });
    const menu = new Listener("menu");
    pause.addChild(menu);
    world.mount(play);
    world.mount(side);
    assert.deepEqual(press(world, play, side), ["play", "side"]);
    play.addChild(pause);
    assert.deepEqual(press(world, play, side, pause, menu), ["pause", "menu"]);
    play.removeChild(pause);
    assert.deepEqual(press(world, play, side, pause, menu), ["play", "side"]);
  });

  it("gives the input to the modal mounted last, and back to the one below when it goes", () => {
    const world = new World();
    const outer = new Listener("outer", { modal: true });
    const inner = new Listener("inner", { modal: true });
    world.mount(outer);
    assert.deepEqual(press(world, outer), ["outer"]);
    outer.addChild(inner);
    assert.deepEqual(press(world, outer, inner), ["inner"], "the inner one is over the outer one, its own ancestor");
    outer.removeChild(inner);
    assert.deepEqual(press(world, outer, inner), ["outer"]);
    outer.modal = false;
    const other = new Listener("other");
    world.mount(other);
    assert.deepEqual(press(world, outer, other), ["outer", "other"], "turning modal off gives everyone the input");
  });

  it("keeps the keys that press things and the focus inside it", () => {
    const world = new World();
    const pressed: string[] = [];
    const behind = new Pointer({ width: 10, height: 10, pressKey: "Enter", focusable: true, onPress: () => pressed.push("behind") });
    const dialog = new Entity({ name: "dialog", modal: true });
    const ok = new Pointer({ width: 10, height: 10, pressKey: "Enter", focusable: true, onPress: () => pressed.push("ok") });
    dialog.addChild(ok);
    const screen = new Entity();
    screen.addChild(behind);
    world.mount(screen);
    world.focus(behind);
    screen.addChild(dialog);
    world.tick(0.016, enter);
    assert.deepEqual(pressed, ["ok"], "only the button inside heard its key");
    assert.equal(world.focused, null, "the focus left what the modal made inert");
    world.tick(0.016, createInputState({ pressed: ["ArrowDown"] }));
    assert.equal(world.focused, ok, "the arrows move the focus among the modal's buttons only");
    screen.removeChild(dialog);
    world.flush();
    world.tick(0.016, createInputState({ pressed: [] }));
    assert.equal(world.focused, behind, "the focus goes back to what had it when the modal closes");
  });

  it("gives the focus back after a modal only if it is still there, and before autoFocus", () => {
    const world = new World();
    const first = new Pointer({ width: 10, height: 10, focusable: true, autoFocus: true });
    const second = new Pointer({ width: 10, height: 10, focusable: true });
    second.transform.y = 20;
    const root = new Entity();
    root.addChild(first);
    root.addChild(second);
    world.mount(root);
    world.flush();
    world.focus(second);
    const prompt = new Entity({ modal: true });
    root.addChild(prompt);
    world.flush();
    world.tick(0.016, createInputState({ pressed: [] }));
    assert.equal(world.focused, null);
    root.removeChild(prompt);
    world.flush();
    world.tick(0.016, createInputState({ pressed: [] }));
    assert.equal(world.focused, second, "not the autoFocus one");
  });
});
