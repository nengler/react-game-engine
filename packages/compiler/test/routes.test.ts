import assert from "node:assert/strict";
/** A <Route>'s components are made when it comes and dropped once it has gone, as React Router's are; keepAlive keeps them. */
import { after, describe, it } from "node:test";

import { createInputState, Entity, World, type GameObject } from "@rge/runtime";

import { cleanOutput, closeCompiler, compileProject, loadProject, typeCheckProject } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCES = {
  "Counter.tsx": `
interface Props { label: string }
export function Counter({ label }: Props) {
  const s = useMutable({ n: 0 });
  useInput((input) => {
    if (input.pressed("Z")) {
      s.n += 1;
    }
  });
  return <Text size={8}>{label} {s.n}</Text>;
}`,
  "Main.tsx": `
import { Counter } from "./Counter.tsx";
export function Main() {
  const st = useMutable({ screen: "a" });
  useInput((input) => {
    if (input.pressed("X")) {
      st.screen = (st.screen === "a" ? "b" : "a");
    }
  });
  return (
    <Router route={st.screen}>
      <Route name="a"><Counter label="a" /></Route>
      <Route name="b" keepAlive><Counter label="b" /></Route>
    </Router>
  );
}`,
};

describe("<Route> components", () => {
  it("are made fresh on each visit (their state starts over), and keepAlive keeps them", async () => {
    const project = compileProject(SOURCES);
    assert.deepEqual(typeCheckProject(project), []);
    const main = project["Main.tsx"]!;
    assert.match(
      main.code,
      /counter: Counter \| null = null;[^]*if \(this\.route2\.active\) \{/,
      "route a's child exists while the route is active"
    );
    assert.match(
      main.code,
      /readonly counter2: Counter = new Counter\(\{ label: "b" \}\);/,
      "route b is keepAlive: its child is made once"
    );
    assert.doesNotMatch(main.code, /this\.route3\.active/);
    const { Main } = await loadProject<{ Main: new () => Entity }>(project, "Main.tsx");
    const world = new World();
    const root = new Main();
    world.mount(root);
    world.flush();
    const counter = (): GameObject => {
      let found: GameObject | null = null;
      const walk = (o: GameObject): void => {
        if (o.constructor.name === "Counter") found = o;
        o.children.forEach(walk);
      };
      walk(root);
      return found!;
    };
    const shown = (): string[] => {
      const out: string[] = [];
      const walk = (o: GameObject): void => {
        if ("text" in o && typeof (o as { text: unknown }).text === "string") out.push((o as unknown as { text: string }).text);
        o.children.forEach(walk);
      };
      walk(root);
      return out;
    };
    const press = (key: string): void => {
      world.tick(1 / 60, createInputState({ pressed: [key], down: [key] }));
      world.tick(1 / 60);
    };
    press("Z");
    press("Z");
    assert.deepEqual(shown(), ["a 2"]);
    const firstA = counter();
    press("X"); // to b
    assert.equal(firstA.world, null, "a's Counter left the world with its route");
    press("Z");
    assert.deepEqual(shown(), ["b 1"]);
    const firstB = counter();
    press("X"); // back to a: made fresh
    assert.deepEqual(shown(), ["a 0"], "a new Counter: its count starts over");
    assert.notEqual(counter(), firstA);
    press("X"); // back to b: kept
    assert.deepEqual(shown(), ["b 1"], "keepAlive: the same Counter, its count kept");
    assert.equal(counter(), firstB);
  });
});
