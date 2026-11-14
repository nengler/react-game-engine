/**
 * The custom-hook inliner as the rest of the compiler sees it: diagnostics and IR spans point at the source as written (not the
 * expanded text), each hook file is parsed once however often it is called, the parse of a file with no hooks is reused for
 * analysis, and the authoring module is the manifest's, not a fixed name.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { runtimeManifest } from "@rge/runtime";
import { Compiler, DiagnosticCode, EditMap, TsxParser, expandCustomHooks, type CompilerDiagnostic } from "../src/index.ts";
import { closeCompiler, getCompiler, withAuthoringImports } from "./helpers.ts";

after(() => closeCompiler());

describe("positions after inlining", () => {
  it("an error below a custom hook call is reported at its line and column as written", () => {
    // The hook expands to several lines; the error after it must not move down with them.
    const source = withAuthoringImports(`function useCounter(step: number) {
  const s = useMutable({ n: 0 });
  useUpdate(() => {
    s.n += step;
  });
  return s.n;
}

function C() {
  const n = useCounter(2);
  const bad = nope + n;
  return <Entity name="C" />;
}`);
    const result = getCompiler().compile("C.tsx", source);
    assert.equal(result.ok, false);
    const d = result.diagnostics.find((x) => x.code === DiagnosticCode.UnknownIdentifier)!;
    assert.ok(d.span);
    assert.equal(d.span.line, 11);
    assert.equal(source.slice(d.span.start, d.span.end), "nope");
    assert.equal(d.span.column, source.split("\n")[10]!.indexOf("nope") + 1);
  });

  it("IR spans are in the source as written; a span made inside an expansion covers the hook call", () => {
    const source = withAuthoringImports(`function useTicker() {
  const s = useMutable({ t: 0 });
  useUpdate((dt) => { s.t += dt; });
  return s.t;
}

export function C() {
  const t = useTicker();
  return <Entity name="C" transform={{ x: t }}><Sprite image="a.png" /></Entity>;
}`);
    const result = getCompiler().compile("C.tsx", source);
    assert.ok(result.ok, result.diagnostics.map((d) => d.message).join("\n"));
    const c = result.ir.components[0]!;
    assert.equal(source.slice(c.span.start, c.span.start + "export function C()".length), "export function C()");
    const sprite = c.root.children[0]!;
    assert.ok(sprite.kind === "StaticChild");
    assert.equal(source.slice(sprite.element.span.start, sprite.element.span.end), `<Sprite image="a.png" />`);
    const hook = c.hooks.find((h) => h.kind === "OnUpdate")!;
    assert.equal(source.slice(hook.span.start, hook.span.end), "const t = useTicker();");
  });

  it("maps positions through several passes: before, inside and after a replacement", () => {
    const map = new EditMap();
    const one = map.apply("abcXdef", [{ start: 3, end: 4, text: "12345" }]); // abc12345def
    const two = map.apply(one, [{ start: 0, end: 0, text: ">>" }]); // >>abc12345def
    assert.equal(two, ">>abc12345def");
    assert.equal(map.toOriginal(two.indexOf("a")), 0);
    assert.equal(map.toOriginal(two.indexOf("3")), 3, "inside the replacement: its start");
    assert.equal(map.toOriginal(two.indexOf("3"), map.passes, "end"), 4);
    assert.equal(map.toOriginal(two.indexOf("d")), 4);
    assert.equal(map.toOriginal(one.indexOf("d"), 1), 4, "a position in the text after the first pass");
  });
});

/** A parser that counts what it parses, by file. */
class CountingParser extends TsxParser {
  readonly counts = new Map<string, number>();
  override parse(fileName: string, text: string) {
    this.counts.set(fileName, (this.counts.get(fileName) ?? 0) + 1);
    return super.parse(fileName, text);
  }
}

describe("parsing", () => {
  it("parses a hook's file once however many times it is called, and a hookless file once", () => {
    const parser = new CountingParser();
    try {
      const hooks = `import { useState } from "@rge/runtime/jsx";\nexport function useFlag() { const [f, setF] = useState(false); return [f, setF]; }`;
      const diagnostics: CompilerDiagnostic[] = [];
      const expanded = expandCustomHooks(
        parser,
        "Main.tsx",
        `import { Entity } from "@rge/runtime/jsx"; import { useFlag } from "./hooks.tsx";
function C() { const [a, setA] = useFlag(); const [b, setB] = useFlag(); const [c, setC] = useFlag(); return <Entity name="C" />; }`,
        () => ({ fileName: "hooks.tsx", text: hooks }),
        diagnostics,
        runtimeManifest.authoringModule,
      );
      expanded.parsed?.dispose();
      assert.deepEqual(diagnostics, []);
      assert.equal(parser.counts.get("hooks.tsx"), 1);
      assert.equal(parser.counts.get("Main.tsx"), 2, "once with the calls, once expanded");

      const plain = expandCustomHooks(parser, "Plain.tsx", `function C() { return <Entity name="C" />; }`, null, diagnostics, runtimeManifest.authoringModule);
      assert.ok(plain.parsed, "the parse is handed on for analysis");
      plain.parsed.dispose();
      assert.equal(parser.counts.get("Plain.tsx"), 1);
    } finally {
      parser.close();
    }
  });
});

describe("authoring module", () => {
  it("the library's hooks are found under the manifest's authoring module", () => {
    const manifest = { ...runtimeManifest, authoringModule: "my-engine/jsx" };
    const compiler = new Compiler({ manifest });
    try {
      const result = compiler.compile(
        "C.tsx",
        `import { Entity, useTime } from "my-engine/jsx";
function C() {
  const time = useTime();
  return <Entity name="C" transform={{ x: time }} />;
}`,
      );
      assert.ok(result.ok, result.diagnostics.map((d) => d.message).join("\n"));
      // The hook's own state is named after it (`time`), numbered because the component already has a `time`.
      assert.match(result.code, /\$time2_time/);
    } finally {
      compiler.close();
    }
  });
});

describe("type imports", () => {
  it("imports a type the generated module names, and not one only mentioned in a string or a comment", () => {
    const result = getCompiler().compile(
      "T.tsx",
      withAuthoringImports(`import type { Tower, Wave } from "./rules.ts";
// a Wave is a group of enemies
const LABEL = "Wave";
interface Props { tower: Tower }
export function T({ tower }: Props) {
  return <Entity name={LABEL} />;
}`),
    );
    assert.ok(result.ok, result.diagnostics.map((d) => d.message).join("\n"));
    assert.match(result.code, /import type \{ Tower \} from "\.\.\/rules\.ts";/);
    assert.doesNotMatch(result.code, /import type \{[^}]*Wave/);
  });
});
