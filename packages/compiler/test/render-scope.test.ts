import assert from "node:assert/strict";
/**
 * Dependency-scoped `render()` (DESIGN.md, "Dependency-scoped `render()`"): a render works out each memo it always reads once, and runs each part
 * (one element's values, one child's props) only when a state field or prop that part reads is a different value than at the last
 * render. What is under a condition or in a list, and what reads something the compiler cannot follow, always runs.
 */
import { after, describe, it } from "node:test";

import { Entity, Shape, Text, World } from "@rge/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const counts = globalThis as unknown as { shadeCalls: number; labelCalls: number };

const BADGE = `import { Entity, Shape, Text, useInput, useMutable } from "@rge/runtime/jsx";

function shade(hp: number): string {
  (globalThis as unknown as { shadeCalls: number }).shadeCalls++;
  return hp > 5 ? "green" : "red";
}
function label(name: string): string {
  (globalThis as unknown as { labelCalls: number }).labelCalls++;
  return name.toUpperCase();
}

interface BadgeProps {
  name: string;
}

export function Badge({ name }: BadgeProps) {
  const s = useMutable({ x: 0, hp: 10, open: false });
  const upper = label(name);
  useInput((input) => {
    if (input.pressed("Right")) s.x += 1;
    if (input.pressed("Down")) s.hp -= 6;
    if (input.pressed("Space")) s.open = !s.open;
  });
  return (
    <Entity x={s.x}>
      <Shape kind="rect" width={4} height={4} color={shade(s.hp)} />
      <Text>{upper}</Text>
      {s.open && <Shape kind="rect" width={2} height={2} color={shade(s.hp)} x={s.x * 2} />}
    </Entity>
  );
}`;

function press(key: string): Parameters<World["tick"]>[1] {
  return { pressed: (k: string) => k === key, down: () => false, released: () => false } as never;
}

describe("dependency-scoped render", () => {
  it("runs a part only when what it reads changed, and everything on the first render", async () => {
    counts.shadeCalls = 0;
    counts.labelCalls = 0;
    const compiled = compile(BADGE);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /readonly \$in: unknown\[\] = new Array\(\d\)\.fill\(\{\}\);/);
    const { Badge } = await load<{ Badge: new (props: { name: string }) => Entity & { updateProps(p: object): void } }>(compiled);
    const world = new World();
    const badge = new Badge({ name: "ada" });
    world.mount(badge);
    world.flush();
    const [shape, text] = badge.children as [Shape, Text];
    assert.equal(shape.color, "green");
    assert.equal(text.text, "ADA");
    const shades = counts.shadeCalls;
    const labels = counts.labelCalls;

    // Move: only the root's x is written; the shape's colour and the label are not worked out again.
    world.tick(1 / 60, press("Right"));
    world.flush();
    assert.equal(badge.transform.x, 1);
    assert.equal(counts.shadeCalls, shades, "shade(hp) did not run: hp did not change");
    assert.equal(counts.labelCalls, labels, "the label did not run: name did not change");

    // Hurt: the colour follows.
    world.tick(1 / 60, press("Down"));
    world.flush();
    assert.equal(shape.color, "red");
    assert.equal(counts.shadeCalls, shades + 1);

    // A new prop: the label follows.
    badge.updateProps({ name: "bo" });
    world.flush();
    assert.equal(text.text, "BO");
  });

  it("writes every value of an element made under a condition, whatever changed", async () => {
    const { Badge } = await load<{ Badge: new (props: { name: string }) => Entity }>(compile(BADGE));
    const world = new World();
    const badge = new Badge({ name: "ada" });
    world.mount(badge);
    world.flush();
    world.tick(1 / 60, press("Right"));
    world.flush();
    world.tick(1 / 60, press("Space"));
    world.flush();
    const dot = badge.children[2] as Shape;
    assert.ok(dot instanceof Shape);
    assert.equal(dot.transform.x, 2, "its x, though x did not change in the render that made it");
    assert.equal(dot.color, "green");
  });

  it("leaves a render unguarded when every part reads the same things, as it was", () => {
    const compiled = compile(`import { Entity, Sprite, useMutable } from "@rge/runtime/jsx";
export function P() {
  const s = useMutable({ health: 100 });
  return <Entity><Sprite image={s.health > 50 ? "normal.png" : "hurt.png"} /></Entity>;
}`);
    assert.doesNotMatch(compiled.code, /\$in|\$d/);
  });

  it("never guards a part that reads what the compiler cannot follow: a route's own field", () => {
    const compiled = compile(`import { Entity, Route, Router, Text, useMutable } from "@rge/runtime/jsx";
export function Screens() {
  const s = useMutable({ screen: "a", n: 0 });
  return (
    <Entity>
      <Text x={s.n}>{s.screen}</Text>
      <Router route={s.screen}>
        <Route name="a"><Text>A</Text></Route>
      </Router>
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    // The route's own children are made and dropped by its \`active\` field, read fresh on every render, never behind a guard.
    assert.match(compiled.code, /\n {4}if \(this\.route\.active\) \{/);
  });
});
