import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The reference cannot fall behind the runtime: every built-in and hook the manifest knows has an entry in the reference's data,
// docs/guide.js.
import { describe, it } from "node:test";

import { runtimeManifest } from "../src/index.ts";

const read = (name: string): string => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), "utf8");
const reference = read("guide.js");
const PAGES = ["index.html", "language.html", "systems.html", "effects.html", "reference.html"];

describe("docs/guide.js", () => {
  it("has an entry for every built-in element", () => {
    const missing = runtimeManifest.intrinsics.filter((name) => !new RegExp(`name: "${name}"`).test(reference));
    assert.deepEqual(missing, [], "built-ins missing from the reference (add them to ELEMENTS in docs/guide.js)");
  });
});

// The guide's search box matches the index in docs/search-index.js; it cannot fall behind the sections it indexes.
describe("the guide's search index", () => {
  it("matches every section's text, on every page (run node tools/docs-index.ts after changing a section)", async () => {
    const { updateIndex } = await import("../../../tools/docs-index.ts");
    assert.equal(updateIndex(false), false, "docs/search-index.js is stale");
  });

  // One copy of the script and of the index, shared: a copy inlined into a page falls behind the others.
  it("is loaded by every page, with the shared script, and no page has its own copy", () => {
    for (const page of PAGES) {
      const html = read(page);
      assert.match(html, /<script src="search-index\.js"><\/script>\n<script src="guide\.js"><\/script>/, page);
      assert.doesNotMatch(html, /var (MANIFEST|ELEMENTS|DIAG) =/, page);
    }
  });
});
