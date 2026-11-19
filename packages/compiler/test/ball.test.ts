import assert from "node:assert/strict";
/**
 * `useBall` (DESIGN.md, "Balls: `useBall`"): components that each keep a ball pile up in a jar of solid colliders, the world stepping
 * them together before the updates; a ball sees the balls it touches, with their data; a ball leaves the world with its component.
 */
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { Entity, World, captureHotState, restoreHotState } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, getCompiler, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const JAR = `
interface FruitProps { id: number; kind: string; x: number; onTouch: (id: number, other: number) => void }
export function Fruit({ id, kind, x, onTouch }: FruitProps) {
  const { x: at, y, contacts } = useBall({ x: x, y: 0, radius: 5, gravity: 600, tag: "fruit", data: { id: id, kind: kind } });
  useUpdate(() => {
    for (const c of contacts("fruit")) if (c.data.kind === kind) onTouch(id, c.data.id);
  });
  return <Entity x={at} y={y} />;
}
interface JarProps { fruits: readonly { id: number; kind: string; x: number }[]; onTouch: (id: number, other: number) => void }
export function Jar({ fruits, onTouch }: JarProps) {
  return (
    <Entity x={100} y={20}>
      <Collider width={60} height={10} y={60} solid />
      <Collider width={10} height={140} x={-10} y={-80} solid />
      <Collider width={10} height={140} x={60} y={-80} solid />
      {fruits.map((f) => (
        <Fruit key={f.id} id={f.id} kind={f.kind} x={f.x} onTouch={onTouch} />
      ))}
    </Entity>
  );
}`;

// What the game declares once: the data each tag carries, which types `contacts("fruit")`'s data.
const FRUIT_DATA = `declare global {
  interface ColliderData { fruit: { id: number; kind: string } }
}
export {};
`;

type Fruit = { id: number; kind: string; x: number };
type Props = { fruits: readonly Fruit[]; onTouch: (id: number, other: number) => void };

async function jar(fruits: readonly Fruit[], touches: [number, number][] = []) {
  const compiled = compile(JAR);
  const data = join(dirname(compiled.fileName), "colliders.ts");
  assert.deepEqual(
    getCompiler().typeCheck([
      { fileName: compiled.fileName, text: compiled.code },
      { fileName: data, text: FRUIT_DATA },
    ]),
    []
  );
  const { Jar } = await load<{ Jar: new (p: Props) => Entity }>(compiled);
  const world = new World();
  const root = new Jar({ fruits, onTouch: (a, b) => touches.push([a, b]) });
  world.mount(root);
  world.flush();
  return { world, root, compiled };
}

function step(world: World, steps: number): void {
  for (let i = 0; i < steps; i++) {
    world.tick(1 / 60);
    world.flush();
  }
}

/** Where each fruit's entity is, in the jar's space. */
function places(root: Entity): { x: number; y: number }[] {
  return root.children.slice(3).map((fruit) => ({ x: (fruit as Entity).transform.x, y: (fruit as Entity).transform.y }));
}

const ICE = `
interface IceProps { x: number; frozen: boolean; light: boolean }
export function Ice({ x, frozen, light }: IceProps) {
  const { x: at, y, pin, setGravity } = useBall({ x: x, y: 0, radius: 5, gravity: 600 });
  useUpdate(() => {
    pin(frozen);
    setGravity(light ? -600 : 600);
  });
  return <Entity x={at} y={y} />;
}`;

describe("useBall", () => {
  it("pin holds a ball where it is and lets it go again; setGravity changes how it falls", async () => {
    const compiled = compile(ICE);
    assert.deepEqual(getCompiler().typeCheck([{ fileName: compiled.fileName, text: compiled.code }]), []);
    const { Ice } = await load<{
      Ice: new (p: {
        x: number;
        frozen: boolean;
        light: boolean;
      }) => Entity & { updateProps(next: { frozen?: boolean; light?: boolean }): void };
    }>(compiled);
    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const ice = new Ice({ x: 10, frozen: false, light: false });
    root.addChild(ice);
    world.flush();
    step(world, 10);
    const fell = ice.transform.y;
    assert.ok(fell > 0, "falling");

    ice.updateProps({ frozen: true });
    step(world, 30);
    assert.ok(Math.abs(ice.transform.y - fell) < 3, `held where it was when it froze (${fell} to ${ice.transform.y})`);
    const held = ice.transform.y;
    step(world, 30);
    assert.equal(ice.transform.y, held, "and not moving");

    ice.updateProps({ frozen: false, light: true });
    step(world, 30);
    assert.ok(ice.transform.y < held, `let go with its gravity turned over, it floats up (${ice.transform.y})`);
  });

  it("falls onto a solid collider and rests on it, rendered where the ball is", async () => {
    const { world, root, compiled } = await jar([{ id: 1, kind: "cherry", x: 30 }]);
    assert.match(compiled.code, /ownedHandles\(\)/, "the ball is told its world");
    assert.equal(world.ballCount, 1);
    step(world, 120);
    const [at] = places(root);
    // The floor's top is at y = 60 in the jar's space and the ball's radius is 5.
    assert.ok(Math.abs(at!.y - 55) < 0.05, `on the floor (y = ${at!.y})`);
    assert.ok(Math.abs(at!.x - 30) < 1e-9);
  });

  it("piles up between the walls, and a ball sees the balls it touches with their data", async () => {
    const touches: [number, number][] = [];
    const fruits = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, kind: i % 2 === 0 ? "cherry" : "grape", x: 8 + ((i * 13) % 44) }));
    const { world, root } = await jar(fruits, touches);
    step(world, 240);
    for (const at of places(root)) {
      assert.ok(at.x >= 4.5 && at.x <= 55.5, `inside the walls (x = ${at.x})`);
      assert.ok(at.y <= 55.5, `above the floor (y = ${at.y})`);
    }
    assert.ok(touches.length > 0, "some cherries touch cherries");
    const kinds = new Map(fruits.map((f) => [f.id, f.kind]));
    for (const [a, b] of touches) assert.equal(kinds.get(a), kinds.get(b), "only the same kind, as the filter asked");
  });

  it("leaves the world with its component", async () => {
    const { world, root } = await jar([
      { id: 1, kind: "cherry", x: 10 },
      { id: 2, kind: "cherry", x: 40 },
    ]);
    assert.equal(world.ballCount, 2);
    (root as Entity & { updateProps(next: Partial<Props>): void }).updateProps({ fruits: [{ id: 2, kind: "cherry", x: 40 }] });
    world.flush();
    assert.equal(world.ballCount, 1);
  });

  it("keeps its place and speed across a hot reload, and goes on falling as it would have", async () => {
    const compiled = compile(JAR);
    const { Jar } = await load<{ Jar: new (p: Props) => Entity }>(compiled);
    const props: Props = { fruits: [{ id: 1, kind: "cherry", x: 30 }], onTouch: () => {} };
    // One jar runs straight through; the other is replaced by a fresh one, given the first's state, halfway.
    const straight = new World();
    const through = new Jar(props);
    straight.mount(through);
    straight.flush();
    const world = new World();
    const first = new Jar(props);
    world.mount(first);
    world.flush();
    step(straight, 20);
    step(world, 20);
    const saved = captureHotState(first);
    world.root.removeChild(first);
    const second = new Jar(props);
    world.mount(second);
    restoreHotState(world, second, saved);
    assert.equal(world.ballCount, 1, "the old ball left with its component");
    assert.deepEqual(places(second), places(through), "it kept where it was");
    step(straight, 10);
    step(world, 10);
    assert.deepEqual(places(second), places(through), "and its speed: it falls on exactly as the one that was never reloaded");
  });
});
