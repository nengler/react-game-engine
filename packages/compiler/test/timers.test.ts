import assert from "node:assert/strict";
/** Timers (DESIGN.md, "Timers"): `after`, `every` and `cancelTimers` in handlers, the component's own. */
import { after as afterAll, describe, it } from "node:test";

import { Entity, Text, World, freeze, type InputState } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

afterAll(() => {
  closeCompiler();
  cleanOutput();
});

const FLASH = `import { Text, after, cancelTimers, every, useInput, useMount, useMutable } from "@tsengine/runtime/jsx";

export function Flash() {
  const s = useMutable({ flash: false, ticks: 0 });
  useMount(() => {
    every(0.5, () => { s.ticks += 1; });
  });
  useInput((input) => {
    if (input.pressed("Space")) {
      s.flash = true;
      after(0.15, () => { s.flash = false; });
    }
    if (input.pressed("Escape")) cancelTimers();
  });
  return <Text>{s.flash ? "on" : "off"} {s.ticks}</Text>;
}`;

const key = (name: string): InputState =>
  ({ pressed: (k: string) => k === name, down: () => false, released: () => false }) as unknown as InputState;

async function mount() {
  const compiled = compile(FLASH);
  assert.deepEqual(typeCheck(compiled), []);
  const { Flash } = await load<{ Flash: new () => Text }>(compiled);
  const world = new World();
  const holder = new Entity({});
  world.mount(holder);
  const flash = new Flash();
  holder.addChild(flash);
  world.flush();
  const step = (n = 1, input?: InputState): void => {
    for (let i = 0; i < n; i++) world.tick(1 / 60, i === 0 ? input : undefined);
  };
  return { flash, holder, step, world };
}

describe("after, every and cancelTimers", () => {
  it("after runs once, its seconds of game time later; every runs every period", async () => {
    const { flash, step } = await mount();
    step(1, key("Space"));
    assert.equal(flash.text, "on 0");
    step(7);
    assert.equal(flash.text, "on 0", "0.13 s in: not yet");
    step(2);
    assert.equal(flash.text, "off 0", "0.15 s: done, once");
    step(20);
    assert.equal(flash.text, "off 1", "every 0.5 s");
    step(30);
    assert.equal(flash.text, "off 2");
  });

  it("stand still while the world is frozen", async () => {
    const { flash, step } = await mount();
    step(1, key("Space"));
    freeze(30);
    step(1);
    step(30);
    assert.equal(flash.text, "on 0", "frozen: no time passes for a timer");
    step(10);
    assert.equal(flash.text, "off 0");
  });

  it("are cancelled when the component unmounts, so they never call back into it", async () => {
    const { flash, holder, step, world } = await mount();
    step(1, key("Space"));
    holder.removeChild(flash);
    world.flush();
    assert.equal(flash.pendingTimers, 0);
    step(60);
    assert.equal(flash.text, "on 0", "nothing ran after it left");
  });

  it("cancelTimers cancels all of this component's timers", async () => {
    const { flash, step } = await mount();
    step(1, key("Space"));
    step(1, key("Escape"));
    step(60);
    assert.equal(flash.text, "on 0");
    assert.equal(flash.pendingTimers, 0);
  });

  it("are refused while rendering, and must be imported", () => {
    const rendering = compileErrors(`import { Text, after, useMutable } from "@tsengine/runtime/jsx";
export function A() {
  const s = useMutable({ n: 0 });
  const x = after(1, () => { s.n = 1; });
  return <Text>{s.n}</Text>;
}`);
    assert.ok(
      rendering.some((d) => d.code === DiagnosticCode.UnsupportedExpression && /only valid as a statement in a handler/.test(d.message)),
      JSON.stringify(rendering)
    );
    const missing = compileErrors(`import { Text, useMount, useMutable } from "@tsengine/runtime/jsx";
export function A() {
  const s = useMutable({ n: 0 });
  useMount(() => { after(1, () => { s.n = 1; }); });
  return <Text>{s.n}</Text>;
}`);
    assert.ok(
      missing.some((d) => /'after' is not imported/.test(d.message)),
      JSON.stringify(missing)
    );
  });
});

describe("useTime", () => {
  it("useTime gives the seconds since mount, growing each update", async () => {
    const compiled = compile(`
export function Blink() {
  const time = useTime();
  return <Text size={8} color={time % 1 < 0.5 ? "white" : "black"}>{\`\${Math.floor(time)}\`}</Text>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Blink } = await load<{ Blink: new () => Text }>(compiled);
    const world = new World();
    const blink = new Blink();
    world.mount(blink);
    world.flush();
    assert.equal(blink.color, "white");
    for (let i = 0; i < 4; i++) world.tick(0.2);
    world.flush();
    assert.equal(blink.color, "black");
    for (let i = 0; i < 2; i++) world.tick(0.2);
    world.flush();
    assert.equal(blink.text, "1");
  });
});
