import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The reference cannot fall behind the runtime: every built-in and hook the manifest knows has an entry in docs/reference.html.
import { describe, it } from "node:test";

import { runtimeManifest } from "../src/index.ts";

const reference = readFileSync(new URL("../../../docs/reference.html", import.meta.url), "utf8");

describe("docs/reference.html", () => {
  it("has an entry for every built-in element", () => {
    const missing = runtimeManifest.intrinsics.filter((name) => !new RegExp(`name: "${name}"`).test(reference));
    assert.deepEqual(missing, [], "built-ins missing from the reference (add them to docs/reference.html)");
  });
});

// The guide's search box matches an index written into every page; it cannot fall behind the sections it indexes.
describe("the guide's search index", () => {
  it("matches every section's text, on every page (run node tools/docs-index.ts after changing a section)", async () => {
    const { updateIndex } = await import("../../../tools/docs-index.ts");
    assert.deepEqual(updateIndex(false), [], "pages whose index is stale");
  });
});
