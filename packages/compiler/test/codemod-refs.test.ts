/** `useRef` to `useMutable` (the codemod and the editor's quick fix share it): what it writes, and where it stops. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanOutput, closeCompiler, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const IMPORT = (names: string) => `import { ${names} } from "@rge/runtime/jsx";\n`;

function convert(body: string, names = "Entity, useRef, useMutable, useUpdate") {
  const result = getCompiler().convertToMutable("C.tsx", IMPORT(names) + body);
  return { ...result, errors: getCompiler().compile("C.tsx", result.text).diagnostics.filter((d) => d.severity === "error") };
}

describe("useRef to useMutable", () => {
  it("adds a field to the function's own useMutable, and rewrites `.current` to the field", () => {
    const r = convert(`export function C() {
  const s = useMutable({ hp: 3 });
  const timer = useRef(0);
  useUpdate((dt) => { timer.current += dt; if (timer.current > 1) { s.hp -= 1; timer.current = 0; } });
  return <Entity name="C" />;
}`);
    assert.ok(r.changed);
    assert.deepEqual(r.problems, []);
    assert.match(r.text, /const s = useMutable\(\{ hp: 3, timer: 0 \}\);/);
    assert.match(r.text, /s\.timer \+= dt; if \(s\.timer > 1\) \{ s\.hp -= 1; s\.timer = 0; \}/);
    assert.doesNotMatch(r.text, /useRef/);
    assert.deepEqual(r.errors, []);
  });

  it("adds to a multi-line useMutable after its last field, and keeps the comment of the ref", () => {
    const r = convert(`export function C() {
  const s = useMutable({
    hp: 3,
    name: "a",
  });
  /** Seconds since the last hit. */
  const since = useRef(0);
  useUpdate((dt) => { since.current += dt; });
  return <Entity name="C" />;
}`);
    assert.match(r.text, /name: "a",\n\s+\/\*\* Seconds since the last hit\. \*\/ since: 0,\n  \}\);/);
    assert.deepEqual(r.errors, []);
  });

  it("makes a useMutable where there is none, with the type argument kept, and drops the import", () => {
    const r = convert(
      `export function C() {
  const seen = useRef<string[]>([]);
  const last = useRef<number | null>(null);
  useUpdate(() => { seen.current = [...seen.current, "x"]; last.current = seen.current.length; });
  return <Entity name="C" />;
}`,
      "Entity, useRef, useUpdate",
    );
    assert.match(r.text, /const s = useMutable\(\{ seen: \[\] as string\[\], last: null as number \| null \}\);/);
    assert.match(r.text, /import \{ Entity, useMutable, useUpdate \}/);
    assert.deepEqual(r.errors, []);
  });

  it("leaves a name the ref shares with a local alone, and stops where a ref is used as a value", () => {
    const shadowed = convert(`export function C() {
  const n = useRef(0);
  useUpdate(() => { const f = (n: { current: number }) => n.current; n.current = f({ current: 2 }); });
  return <Entity name="C" />;
}`);
    assert.match(shadowed.text, /const f = \(n: \{ current: number \}\) => n\.current; s\.n = f\(\{ current: 2 \}\);/);

    const value = convert(`function useCounter() { const count = useRef(0); return count; }`);
    assert.equal(value.changed, false);
    assert.equal(value.problems.length, 1);
    assert.match(value.problems[0]!, /'count' is used as a value/);
  });

  it("stops at a field of the same name", () => {
    const r = convert(`export function C() {
  const s = useMutable({ n: 1 });
  const n = useRef(0);
  return <Entity name="C" />;
}`);
    assert.equal(r.changed, false);
    assert.match(r.problems[0]!, /already has a field 'n'/);
  });
});
