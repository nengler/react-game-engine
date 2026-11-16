import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { Compiler, type CompilerDiagnostic } from "@tsengine/compiler";

import { applyEdits, callArguments, fixesFor } from "../src/fixes.ts";

const compiler = new Compiler();
after(() => compiler.close());

const diagnose = (source: string): CompilerDiagnostic[] => [...compiler.compile("src/A.tsx", source).diagnostics];

/** Apply the preferred fix (or the only one) for the first diagnostic with `code`, and return the new text. */
function fix(source: string, code: string): string {
  const diagnostic = diagnose(source).find((d) => d.code === code);
  assert.ok(
    diagnostic,
    `no ${code} in:\n${source}\n${diagnose(source)
      .map((d) => `${d.code} ${d.message}`)
      .join("\n")}`
  );
  const fixes = fixesFor(source, diagnostic, compiler);
  const chosen = fixes.find((f) => f.preferred) ?? fixes[0];
  assert.ok(chosen, `no fix for ${code}: ${diagnostic.message}`);
  return applyEdits(source, chosen.edits);
}

const codes = (source: string): string[] => diagnose(source).map((d) => d.code);

describe("quick fixes", () => {
  it("imports a hook or built-in that is used but not imported, keeping the list sorted", () => {
    const fixed = fix(
      `import { Entity, useInput } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 0 });\n  return <Entity />;\n}\n`,
      "TSE1005"
    );
    assert.match(fixed, /^import \{ Entity, useInput, useMutable \} from "@tsengine\/runtime\/jsx";/);
    assert.deepEqual(codes(fixed), []);
  });

  it("imports from the authoring module instead of react, into the import that is there", () => {
    const fixed = fix(
      `import { useMutable } from "react";\nimport { Entity } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 0 });\n  return <Entity />;\n}\n`,
      "TSE1001"
    );
    assert.equal(fixed.split("\n")[0], `import { Entity, useMutable } from "@tsengine/runtime/jsx";`);
    assert.deepEqual(codes(fixed), []);
  });

  it("moves a text attribute into the children of <Text>", () => {
    const literal = fix(
      `import { Text } from "@tsengine/runtime/jsx";\nexport function A() {\n  return <Text text="hi" size={8} />;\n}\n`,
      "TSE1203"
    );
    assert.match(literal, /<Text size=\{8\}>hi<\/Text>/);
    assert.deepEqual(codes(literal), []);
    const expression = fix(
      `import { Text } from "@tsengine/runtime/jsx";\nexport function A({ n }: AProps) {\n  return <Text size={8} text={\`n \${n}\`} />;\n}\ninterface AProps { n: number }\n`,
      "TSE1203"
    );
    assert.match(expression, /<Text size=\{8\}>\{`n \$\{n\}`\}<\/Text>/);
    assert.deepEqual(codes(expression), []);
  });

  it("turns useEffect with [] into useMount, and fixes the import", () => {
    const source = `import { Entity, useEffect, useMutable } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 0 });\n  useEffect(() => {\n    s.x = 1;\n  }, []);\n  return <Entity />;\n}\n`;
    const fixed = fix(source, "TSE1102");
    assert.match(fixed, /import \{ Entity, useMount, useMutable \}/);
    assert.match(fixed, /useMount\(\(\) => \{\n {4}s\.x = 1;\n {2}\}\);/);
    assert.deepEqual(codes(fixed), []);
  });

  it("offers nothing for an effect with dependencies: the message says what to do instead", () => {
    const source = `import { Entity, useEffect, useMutable } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 0 });\n  useEffect(() => { s.x = 1; }, [s.x]);\n  return <Entity />;\n}\n`;
    const diagnostic = diagnose(source).find((d) => d.code === "TSE1102")!;
    assert.deepEqual(fixesFor(source, diagnostic), []);
  });

  it("turns useMemo into the value and useCallback into the function", () => {
    const memo = fix(
      `import { Entity, useMemo, useMutable } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 2 });\n  const twice = useMemo(() => (s.x * 2), [s.x]);\n  return <Entity transform={{ x: twice }} />;\n}\n`,
      "TSE1102"
    );
    assert.match(memo, /const twice = s\.x \* 2;/);
    assert.match(memo, /import \{ Entity, useMutable \}/);
    assert.deepEqual(codes(memo), []);
    const callback = fix(
      `import { Entity, useCallback, useMutable } from "@tsengine/runtime/jsx";\nexport function A() {\n  const s = useMutable({ x: 2 });\n  const more = useCallback(() => { s.x += 1; }, [s.x]);\n  return <Entity onPress={more} />;\n}\n`,
      "TSE1102"
    );
    assert.match(callback, /const more = \(\) => \{ s\.x \+= 1; \};/);
  });

  it("takes actions with useGame.actions() instead of from the whole state", () => {
    const source = `const { begin } = useGame((s) => s);`;
    const fixes = fixesFor(source, {
      code: "TSE1108",
      severity: "warning",
      message: "Take actions with `const { begin } = useGame.actions()` rather than from the whole state",
      span: { fileName: "src/A.tsx", start: 0, end: source.length, line: 1, column: 1 },
    });
    assert.equal(applyEdits(source, fixes[0]!.edits), "const { begin } = useGame.actions();");
  });

  it("removes a name the authoring module does not export, and the import with it when it was the last", () => {
    const fixed = fix(
      `import { Entity } from "@tsengine/runtime/jsx";\nimport { useLayoutEffect } from "@tsengine/runtime/jsx";\nexport function A() {\n  return <Entity />;\n}\n`,
      "TSE1004"
    );
    assert.ok(!fixed.includes("useLayoutEffect"), fixed);
  });

  it("finds a call's arguments past strings, templates, comments and nested brackets", () => {
    const source = `f(a(")", 1), "x,y", \`t\${1}\` /* ), */, [1, 2])`;
    const found = callArguments(source, 1)!;
    assert.deepEqual(
      found.args.map((a) => source.slice(a.start, a.end)),
      [`a(")", 1)`, `"x,y"`, "`t${1}` /* ), */", "[1, 2]"]
    );
    assert.equal(found.close, source.length - 1);
  });

  it("takes a component written as for React to one that compiles, with the quick fixes alone", () => {
    let source = `import { useEffect, useMemo, useState } from "react";
import { Entity } from "@tsengine/runtime/jsx";

export function Lamp() {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    setLit(true);
  }, []);
  const glow = useMemo(() => (lit ? 1 : 0.2), [lit]);
  return (
    <Entity opacity={glow}>
      <Text text="lamp" />
    </Entity>
  );
}
`;
    const applied: string[] = [];
    for (let round = 0; round < 10; round++) {
      const found = diagnose(source).filter((d) => d.severity === "error");
      if (found.length === 0) break;
      const fixable = found
        .map((d) => ({ d, fix: fixesFor(source, d, compiler).find((f) => f.preferred) ?? fixesFor(source, d, compiler)[0] }))
        .find((x) => x.fix !== undefined);
      assert.ok(fixable, `no fix left for:\n${found.map((d) => `${d.code} ${d.message}`).join("\n")}\n${source}`);
      applied.push(fixable.fix!.title);
      source = applyEdits(source, fixable.fix!.edits);
    }
    assert.deepEqual(codes(source), [], source);
    assert.ok(compiler.compile("src/A.tsx", source).ok);
    assert.match(source, /^import \{ Entity, Text, useMount, useMutable \} from "@tsengine\/runtime\/jsx";$/m);
    assert.match(source, /const s = useMutable\(\{ lit: false \}\);/);
    assert.match(source, /useMount\(\(\) => \{\n {4}s\.lit = true;/);
    assert.match(source, /const glow = s\.lit \? 1 : 0\.2;/);
    assert.match(source, /<Text>lamp<\/Text>/);
    assert.ok(applied.includes("Move this file's useState to useMutable"), applied.join("\n"));
    assert.equal(applied.length, 6, applied.join("\n"));
  });
});
