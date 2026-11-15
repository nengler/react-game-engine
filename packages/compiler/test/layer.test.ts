import assert from "node:assert/strict";
/** `<Layer>` (ABI v10) in a component: a container whose blend modes are checked literals, and whose props follow state. */
import { after, describe, it } from "node:test";

import { Layer, Shape, World, type Entity } from "@rge/runtime";

import { checkAssets } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("<Layer>", () => {
  it("compiles as a container whose props follow state", async () => {
    const compiled = compile(`export function Night() {
  const s = useMutable({ dark: 0.5 });
  useUpdate(() => { s.dark = 1; });
  return (
    <Layer blend="multiply" clear="#101020" childBlend="add" opacity={s.dark}>
      <Shape kind="circle" width={40} height={40} color="white" />
    </Layer>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Night } = await load<{ Night: new () => Entity }>(compiled);
    const world = new World();
    const night = new Night();
    world.mount(night);
    world.flush();
    assert.ok(night instanceof Layer);
    const layer = night as unknown as Layer;
    assert.deepEqual([layer.blend, layer.childBlend, layer.clear, layer.opacity], ["multiply", "add", "#101020", 0.5]);
    assert.ok(layer.children[0] instanceof Shape);
    world.tick(1 / 60);
    world.flush();
    assert.equal(layer.opacity, 1);
  });

  it("checks a blend mode written as a literal", () => {
    const errors = compileErrors(`function Bad() { return <Layer blend="mulitply"><Entity /></Layer>; }`);
    assert.ok(errors.length > 0);
    assert.match(errors.map((e) => e.message).join("\n"), /mulitply/);
  });

  it("checks a shader named as a literal against the assets folder, with the nearest name", () => {
    const compiled = compile(`function Night() { return <Layer shader="cvae.glsl" params={[1, 2]}><Entity /></Layer>; }`);
    const found = checkAssets([compiled.ir], { folder: "assets", exists: (name) => name === "cave.glsl", list: () => ["cave.glsl"] });
    assert.equal(found.length, 1);
    assert.match(found[0]!.message, /shader/);
    assert.match(found[0]!.message, /cave\.glsl/);
    const fine = compile(`function Night() { return <Layer shader="cave.glsl"><Entity /></Layer>; }`);
    assert.deepEqual(checkAssets([fine.ir], { folder: "assets", exists: (name) => name === "cave.glsl", list: () => ["cave.glsl"] }), []);
  });
});
