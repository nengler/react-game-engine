/**
 * What the compiler says when a component is written as for React (PAIN_POINTS.md, 2026-11-14): one mistake is one error, and the
 * error says what to write instead. The editor shows each as the author types (`rge lsp`), so a cascade of follow-on errors or a
 * message that misleads costs more than it did in a terminal.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeCompiler, getCompiler } from "./helpers.ts";

after(() => closeCompiler());

const HEADER = `import { Entity, Text, useState, useUpdate, useMount } from "@rge/runtime/jsx";\n`;
const errors = (source: string): { code: string; message: string }[] =>
  getCompiler()
    .compile("src/A.tsx", HEADER + source)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => ({ code: d.code, message: d.message }));

/** The one error a source has. */
function only(source: string): { code: string; message: string } {
  const found = errors(source);
  assert.equal(found.length, 1, found.map((e) => `${e.code} ${e.message}`).join("\n"));
  return found[0]!;
}

describe("one mistake, one error", () => {
  it("does not report a const again at every read once its value was refused", () => {
    const e = only(`export function A() { const [n] = useState(0); const m = n.toFixedd(2); return <Text>{m} {n} {m}</Text>; }`);
    assert.equal(e.message, "'toFixedd' is not a method the compiler knows: did you mean 'toFixed'?");
  });

  it("does not report a state again when its useState was refused", () => {
    assert.equal(only(`export function A() { const [p] = useState({ x: 0, y: 0 }); return <Entity x={p.x} y={p.y} />; }`).code, "RGE1104");
  });

  it("does not report the props again when the props parameter was refused", () => {
    assert.equal(only(`export function A({ hp }: { hp: number }) { return <Text>{hp}</Text>; }`).code, "RGE1208");
  });

  it("does not report a component or a function declared inside another as unknown where it is used", () => {
    assert.match(only(`export function A() { function Inner() { return <Text>x</Text>; } return <Entity><Inner /></Entity>; }`).message, /^Declare the component <Inner> at the top level of the file/);
    assert.match(only(`export function A() { function twice(n: number) { return n * 2; } return <Text>{twice(2)}</Text>; }`).message, /^Write the function as `const twice = \(…\) => \{ … \};`: a function declaration is not supported in the component body\./);
  });

  it("still reports a name declared nowhere, with no other error to blame", () => {
    assert.equal(only(`export function A() { return <Text>{nope}</Text>; }`).message, "'nope' is not a state value of this component.");
  });
});

describe("what to write instead", () => {
  it("an early return: the condition goes in what the component returns", () => {
    const e = only(`interface P { hp: number }\nexport function A({ hp }: P) { if (hp <= 0) return null; return <Text>{hp}</Text>; }`);
    assert.equal(e.code, "RGE1002");
    assert.match(e.message, /`return dead \? null : <Text>…<\/Text>;`/);
  });

  it("forEach: a for…of loop, without saying it changes the array", () => {
    const e = only(`interface P { xs: number[] }\nexport function A({ xs }: P) { let t = 0; xs.forEach((x) => { t += x; }); return <Text>{t}</Text>; }`);
    assert.match(e.message, /^`forEach` is not supported: write a `for \(const item of items\) \{ … \}` loop/);
    assert.doesNotMatch(e.message, /in place/);
  });

  it("setTimeout and setInterval: after and every", () => {
    assert.match(only(`export function A() { const [n, setN] = useState(0); useMount(() => { setTimeout(() => setN(1), 100); }); return <Text>{n}</Text>; }`).message, /^There is no `setTimeout`: .*`after\(seconds, \(\) => …\)`/);
    assert.match(only(`export function A() { const [n, setN] = useState(0); useMount(() => { setInterval(() => setN(n + 1), 100); }); return <Text>{n}</Text>; }`).message, /^There is no `setInterval`: .*`every\(seconds, \(\) => …\)`/);
  });

  it("a misspelt function: the nearest one it knows", () => {
    assert.match(only(`export function A() { const [n] = useState(0); return <Text>{clmap(n, 0, 1)}</Text>; }`).message, /^'clmap' is not a function the compiler knows \(did you mean 'clamp'\?\)\./);
  });

  it("await: the game's steps do not wait", () => {
    assert.match(only(`export function A() { useMount(async () => { await Promise.resolve(); }); return <Entity />; }`).message, /^`await` is not supported: .*`after\(seconds, \(\) => …\)`/);
  });
});
