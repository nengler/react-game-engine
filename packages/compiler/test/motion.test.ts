import assert from "node:assert/strict";
/** Motion (DESIGN.md, "Motion: springs, tweens and opacity"): `useSpring` and `useTween`, shipped hooks that step in the component's update. */
import { after, describe, it } from "node:test";

import { Entity, EASINGS, World, freeze, springFrom, startSpring, stepSpring, type InputState } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const PANEL = `
export function Panel() {
  const s = useMutable({ open: false });
  const y = useSpring(s.open ? 0 : -40, { duration: 0.4, bounce: 0.2 });
  const opacity = useTween(s.open ? 1 : 0, { duration: 0.25, ease: "linear" });
  const x = useSpring(s.open ? 10 : 0);
  useInput((input) => {
    if (input.pressed("Space")) s.open = !s.open;
  });
  return <Entity x={x} y={y} opacity={opacity} />;
}`;

const SPACE = { pressed: (k: string) => k === "Space", down: () => false, released: () => false } as unknown as InputState;

async function mount() {
  const compiled = compile(PANEL);
  assert.deepEqual(typeCheck(compiled), []);
  const { Panel } = await load<{ Panel: new () => Entity }>(compiled);
  const world = new World();
  const panel = new Panel();
  world.mount(panel);
  world.flush();
  const step = (n = 1, input?: InputState): void => {
    for (let i = 0; i < n; i++) world.tick(1 / 60, i === 0 ? input : undefined);
  };
  return { panel, step, world };
}

describe("useSpring and useTween", () => {
  it("start at their first target, without moving", async () => {
    const { panel, step } = await mount();
    step(5);
    assert.deepEqual([panel.transform.y, panel.transform.opacity, panel.transform.x], [-40, 0, 0]);
  });

  it("move to a new target and settle on it, a spring with a little overshoot, a tween along its easing", async () => {
    const { panel, step } = await mount();
    step(1, SPACE);
    const ys: number[] = [];
    const as: number[] = [];
    for (let i = 0; i < 90; i++) {
      step();
      ys.push(panel.transform.y);
      as.push(panel.transform.opacity);
    }
    assert.ok(Math.max(...ys) > 0, `bounce 0.2 overshoots: highest ${Math.max(...ys)}`);
    assert.equal(ys.at(-1), 0, "and settles exactly on the target");
    // The press and the tween's step are in the same frame: the tween reads the new target at once, so it moves in that step too.
    assert.ok(Math.abs((as[6] as number) - 8 / 15) < 0.02, `linear: ${as[6]} after 8 of 15 steps`);
    assert.equal(as.at(-1), 1);
    assert.equal(panel.transform.x, 10, "a spring with the defaults settles too");
  });

  it("renders only while moving", async () => {
    const { panel, step, world } = await mount();
    step(1, SPACE);
    step(120);
    let renders = 0;
    for (let i = 0; i < 10; i++) renders += world.tick(1 / 60);
    assert.equal(renders, 0, "settled: nothing changes, nothing renders");
    void panel;
  });

  it("stand still while the world is frozen", async () => {
    const { panel, step } = await mount();
    step(1, SPACE);
    step(5);
    freeze(10); // asked for outside a step: it starts after the next one
    step(1);
    const before = panel.transform.y;
    step(10);
    assert.equal(panel.transform.y, before);
    step(1);
    assert.notEqual(panel.transform.y, before, "and moves on after it");
  });
});

describe("the spring's math", () => {
  it("keeps its speed when the target changes, so it turns round smoothly", () => {
    let s = startSpring(0);
    for (let i = 0; i < 10; i++) s = stepSpring(s, 100, {}, 1 / 60);
    const point = stepSpring(startSpring({ x: 0, y: 0 }), { x: 5, y: -5 }, {}, 1 / 60);
    assert.ok(point.value.x > 0 && point.value.y < 0, "in plain code, a point springs on both axes");
    const speed = s.velocity;
    const turned = stepSpring(s, -100, {}, 1e-6);
    assert.ok(Math.abs(turned.velocity - speed) < 1, "the speed carries over");
    assert.ok(speed > 0);
  });

  it("is critically damped at bounce 0 (no overshoot) and settles in about its duration", () => {
    let s = startSpring(0);
    let highest = 0;
    let settled = -1;
    for (let i = 0; i < 120; i++) {
      s = stepSpring(s, 1, { duration: 0.5 }, 1 / 60);
      highest = Math.max(highest, s.value);
      if (settled < 0 && s.value === 1 && s.velocity === 0) settled = i;
    }
    assert.ok(highest <= 1, `no overshoot: ${highest}`);
    assert.ok(settled > 0 && settled <= 75, `settled after ${settled} steps`);
    const { stiffness, damping } = springFrom(0.5, 0);
    assert.ok(Math.abs(damping - 2 * Math.sqrt(stiffness)) < 1e-9);
  });

  it("has easings by name that start at 0 and end at 1", () => {
    for (const [name, ease] of Object.entries(EASINGS)) {
      assert.ok(Math.abs(ease(0)) < 1e-9 && Math.abs(ease(1) - 1) < 1e-9, name);
    }
  });
});

describe("a file that imports a type beside a shipped hook", () => {
  it("keeps the type import as written when the hook is taken out of it", () => {
    const compiled = compile(`import { type Child, Entity, useMount, useMutable, useTween } from "@tsengine/runtime/jsx";
interface FadeProps { children: Child }
export function FadeIn({ children }: FadeProps) {
  const s = useMutable({ shown: false });
  useMount(() => {
    s.shown = true;
  });
  const opacity = useTween(s.shown ? 1 : 0);
  return <Entity opacity={opacity}>{children}</Entity>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
  });
});
