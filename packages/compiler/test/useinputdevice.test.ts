import assert from "node:assert/strict";
/** `useInputDevice()`: what the player is using, kept up to date (the shipped hook over `getInputDevice()`). */
import { after, describe, it } from "node:test";

import { Entity, Flex, Text, World, setInputDevice } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
  setInputDevice("pointer");
});

const PROMPT = `export function Prompt() {
  const device = useInputDevice();
  return <Entity><Text>{device === "keyboard" ? "Press Enter" : device === "gamepad" ? "Press A" : "Tap"}</Text></Entity>;
}`;

describe("useInputDevice", () => {
  it("reads the device at mount, follows it, renders only when it changes, and stops listening when the component leaves", async () => {
    const compiled = compile(PROMPT);
    assert.deepEqual(typeCheck(compiled), []);
    const { Prompt } = await load<{ Prompt: new () => Entity }>(compiled);
    setInputDevice("pointer");
    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const prompt = new Prompt();
    root.addChild(prompt);
    world.flush();
    const text = (): string => (prompt.children[0] as Text).text;
    assert.equal(text(), "Tap");

    let renders = 0;
    const render = prompt.render.bind(prompt);
    prompt.render = () => {
      renders++;
      render();
    };
    setInputDevice("pointer");
    world.flush();
    assert.equal(renders, 0, "the same device: nothing to render");
    setInputDevice("keyboard");
    world.flush();
    assert.equal(text(), "Press Enter");
    assert.equal(renders, 1);
    setInputDevice("gamepad");
    world.flush();
    assert.equal(text(), "Press A");

    root.removeChild(prompt);
    world.flush();
    setInputDevice("keyboard");
    world.flush();
    assert.equal(renders, 2, "it stopped listening when it left");

    // A screen made after a key was pressed is worded for the keyboard from its first frame.
    const late = new Prompt();
    root.addChild(late);
    world.flush();
    assert.equal((late.children[0] as Text).text, "Press Enter");
  });
});

const SHELF = `export function Shelf() {
  const s = useMutable({ heard: [] as string[] });
  const start = (x: number) => {
    s.heard = [...s.heard, \`start \${x}\`];
  };
  const move = (x: number, y: number) => {
    s.heard = [...s.heard, \`move \${x},\${y}\`];
  };
  const end = () => {
    s.heard = [...s.heard, "end"];
  };
  return <Flex width={100} height={20} onDragStart={start} onDrag={move} onDragEnd={end}><Text>{s.heard.join(" | ")}</Text></Flex>;
}`;

describe("drag handlers on a component's box", () => {
  it("take the component's own functions, each handed no more arguments than it declares", async () => {
    const compiled = compile(SHELF);
    assert.deepEqual(typeCheck(compiled), []);
    const { Shelf } = await load<{ Shelf: new () => Flex }>(compiled);
    const world = new World();
    const shelf = new Shelf();
    world.mount(shelf);
    world.flush();
    shelf.onDragStart?.(3, 4);
    shelf.onDrag?.(5, 6);
    shelf.onDragEnd?.(7, 8);
    world.flush();
    assert.equal((shelf.children[0] as Text).text, "start 3 | move 5,6 | end");
  });
});
