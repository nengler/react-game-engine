// The reference cannot fall behind the runtime: every built-in and hook the manifest knows has an entry in docs/reference.html.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runtimeManifest } from "../src/index.ts";

const reference = readFileSync(new URL("../../../docs/reference.html", import.meta.url), "utf8");

describe("docs/reference.html", () => {
  it("has an entry for every built-in element", () => {
    const missing = runtimeManifest.intrinsics.filter((name) => !new RegExp(`name: "${name}"`).test(reference));
    assert.deepEqual(missing, [], "built-ins missing from the reference (add them to docs/reference.html)");
  });
});
