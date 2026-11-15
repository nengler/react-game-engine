import assert from "node:assert/strict";
// A state's type is inferred through `Math`'s constants, as through any number: `useState(-Math.PI / 2)` is a number.
import { after, describe, it } from "node:test";

import { cleanOutput, closeCompiler, compile, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("state typed through Math's constants", () => {
  it("infers a number from Math.PI and Math.E, alone or in arithmetic", () => {
    const compiled = compile(`export function Barrel() {
      const s = useMutable({ angle: -Math.PI / 2, e: Math.E });
      useUpdate((dt) => { s.angle += dt * s.e; });
      return <Entity />;
    }`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /angle: number = /);
    assert.match(compiled.code, /e: number = Math\.E/);
  });
});
