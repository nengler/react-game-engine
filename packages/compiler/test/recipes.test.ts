/** docs/recipes.html cannot fall behind the engine: each recipe is a component file, compiled and type-checked as an author's would be. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanOutput, closeCompiler, compile, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const page = readFileSync(new URL("../../../docs/recipes.html", import.meta.url), "utf8");
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'", "#39": "'" };
const recipes = [...page.matchAll(/<pre class="code" data-lang="tsx" data-recipe="([^"]+)"><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) => ({
  file: m[1]!,
  source: m[2]!.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, name: string) => ENTITIES[name]!),
}));

describe("docs/recipes.html", () => {
  it("has its recipes", () => {
    assert.ok(recipes.length >= 7, `${recipes.length} recipes`);
  });
  for (const { file, source } of recipes) {
    it(`${file} compiles and type-checks`, () => {
      const compiled = compile(source, file);
      assert.deepEqual(typeCheck(compiled), []);
    });
  }
});
