/**
 * Expressions written the way a React author does (found by the games Hearth and Bramble): reads by index, `Math`'s constants,
 * `undefined` in conditions and handlers, and the methods of strings, numbers and arrays.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createInputState, Entity, Sprite, Text, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("reads by index and Math's constants", () => {
  it("lowers `table[key]` and `Math.PI` in render, derived values and handlers", async () => {
    const compiled = compile(`
const FRAMES: Record<string, number> = { bolt: 0, frost: 2 };
interface IconProps { kind: string; angles: number[]; at: number; }
export function Icon({ kind, angles, at }: IconProps) {
  const s = useMutable({ turns: 0 });
  const angle = angles[at] ?? 0;
  useUpdate(() => { s.turns += angles[at]! / (Math.PI * 2); });
  return <Sprite image="icons.png" frame={FRAMES[kind]!} transform={{ rotation: angle + Math.PI }} />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /FRAMES\[this\.props\.kind\]/);
    assert.match(compiled.code, /Math\.PI/);
    const { Icon } = await load<{ Icon: new (p: { kind: string; angles: number[]; at: number }) => Sprite }>(compiled);
    const world = new World();
    const icon = new Icon({ kind: "frost", angles: [0, 1], at: 1 });
    world.mount(icon);
    world.flush();
    assert.equal(icon.frame, 2);
    assert.equal(icon.transform.rotation, 1 + Math.PI);
  });
});

describe("undefined", () => {
  const SOURCE = `
interface GateProps { frame?: number; }
export function Gate({ frame }: GateProps) {
  const s = useMutable({ last: undefined as string | undefined });
  useInput((input) => {
    const key = input.lastPressed();
    if (key !== undefined) s.last = key;
  });
  return (
    <Entity name={s.last === undefined ? "none" : s.last}>
      {frame !== undefined && <Sprite image="gate.png" frame={frame} />}
      {frame === undefined ? null : <Entity name="shown" />}
    </Entity>
  );
}`;

  it("is a value in render and in handlers", async () => {
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Gate } = await load<{ Gate: new (p: { frame?: number }) => Entity & { updateProps(p: { frame?: number }): void } }>(compiled);
    const world = new World();
    const gate = new Gate({});
    world.mount(gate);
    world.flush();
    assert.equal(gate.name, "none");
    assert.equal(gate.children.length, 0);
    gate.updateProps({ frame: 2 });
    world.flush();
    assert.equal((gate.children[0] as Sprite).frame, 2);
    assert.equal((gate.children[1] as Entity).name, "shown");
    world.tick(1 / 60, createInputState({ pressed: ["Z"] }));
    world.flush();
    assert.equal(gate.name, "Z");
  });
});

describe("methods of strings and numbers, and more array methods", () => {
  const SOURCE = `
interface ClockProps { seconds: number; label: string; ids: string[]; }
export function Clock({ seconds, label, ids }: ClockProps) {
  const s = useMutable({ picked: "" });
  useInput((input) => {
    const id = ids.at(0) ?? "";
    if (input.pressed("Enter") && id.startsWith("bind:")) s.picked = id.slice(5).toUpperCase();
  });
  return (
    <Entity name={s.picked}>
      <Text>{\`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")} \${label.trim().toUpperCase()} \${(seconds / 7).toFixed(1)}\`}</Text>
      <Text>{ids.flatMap((id) => [id, id.length]).join(" / ")}</Text>
    </Entity>
  );
}`;

  it("are called as written, in render and in handlers", async () => {
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Clock } = await load<{ Clock: new (p: { seconds: number; label: string; ids: string[] }) => Entity }>(compiled);
    const world = new World();
    const clock = new Clock({ seconds: 65, label: " bells ", ids: ["bind:up", "a"] });
    world.mount(clock);
    world.flush();
    assert.deepEqual(
      clock.children.map((c) => (c as Text).text),
      ["1:05 BELLS 9.3", "bind:up / 7 / a / 1"]
    );
    world.tick(1 / 60, createInputState({ pressed: ["Enter"] }));
    world.flush();
    assert.equal(clock.name, "UP");
  });

  it("still refuses what changes an array in place, pointing at the copy, and an unknown method", () => {
    const sort = compileErrors(
      `interface P { ids: string[] } export function A({ ids }: P) { return <Entity name={ids.sort().join("")} />; }`
    );
    assert.match(sort[0]!.message, /changes the array in place/);
    assert.equal(
      compileErrors(`interface P { id: string } export function A({ id }: P) { return <Entity name={id.frobnicate()} />; }`)[0]!.code,
      DiagnosticCode.UnsupportedExpression
    );
  });
});
