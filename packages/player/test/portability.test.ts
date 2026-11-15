import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packages = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []
  );
}

/** The player and the runtime also run inside QuickJS, which has no Node: they may import only each other and themselves. */
const FORBIDDEN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](?:node:|(?:koffi|fs|path|os|child_process)["'/])/;

describe("portability", () => {
  for (const name of ["player", "runtime"]) {
    it(`@rge/${name} imports nothing from Node or a native package`, () => {
      const files = sources(join(packages, name, "src"));
      assert.ok(files.length > 0);
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        assert.doesNotMatch(text, FORBIDDEN, `${file} imports a Node or native module`);
      }
    });
  }

  it("the check catches a Node import", () => {
    assert.match('import { readFileSync } from "node:fs";', FORBIDDEN);
    assert.match('const x = await import("node:fs");', FORBIDDEN);
    assert.match('import koffi from "koffi";', FORBIDDEN);
    assert.doesNotMatch('import { World } from "./World.ts";', FORBIDDEN);
  });
});
