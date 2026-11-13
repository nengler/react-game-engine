/**
 * Kite's ground movement two ways (REACT_FEEL_PLAN.md, A2): the rules the game plays (`stepBody`, a plain function over the
 * room's `solidAt`) and the same rules written as a component with `useBody` (`src/Runner.tsx`), which asks the world instead.
 * The same input through both must put the character on the same pixel every step: the feel is the same. What each step costs is
 * printed, not asserted.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseInputScript } from "@rge/player";
import { createInputState } from "@rge/runtime";
import { render } from "@rge/testing";
import { Runner } from "../generated/Runner.ts";
import { newBody, stepBody, type Body } from "../src/rules/body.ts";
import { controls, readControls } from "../src/rules/controls.ts";
import { ROOM_LIST } from "../src/rules/rooms.ts";

const DT = 1 / 60;
const bindings = controls.toJSON();

/** Where the rules put the character after each step of `script` in room `room`. */
function byRules(room: number, script: string): { x: number; y: number }[] {
  const r = ROOM_LIST[room]!;
  let body: Body = newBody(r.spawnX, r.spawnY);
  return parseInputScript(script, { dt: DT, bindings }).map((frame) => {
    body = stepBody(body, readControls(createInputState({ pressed: frame.pressed, down: frame.down, released: frame.released }, controls)), r.solidAt, DT);
    return { x: body.x, y: body.y };
  });
}

/** Where the component puts it after each step of the same script. */
function byComponent(room: number, script: string): { x: number; y: number }[] {
  const t = render(Runner, { room }, { controls, dt: DT });
  const out: { x: number; y: number }[] = [];
  for (const frame of parseInputScript(script, { dt: DT, bindings })) {
    t.world.tick(DT, createInputState({ pressed: frame.pressed, down: frame.down, released: frame.released }, controls));
    t.world.flush();
    const state = t.state() as { x: number; y: number };
    out.push({ x: state.x, y: state.y });
  }
  return out;
}

/** The first step where the two differ, or null. */
function firstDifference(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]?.x !== b[i]?.x || a[i]?.y !== b[i]?.y) return `step ${i}: the rules at ${JSON.stringify(a[i])}, the component at ${JSON.stringify(b[i])}`;
  }
  return null;
}

const SCRIPTS: readonly (readonly [string, number, string])[] = [
  ["standing, then running right and stopping", 0, "_*10, right*50, _*30"],
  ["running left into the room's wall, and the speed kept a moment", 0, "left*80, right*5, _*20"],
  ["a jump held to its top, and the landing", 0, "_*5, jump*30, _*40"],
  ["a short hop, and a jump pressed just before landing (the buffer)", 0, "jump*3, _*20, jump, _*40"],
  ["running jumps along the first room", 0, "right*20, right+jump*25, right*15, right+jump*25, right*40, _*20"],
  ["the second room: a run and two jumps", 1, "right*30, right+jump*20, right*10, left+jump*25, _*40"],
];

describe("Kite's movement with useBody", () => {
  for (const [what, room, script] of SCRIPTS) {
    it(`lands on the same pixel every step as the rules: ${what}`, () => {
      const rules = byRules(room, script);
      const component = byComponent(room, script);
      assert.equal(firstDifference(rules, component), null);
      assert.ok(new Set(rules.map((p) => `${p.x},${p.y}`)).size > 5, "it moved");
    });
  }

  it("costs, per step", () => {
    const script = SCRIPTS[4]![2];
    const time = (run: () => unknown): number => {
      run();
      const start = performance.now();
      for (let i = 0; i < 20; i++) run();
      return (performance.now() - start) / 20;
    };
    const steps = parseInputScript(script, { dt: DT, bindings }).length;
    const rules = time(() => byRules(0, script)) / steps;
    const component = time(() => byComponent(0, script)) / steps;
    console.log(`a step: the rules ${(rules * 1000).toFixed(1)} µs, the component (with its world's tick and render) ${(component * 1000).toFixed(1)} µs`);
  });
});
