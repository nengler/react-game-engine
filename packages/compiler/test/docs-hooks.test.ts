// The reference cannot fall behind the compiler: every authoring hook has an entry in the docs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTHORING_HOOKS } from "../src/index.ts";

const read = (name: string): string => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), "utf8");
const docs = read("reference.html") + read("language.html");

describe("the docs", () => {
  it("mention every authoring hook", () => {
    const missing = AUTHORING_HOOKS.filter((name) => !docs.includes(name));
    assert.deepEqual(missing, [], "hooks missing from docs/reference.html and docs/language.html");
  });
});
