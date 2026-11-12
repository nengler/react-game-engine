/**
 * Errors are reported in the component source, not in the generated code: a type error found in a generated file is moved to the
 * line of the `.tsx` it was written for, an error the source check found is not reported again from the generated code, and a
 * file that failed to compile is not reported again as a missing import elsewhere.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { mapToSource, type CompilerDiagnostic } from "../src/index.ts";

const repo = resolve(import.meta.dirname, "../../..");

/** Compile a project's `src/` with the command line, and return what it printed on stderr and its exit status. */
function compileProject(files: Record<string, string>): { status: number | null; stderr: string; dir: string } {
  mkdirSync(join(repo, ".test-output"), { recursive: true });
  const dir = mkdtempSync(join(repo, ".test-output", "srcdiag-"));
  mkdirSync(join(dir, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], { cwd: repo, encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stderr: r.stderr, dir: relative(repo, dir) };
}

describe("diagnostics in the source", () => {
  it("reports a type error in the source once, and does not check the generated code until the source passes", () => {
    const r = compileProject({
      "A.tsx": `import { Entity, Sprite, useState } from "@rge/runtime/jsx";
export function A() {
  const [n, setN] = useState(0);
  return <Entity name="A"><Sprite image={n} /></Entity>;
}
`,
    });
    assert.equal(r.status, 1);
    const errors = r.stderr.split("\n").filter((l) => / - error /.test(l));
    assert.equal(errors.length, 1, r.stderr);
    assert.match(errors[0]!, /src\/A\.tsx:4:\d+ - error RGE9002: TS2322: /);
    assert.match(r.stderr, /skipped type-checking the generated code: fix the type errors above first/);
  });

  it("does not report a file that failed to compile again, as a missing module of the files that import it", () => {
    const r = compileProject({
      "Child.tsx": `import { Entity } from "@rge/runtime/jsx";
export function Child() {
  while (true) {}
  return <Entity name="Child" />;
}
`,
      "Parent.tsx": `import { Entity } from "@rge/runtime/jsx";
import { Child } from "./Child.tsx";
export function Parent() {
  return <Entity name="Parent"><Child /></Entity>;
}
`,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /src\/Child\.tsx:3:\d+ - error/, "the cause, in its source");
    assert.doesNotMatch(r.stderr, /Cannot find module/, "no missing module in a generated file");
    assert.match(r.stderr, /skipped type-checking the generated code/);
  });

  it("leaves a diagnostic on a line written for no construct, or in another file, where it was", () => {
    const d = (fileName: string, line: number): CompilerDiagnostic => ({ code: "RGE9001", severity: "error", message: "TS1: x", span: { fileName, start: 0, end: 1, line, column: 3 } });
    const files = [{ fileName: "/out/A.ts", sourceFile: "src/A.tsx", sourceText: "one\n  two\nthree\n", origins: [{ line: 4, column: 0, source: { line: 2, column: 3 } }] }];
    const [mapped, unmapped, other] = mapToSource([d("/out/A.ts", 5), d("/out/A.ts", 1), d("/out/B.ts", 5)], files, "/");
    assert.deepEqual(mapped!.span, { fileName: "src/A.tsx", start: 6, end: 9, line: 2, column: 3 });
    assert.equal(mapped!.message, "TS1: x (in the generated out/A.ts:5:3)");
    assert.equal(unmapped!.span!.fileName, "/out/A.ts");
    assert.equal(other!.span!.fileName, "/out/B.ts");
  });
});
