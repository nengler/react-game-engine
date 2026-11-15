import assert from "node:assert/strict";
/** `<TextInput>`: typed characters from the backend (`Backend.typed`, ABI v9) go into the focused field, through the player's loop. */
import { describe, it } from "node:test";

import { Button, createControls, createInputState, Entity, Flex, Game, TextInput, World, type GameObject } from "@rge/runtime";

import { createPlayer } from "../src/loop.ts";
import { RecordingBackend, type DecodedRecord } from "../src/recording.ts";

const controls = createControls({
  confirm: ["Z", "Enter"],
  back: ["X", "Escape"],
  up: ["ArrowUp", "W"],
  down: ["ArrowDown", "S"],
  left: ["ArrowLeft", "A"],
  right: ["ArrowRight", "D"],
});

/** A world with a field, focused, and a button below it; `type` runs a step with what was typed and the keys pressed. */
function field(props: ConstructorParameters<typeof TextInput>[0] = {}) {
  const log: string[] = [];
  const world = new World();
  const root = new Flex({ direction: "column" });
  const input = new TextInput({
    autoFocus: true,
    onChange: (v) => log.push(`change ${v}`),
    onSubmit: (v) => log.push(`submit ${v}`),
    ...props,
  });
  const button = new Button({ onPress: () => log.push("press"), pressKey: "M" });
  button.transform.y = 20; // below the field, for the focus to go down to (no layout runs here)
  root.addChild(input);
  root.addChild(button);
  world.mount(root);
  world.flush();
  const type = (typed: string, ...pressed: string[]): void => void world.tick(1 / 60, createInputState({ typed, pressed }, controls));
  type("");
  return { log, world, input, button, type };
}

describe("TextInput", () => {
  it("takes what is typed while it has the focus, Backspace takes the last character off, and onChange hears each change", () => {
    const { log, input, type } = field();
    type("hé");
    type("y!");
    type("\b");
    assert.equal(input.value, "héy");
    assert.equal(input.label.text, "héy");
    assert.deepEqual(log, ["change hé", "change héy!", "change héy"]);
  });

  it("does nothing with typing when it does not have the focus, or is disabled", () => {
    const { input, button, world, type } = field();
    world.focus(button);
    type("abc");
    assert.equal(input.value, "");
    world.focus(input);
    input.disabled = true;
    type("abc");
    assert.equal(input.value, "");
  });

  it("stops at maxLength, and a Backspace on an empty field says nothing", () => {
    const { log, input, type } = field({ maxLength: 3 });
    type("\b");
    type("abcdef");
    assert.equal(input.value, "abc");
    assert.deepEqual(log, ["change abc"]);
  });

  it("submits on Enter, and letters bound to actions or a pressKey do nothing else while it has the focus", () => {
    const { log, input, world, type } = field();
    type("zxm", "Z", "X", "M");
    assert.equal(input.value, "zxm");
    assert.equal(world.focused, input, "x (back) did not leave, and no action moved the focus");
    type("", "Enter");
    assert.deepEqual(log, ["change zxm", "submit zxm"], "z (confirm) and m (the button's pressKey) pressed nothing");
  });

  it("keeps left and right, and lets down move the focus on", () => {
    const { log, world, input, button, type } = field();
    type("", "ArrowLeft");
    type("", "D");
    assert.equal(world.focused, input);
    type("", "ArrowDown");
    assert.equal(world.focused, button);
    type("", "M");
    type("", "Z");
    assert.deepEqual(log, ["press", "press"], "off the field, the pressKey and confirm work again");
  });

  it("shows the placeholder while empty, and follows a value set from outside", () => {
    const { input, type } = field({ placeholder: "Your name", value: "" });
    assert.equal(input.label.text, "Your name");
    assert.equal(input.label.color, "#8088a0");
    type("A");
    assert.equal(input.label.text, "A");
    assert.equal(input.label.color, "white", "the default text colour");
    input.value = "";
    assert.equal(input.label.text, "Your name");
  });
});

describe("TextInput in the player", () => {
  it("gets the frame's typing from the backend once, and draws a caret after the text while it has the focus", () => {
    let field: TextInput | null = null;
    const root = (): GameObject => {
      const game = new Game({ width: 200, height: 100 });
      field = new TextInput({ autoFocus: true, width: 80 });
      game.addChild(field);
      return game;
    };
    const backend = new RecordingBackend();
    const p = createPlayer(backend, { width: 200, height: 100, title: "test", root, warn: () => {} });
    p.step();
    backend.queueInput({ typed: "ab" });
    p.step(); // the backend reports "ab" at the end of this frame
    p.step(); // and the next frame's first step takes it
    p.step();
    assert.equal(field!.value, "ab", "taken once");
    const caret = backend.lastFrame.records.find((r): r is DecodedRecord & { op: "box" } => r.op === "box" && r.width === 1);
    assert.ok(caret, "a caret");
    assert.ok(caret.x > field!.label.layoutX, "after the text");
    p.close();
  });

  it("is a leaf to the compiler (no children) and an Entity can hold it", () => {
    const e = new Entity();
    e.addChild(new TextInput());
    assert.equal((e.children[0] as TextInput).children.length, 1, "only its own label");
  });
});
