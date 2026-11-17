import assert from "node:assert/strict";
/**
 * `x`, `y`, `z`, `rotation`, `scaleX`, `scaleY`, `global` and `opacity` as props of a built-in (DESIGN.md, "Placing things"):
 * `<Sprite x={spot.x} y={spot.y} />` writes the sprite's runtime transform. There is no `transform` attribute.
 */
import { after, describe, it } from "node:test";

import { Entity, Line, Shape, Sprite, Text, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const sourceErrors = (body: string): string[] =>
  getCompiler()
    .typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/S${Math.random()}.tsx`,
        text: `import { Entity, Shape, Sprite, Music, useMutable } from "@tsengine/runtime/jsx";\ninterface DotProps { x: number }\nfunction Dot({ x }: DotProps) { return <Shape kind="rect" width={x} height={1} color="red" />; }\nfunction C() { const s = useMutable({ n: 3 }); const n = s.n; return <Entity>${body}</Entity>; }\nvoid C; void Dot;`,
      },
    ])
    .map((d) => d.message);

describe("transform props", () => {
  it("places a built-in with x, y, rotation, scale and global written as props, from state", async () => {
    const compiled = compile(`import { Entity, Shape, useInput, useMutable } from "@tsengine/runtime/jsx";
export function Row() {
  const s = useMutable({ at: 4 });
  useInput((input) => {
    if (input.pressed("Space")) s.at += 10;
  });
  return (
    <Entity x={1} y={2}>
      <Shape kind="rect" width={2} height={2} color="red" x={s.at} y={s.at * 2} rotation={0.5} scaleX={2} scaleY={3} z={7} />
      <Shape kind="rect" width={2} height={2} color="blue" x={9} y={5} global />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Row } = await load<{ Row: new () => Entity }>(compiled);
    const world = new World();
    const row = new Row();
    world.mount(row);
    world.flush();
    const [first, second] = row.children as Shape[];
    assert.deepEqual([row.transform.x, row.transform.y], [1, 2], "on the component's root");
    assert.deepEqual(
      [
        first!.transform.x,
        first!.transform.y,
        first!.transform.rotation,
        first!.transform.scaleX,
        first!.transform.scaleY,
        first!.transform.z,
      ],
      [4, 8, 0.5, 2, 3, 7]
    );
    assert.deepEqual([second!.transform.x, second!.transform.y, second!.transform.global], [9, 5, true], "`global` alone is true");
    assert.deepEqual([second!.worldTransform().x, second!.worldTransform().y], [9, 5], "ignores the parent at 1, 2");
    world.tick(1 / 60, { pressed: (key: string) => key === "Space", down: () => false, released: () => false } as never);
    world.flush();
    assert.deepEqual([first!.transform.x, first!.transform.y], [14, 28], "follows state");
  });

  it("refuses a transform attribute, and a built-in that cannot be placed", () => {
    const attribute = compileErrors(`import { Shape } from "@tsengine/runtime/jsx";
export function A() {
  return <Shape kind="rect" width={1} height={1} color="red" transform={{ x: 2, y: 3 }} />;
}`);
    assert.deepEqual(
      attribute.map((d) => [d.code, d.message]),
      [
        [
          DiagnosticCode.InvalidTransformAttribute,
          "There is no `transform` attribute: write its fields as props, `<Shape x={…} y={…} rotation={…} />`.",
        ],
      ]
    );
    const music = compileErrors(`import { Entity, Music } from "@tsengine/runtime/jsx";
export function A() {
  return <Entity><Music src="a.wav" x={3} /></Entity>;
}`);
    assert.equal(music[0]?.code, DiagnosticCode.InvalidTransformAttribute);
    assert.match(music[0]!.message, /<Music> cannot be placed with `x`/);
  });

  it("leaves x alone on a component: it is the component's own prop", async () => {
    const compiled = compile(`import { Entity, Shape } from "@tsengine/runtime/jsx";
interface DotProps {
  x: number;
}
export function Dot({ x }: DotProps) {
  return <Shape kind="rect" width={x} height={1} color="red" />;
}
export function Two() {
  return (
    <Entity>
      <Dot x={6} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Two } = await load<{ Two: new () => Entity }>(compiled);
    const world = new World();
    const two = new Two();
    world.mount(two);
    world.flush();
    const dot = two.children[0] as Shape;
    assert.equal(dot.width, 6);
    assert.equal(dot.transform.x, 0);
  });

  it("takes opacity as a prop on every built-in, fading a group from state, and leaves <Sprite opacity> the sprite's own", async () => {
    const compiled = compile(`import { Entity, Line, Shape, Sprite, Text, useInput, useMutable } from "@tsengine/runtime/jsx";
export function Card() {
  const s = useMutable({ fade: 0.5 });
  useInput((input) => {
    if (input.pressed("Space")) s.fade = 0.25;
  });
  return (
    <Entity opacity={s.fade}>
      <Shape kind="rect" width={2} height={2} color="red" opacity={0.8} />
      <Line x2={4} y2={4} opacity={0.6} />
      <Text opacity={0.4}>hit</Text>
      <Sprite image="coin.png" opacity={0.3} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Card } = await load<{ Card: new () => Entity }>(compiled);
    const world = new World();
    const card = new Card();
    world.mount(card);
    world.flush();
    const [shape, line, text, sprite] = card.children as [Shape, Line, Text, Sprite];
    assert.equal(card.transform.opacity, 0.5, "on the component's root: the whole group");
    assert.deepEqual([shape.transform.opacity, line.transform.opacity, text.transform.opacity], [0.8, 0.6, 0.4]);
    assert.deepEqual([sprite.opacity, sprite.transform.opacity], [0.3, 1], "<Sprite> keeps its own opacity prop");
    world.tick(1 / 60, { pressed: (key: string) => key === "Space", down: () => false, released: () => false } as never);
    world.flush();
    assert.equal(card.transform.opacity, 0.25, "follows state");
  });

  it("refuses a transform attribute on a component, naming the wrapper to place it with", () => {
    const component = compileErrors(`import { Entity } from "@tsengine/runtime/jsx";
function Dot() {
  return <Entity />;
}
export function B() {
  return <Entity><Dot transform={{ x: 5 }} /></Entity>;
}`);
    assert.deepEqual(
      component.map((d) => [d.code, d.message]),
      [
        [
          DiagnosticCode.InvalidTransformAttribute,
          "A component is not placed with `transform`: wrap it, `<Entity x={…} y={…}><Dot … /></Entity>`, or give it `x` and `y` props of its own and put them on its root.",
        ],
      ]
    );
  });

  it("type-checks in the editor on built-ins that take a transform, and not where they do not", () => {
    assert.deepEqual(sourceErrors(`<Shape kind="rect" width={1} height={1} opacity={n / 3} /><Entity opacity={0.5} />`), [], "opacity");
    assert.equal(sourceErrors(`<Entity opacity="half" />`).length, 1);
    assert.equal(sourceErrors(`<Entity transform={{ x: 1 }} />`).length, 1, "the editor refuses a transform attribute too");
    assert.equal(sourceErrors(`<Dot x={2} transform={{ x: 1 }} />`).length, 1, "on a component as well");
    assert.deepEqual(sourceErrors(`<Entity global x={1} />`), [], "global as a prop");
    assert.deepEqual(sourceErrors(`<Sprite image="coin.png" x={n} y={2} rotation={1} scaleX={2} scaleY={2} z={1} />`), []);
    assert.deepEqual(sourceErrors(`<Dot x={2} />`), [], "a component's own x");
    assert.equal(sourceErrors(`<Music src="a.wav" x={2} />`).length, 1);
    assert.equal(sourceErrors(`<Sprite image="coin.png" x="left" />`).length, 1);
  });
});
