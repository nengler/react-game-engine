/**
 * Hot reload: a tree built from one build of a component takes the state of a tree built from an older one. Compiles two
 * versions of the same components, runs the first, and checks what the second keeps (`saveHotState`, `loadHotState` and the
 * runtime's `captureHotState` / `restoreHotState`).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World, captureHotState, restoreHotState, type GameObject } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

interface Panel extends Entity {
  s: { open: boolean; label: number };
}

interface Counter extends Entity {
  ticks: number;
  s: { count: number };
}

const V1 = `
export function Panel() {
  const s = useMutable({ open: false });
  return (
    <Entity name="Panel">
      <Sprite image="frame.png" />
      {s.open && <Counter />}
    </Entity>
  );
}

export function Counter() {
  const s = useMutable({ count: 0 });
  const ticks = useRef(0);
  useUpdate(() => {
    ticks.current = ticks.current + 1;
  });
  return <Text>{s.count}</Text>;
}
`;

/** The same components after an edit: the panel draws more and its counter is now the second child, the counter's text changed, and the label became a number. */
const V2 = `
export function Panel() {
  const s = useMutable({ open: false, label: 5 });
  return (
    <Entity name="Panel">
      <Sprite image="frame.png" />
      <Shape kind="rect" width={4} height={4} color="red" />
      {s.open && <Counter />}
    </Entity>
  );
}

export function Counter() {
  const s = useMutable({ count: 0 });
  const ticks = useRef(0);
  useUpdate(() => {
    ticks.current = ticks.current + 2;
  });
  return <Text>Count: {s.count}</Text>;
}
`;

function find<T extends GameObject>(root: GameObject, name: string): T | null {
  if (root.constructor.name === name) return root as T;
  for (const child of root.children) {
    const found = find<T>(child, name);
    if (found !== null) return found;
  }
  return null;
}

describe("hot reload", () => {
  it("emits code that type-checks", () => {
    assert.deepEqual(typeCheck(compile(V2, "Hot.tsx")), []);
  });

  it("gives a rebuilt tree the state of the old one, including a child that exists only because of it", async () => {
    const v1 = await load<{ Panel: new () => Panel }>(compile(V1, "Hot.tsx"));
    const v2 = await load<{ Panel: new () => Panel }>(compile(V2, "Hot.tsx"));

    const before = new World();
    const old = new v1.Panel();
    before.mount(old);
    old.s.open = (true);
    before.flush();
    const oldCounter = find<Counter>(old, "Counter");
    assert.ok(oldCounter);
    oldCounter.s.count = (7);
    before.tick(1 / 60);
    before.tick(1 / 60);
    assert.equal(oldCounter.s.count, 7);
    assert.equal(oldCounter.ticks, 2);

    const saved = captureHotState(old);
    const after = new World();
    const fresh = new v2.Panel();
    after.mount(fresh);
    assert.equal(find(fresh, "Counter"), null, "the counter is not there until the panel's state comes back");
    const restored = restoreHotState(after, fresh, saved);

    assert.equal(restored, 2);
    assert.equal(fresh.s.open, true);
    const counter = find<Counter>(fresh, "Counter");
    assert.ok(counter, "the panel's restored state built its counter, which then took its own state");
    assert.notEqual(counter, oldCounter);
    assert.equal(counter.s.count, 7);
    assert.equal(counter.ticks, 2);
    // The new build's code runs on the old state.
    after.tick(1 / 60);
    assert.equal(counter.ticks, 4);
  });

  it("keeps the new initial value for state the old build did not have", async () => {
    const v1 = await load<{ Panel: new () => Panel }>(compile(V1, "Hot.tsx"));
    const v2 = await load<{ Panel: new () => Panel & { s: { label: number } } }>(compile(V2, "Hot.tsx"));
    const old = new v1.Panel();
    new World().mount(old);
    const fresh = new v2.Panel();
    const world = new World();
    world.mount(fresh);
    restoreHotState(world, fresh, captureHotState(old));
    assert.equal(fresh.s.label, 5);
  });

  it("skips a saved value whose type no longer matches", async () => {
    const v2 = await load<{ Panel: new () => Panel & { label: number } }>(compile(V2, "Hot.tsx"));
    const fresh = new v2.Panel();
    const world = new World();
    world.mount(fresh);
    restoreHotState(world, fresh, new Map([["Panel", { "Panel.s.open": "yes", "Panel.s.label": 9 }]]));
    assert.equal(fresh.s.open, false);
    assert.equal(fresh.s.label, 9);
  });
});
