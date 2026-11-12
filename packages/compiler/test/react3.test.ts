/**
 * Writing components the way a React author does (found by the third game, Bramble): `undefined` in conditions and handlers, and a
 * list's items computed in the component (a member of a value, a mapped array, a helper's result) instead of kept ready in state.
 * Conditions and nested children inside list items are in tier3.test.ts.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInputState, Entity, Sprite, Text, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("undefined", () => {
  const SOURCE = `
interface GateProps { frame?: number; }
export function Gate({ frame }: GateProps) {
  const [last, setLast] = useState<string | undefined>(undefined);
  useInput((input) => {
    const key = input.lastPressed();
    if (key !== undefined) setLast(key);
  });
  return (
    <Entity name={last === undefined ? "none" : last}>
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

describe("a list's items computed in the component", () => {
  const SOURCE = `
interface Enemy { id: string; map: string; kind: "beetle" | "wisp"; x: number; }
interface Run { map: string; enemies: Enemy[]; }
const FRAME = { beetle: 4, wisp: 5 } as const;
function onMap(run: Run): Enemy[] {
  return run.enemies.filter((e) => e.map === run.map);
}

export function Foes() {
  const [run, setRun] = useState<Run>({ map: "a", enemies: [{ id: "b1", map: "a", kind: "beetle", x: 1 }, { id: "w1", map: "b", kind: "wisp", x: 2 }] });
  return (
    <Entity name="Foes">
      <Entity name="byHelper">
        {onMap(run).map((e) => <Sprite key={e.id} image="things.png" frame={FRAME[e.kind]} transform={{ x: e.x }} />)}
      </Entity>
      <Entity name="byMember">
        {run.enemies.map((e) => ({ id: e.id, frame: FRAME[e.kind] })).map((s) => <Sprite key={s.id} image="things.png" frame={s.frame} />)}
      </Entity>
    </Entity>
  );
}`;

  it("type-checks, and follows the state the computation reads", async () => {
    const compiled = compile(SOURCE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Foes } = await load<{ Foes: new () => Entity & { setRun(r: unknown): void } }>(compiled);
    const world = new World();
    const foes = new Foes();
    world.mount(foes);
    world.flush();
    const frames = (name: string) => (foes.children.find((c) => (c as Entity).name === name)!.children as Sprite[]).map((s) => s.frame);
    assert.deepEqual(frames("byHelper"), [4]);
    assert.deepEqual(frames("byMember"), [4, 5]);
    const beetle = foes.children[0]!.children[0];
    foes.setRun({ map: "a", enemies: [{ id: "b1", map: "a", kind: "beetle", x: 9 }, { id: "w1", map: "a", kind: "wisp", x: 2 }] });
    world.flush();
    assert.deepEqual(frames("byHelper"), [4, 5]);
    assert.equal(foes.children[0]!.children[0], beetle, "an item keeps its instance by key");
    assert.equal((beetle as Sprite).transform.x, 9);
  });
});

describe("methods of strings and numbers, and more array methods", () => {
  const SOURCE = `
interface ClockProps { seconds: number; label: string; ids: string[]; }
export function Clock({ seconds, label, ids }: ClockProps) {
  const [picked, setPicked] = useState("");
  useInput((input) => {
    const id = ids.at(0) ?? "";
    if (input.pressed("Enter") && id.startsWith("bind:")) setPicked(id.slice(5).toUpperCase());
  });
  return (
    <Entity name={picked}>
      <Text text={\`\${Math.floor(seconds / 60)}:\${String(seconds % 60).padStart(2, "0")} \${label.trim().toUpperCase()} \${(seconds / 7).toFixed(1)}\`} />
      <Text text={ids.flatMap((id) => [id, id.length]).join(" / ")} />
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
    assert.deepEqual(clock.children.map((c) => (c as Text).text), ["1:05 BELLS 9.3", "bind:up / 7 / a / 1"]);
    world.tick(1 / 60, createInputState({ pressed: ["Enter"] }));
    world.flush();
    assert.equal(clock.name, "UP");
  });

  it("still refuses what changes an array in place, pointing at the copy, and an unknown method", () => {
    const sort = compileErrors(`interface P { ids: string[] } export function A({ ids }: P) { return <Entity name={ids.sort().join("")} />; }`);
    assert.match(sort[0]!.message, /changes the array in place/);
    assert.equal(compileErrors(`interface P { id: string } export function A({ id }: P) { return <Entity name={id.frobnicate()} />; }`)[0]!.code, DiagnosticCode.UnsupportedExpression);
  });
});

describe("derived values: destructured, and worked out once", () => {
  const SOURCE = `
export const CALLS = { hero: 0 };
interface Hero { x: number; y: number; frame: number; }
function heroOf(step: number): Hero {
  CALLS.hero++;
  return { x: step * 2, y: step * 3, frame: step % 4 };
}

export function Walker() {
  const [step, setStep] = useState(1);
  const [blink, setBlink] = useState(false);
  const { x, y, frame: f } = heroOf(step);
  const [first, , third] = [x, y, f];
  return (
    <Entity name={blink ? "on" : "off"}>
      <Sprite image="hero.png" frame={f} transform={{ x, y }} />
      <Text text={\`\${first} \${third}\`} />
    </Entity>
  );
}`;

  it("reads members of one value, worked out again only when what it reads changes", async () => {
    const compiled = compile(SOURCE);
    assert.match(compiled.code, /this\.\$memo\("x,y,f", \[this\.step\], \(\) => heroOf\(this\.step\)\)/);
    assert.deepEqual(typeCheck(compiled), []);
    const { Walker, CALLS } = await load<{ Walker: new () => Entity & { setStep(n: number): void; setBlink(b: boolean): void }; CALLS: { hero: number } }>(compiled);
    const world = new World();
    const walker = new Walker();
    world.mount(walker);
    world.flush();
    const sprite = walker.children[0] as Sprite;
    assert.deepEqual([sprite.transform.x, sprite.transform.y, sprite.frame, (walker.children[1] as Text).text], [2, 3, 1, "2 1"]);
    assert.equal(CALLS.hero, 1, "three uses, one call");
    walker.setBlink(true);
    world.flush();
    assert.equal(walker.name, "on");
    assert.equal(CALLS.hero, 1, "a render that changes nothing it reads does not call it again");
    walker.setStep(2);
    world.flush();
    assert.deepEqual([sprite.transform.x, sprite.frame], [4, 2]);
    assert.equal(CALLS.hero, 2);
  });

  it("refuses a default, a rest or a nested pattern", () => {
    for (const pattern of ["{ x = 1 }", "{ ...rest }", "{ a: { b } }", "[a, ...rest]"]) {
      const errors = compileErrors(`interface P { v: { x: number; a: { b: number } }; l: number[] } export function A({ v, l }: P) { const ${pattern} = ${pattern.startsWith("[") ? "l" : "v"}; return <Entity />; }`);
      assert.equal(errors[0]?.code, DiagnosticCode.InvalidComponentBody, pattern);
    }
  });
});
