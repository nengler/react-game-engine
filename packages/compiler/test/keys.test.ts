import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { KEY_NAMES } from "@rge/runtime";
import { KEYS } from "@rge/player";
import { DiagnosticCode } from "../src/index.ts";
import { closeCompiler, compile, compileErrors } from "./helpers.ts";

const component = (call: string): string => `
function C() {
  const [n, setN] = useState(0);
  useInput((input) => { if (${call}) setN(n + 1); });
  return <Entity name="C" />;
}`;

describe("key names in input calls", () => {
  after(closeCompiler);

  it("share one list between the compiler's check and the player's buffer", () => {
    assert.equal(KEYS, KEY_NAMES);
  });

  it("accept every known key, in pressed, down and released", () => {
    for (const key of ["Space", "ArrowLeft", "A", "7", "F11", "MouseLeft"]) {
      for (const method of ["pressed", "down", "released"]) assert.doesNotThrow(() => compile(component(`input.${method}("${key}")`)), `${method}("${key}")`);
    }
  });

  it("reject a typo with a suggestion", () => {
    const errors = compileErrors(component(`input.pressed("Spcae")`));
    assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
    assert.match(errors[0]!.message, /'Spcae' is not a key name \(did you mean "Space"\?\)/);
  });

  it("reject an unknown key with no close match, and list the keys", () => {
    const errors = compileErrors(component(`input.down("Banana")`));
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /'Banana' is not a key name\. Keys are: Space, Enter/);
  });

  it("leave a key that is not a literal to run time", () => {
    assert.doesNotThrow(() => compile(component(`input.pressed(n > 1 ? "Space" : "Enter")`)));
  });
});
