import assert from "node:assert/strict";
/** `useWindowSize()`: the window's size, kept up to date (the shipped hook over `getWindowSize()`). */
import { after, describe, it } from "node:test";

import { Entity, Text, World, setWindowSize } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
  setWindowSize(0, 0);
});

const PROMPT = `export function Prompt() {
  const window = useWindowSize();
  return <Entity><Text>{window.height > window.width ? "Turn your phone" : \`\${window.width}x\${window.height}\`}</Text></Entity>;
}`;

describe("useWindowSize", () => {
  it("reads the size at mount, follows it, renders only when it changes, and stops listening when the component leaves", async () => {
    const compiled = compile(PROMPT);
    assert.deepEqual(typeCheck(compiled), []);
    const { Prompt } = await load<{ Prompt: new () => Entity }>(compiled);
    setWindowSize(800, 450);
    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const prompt = new Prompt();
    root.addChild(prompt);
    world.flush();
    const text = (): string => (prompt.children[0] as Text).text;
    assert.equal(text(), "800x450");

    let renders = 0;
    const render = prompt.render.bind(prompt);
    prompt.render = () => {
      renders++;
      render();
    };
    setWindowSize(800, 450);
    world.flush();
    assert.equal(renders, 0, "the same size: nothing to render");
    setWindowSize(390, 844);
    world.flush();
    assert.equal(text(), "Turn your phone");
    assert.equal(renders, 1, "width and height changing together render once");
    setWindowSize(844, 390);
    world.flush();
    assert.equal(text(), "844x390");

    root.removeChild(prompt);
    world.flush();
    setWindowSize(390, 844);
    world.flush();
    assert.equal(renders, 2, "it stopped listening when it left");

    // A component made after the window changed reads the size as it is now.
    const late = new Prompt();
    root.addChild(late);
    world.flush();
    assert.equal((late.children[0] as Text).text, "Turn your phone");
  });
});
