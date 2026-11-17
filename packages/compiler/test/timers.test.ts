import assert from "node:assert/strict";
/** Timers (DESIGN.md, "Timers"): `after`, `every`, `cancelTimer` and `cancelTimers` in handlers, the component's own. */
import { after as afterAll, describe, it } from "node:test";

import { Entity, Text, World, captureHotState, freeze, restoreHotState, type InputState } from "@tsengine/runtime";

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

  it("after and every return an id; cancelTimer stops that timer only, and restarting a flash keeps the other timers", async () => {
    const compiled = compile(`import { Text, after, cancelTimer, every, useInput, useMount, useMutable } from "@tsengine/runtime/jsx";

export function Hit() {
  const s = useMutable({ flash: false, flashTimer: 0, ticker: 0, ticks: 0 });
  useMount(() => {
    s.ticker = every(0.5, () => { s.ticks += 1; });
  });
  useInput((input) => {
    if (input.pressed("Space")) {
      cancelTimer(s.flashTimer);
      s.flash = true;
      s.flashTimer = after(0.15, () => { s.flash = false; });
    }
    if (input.pressed("Escape")) cancelTimer(s.ticker);
  });
  return <Text>{s.flash ? "on" : "off"} {s.ticks} {s.flashTimer}</Text>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Hit } = await load<{ Hit: new () => Text }>(compiled);
    const world = new World();
    const holder = new Entity({});
    world.mount(holder);
    const hit = new Hit();
    holder.addChild(hit);
    world.flush();
    const step = (n = 1, input?: InputState): void => {
      for (let i = 0; i < n; i++) world.tick(1 / 60, i === 0 ? input : undefined);
    };
    step(1, key("Space"));
    assert.equal(hit.text, "on 0 2", "the every was timer 1, the flash timer 2");
    step(6);
    step(1, key("Space"));
    assert.equal(hit.text, "on 0 3", "hit again: the old flash timer is cancelled and a new one set");
    step(7);
    assert.equal(hit.text, "on 0 3", "0.13 s after the second hit: still on (the first timer would have ended it by now)");
    step(3);
    assert.equal(hit.text, "off 0 3");
    step(15);
    assert.equal(hit.text, "off 1 3", "the every kept running through both restarts");
    step(1, key("Escape"));
    step(60);
    assert.equal(hit.text, "off 1 3", "cancelTimer(ticker): that one stops");
    assert.equal(hit.pendingTimers, 0);
  });

  it("cancelTimer of a timer due later in the same step skips it, and ignores 0 and finished ids", () => {
    const owner = new Entity({});
    const world = new World();
    world.mount(owner);
    const calls: string[] = [];
    let second = 0;
    owner.after(0.01, () => {
      calls.push("first");
      owner.cancelTimer(second);
    });
    second = owner.after(0.01, () => calls.push("second"));
    owner.cancelTimer(0);
    owner.cancelTimer(99);
    world.tick(1 / 60);
    assert.deepEqual(calls, ["first"], "both were due this step; the first cancelled the second before it ran");
    assert.equal(owner.pendingTimers, 0);
  });

  it("a component that takes another's state over (hot reload, a tree save) numbers its timers on from there", () => {
    class Flasher extends Entity {
      timer = 0;
      override saveHotState(): Record<string, unknown> {
        return { timer: this.timer };
      }
      override loadHotState(saved: Record<string, unknown>): void {
        if (typeof saved["timer"] === "number") this.timer = saved["timer"];
      }
    }
    const world = new World();
    const before = new Flasher({});
    world.mount(before);
    before.after(1, () => {});
    before.timer = before.after(1, () => {});
    assert.equal(before.timer, 2);
    const saved = captureHotState(before);
    const after = new Flasher({});
    const next = new World();
    next.mount(after);
    restoreHotState(next, after, saved);
    assert.equal(after.timer, 2, "its state names timer 2 of the build it replaced");
    assert.equal(
      after.after(1, () => {}),
      3,
      "so its own timers start at 3, and cancelTimer(2) cannot stop one of them"
    );
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
