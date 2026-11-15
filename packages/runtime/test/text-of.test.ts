import assert from "node:assert/strict";
/** `textOf`: a `{value}` between a `<Text>`'s tags, as it is drawn. */
import { describe, it } from "node:test";

import { textOf } from "../src/index.ts";

describe("textOf", () => {
  it("draws null, undefined and booleans as no text, as React does, and keeps strings and numbers", () => {
    assert.deepEqual(
      [null, undefined, true, false, "", "hi", 0, 3.5].map((v) => `[${textOf(v)}]`),
      ["[]", "[]", "[]", "[]", "[]", "[hi]", "[0]", "[3.5]"]
    );
  });
});
