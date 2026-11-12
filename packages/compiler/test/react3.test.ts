/**
 * Writing components the way a React author does (found by the third game, Bramble): `undefined` in conditions and handlers, and a
 * list's items computed in the component (a member of a value, a mapped array, a helper's result) instead of kept ready in state.
 * Conditions and nested children inside list items are in tier3.test.ts.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInputState, Entity, Sprite, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

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
