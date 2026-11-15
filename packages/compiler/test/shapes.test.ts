import assert from "node:assert/strict";
/** `<Collider shape points>` in a component: the shape is a checked literal, and the props reach the collider. */
import { after, describe, it } from "node:test";

import { Collider, World, type Entity } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("<Collider shape>", () => {
  it("compiles a circle and a polygon", async () => {
    const compiled = compile(`export function Ramp() {
  return (
    <Entity>
      <Collider shape="circle" width={12} height={12} tag="orb" />
      <Collider shape="polygon" width={16} height={16} points={[0, 16, 16, 16, 16, 0]} tag="ramp" />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Ramp } = await load<{ Ramp: new () => Entity }>(compiled);
    const ramp = new Ramp();
    new World().mount(ramp);
    const [orb, slope] = ramp.children as Collider[];
    assert.ok(orb instanceof Collider && slope instanceof Collider);
    assert.equal(orb.shape, "circle");
    assert.deepEqual([slope.shape, slope.points], ["polygon", [0, 16, 16, 16, 16, 0]]);
  });

  it("checks a shape written as a literal", () => {
    const errors = compileErrors(`function Bad() { return <Collider shape="cirlce" width={4} height={4} />; }`);
    assert.match(errors.map((e) => e.message).join("\\n"), /cirlce/);
  });
});
