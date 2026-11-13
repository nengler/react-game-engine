/**
 * Every loop, `try` and `throw` in a handler (REACT_FEEL_PLAN.md, A1): what a React author writes in a function works in a
 * `useUpdate`, a `useInput`, a callback prop and an updater's handler.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Text, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

async function run(body: string, frames = 1): Promise<string> {
  const compiled = compile(`
export function Probe() {
  const [out, setOut] = useState("");
  useUpdate((dt) => {
    ${body}
  });
  return <Text>{out}</Text>;
}`);
  assert.deepEqual(typeCheck(compiled), []);
  const { Probe } = await load<{ Probe: new () => Text }>(compiled);
  const world = new World();
  const probe = new Probe();
  world.mount(probe);
  for (let i = 0; i < frames; i++) {
    world.tick(1 / 60);
    world.flush();
  }
  return probe.text;
}

describe("loops in handlers", () => {
  it("runs a C-style for, with several lets, a comma update, break and continue", async () => {
    assert.equal(
      await run(`
    let text = "";
    for (let i = 0, j = 10; i < 10; i++, j -= 2) {
      if (i === 1) continue;
      if (i > 4) break;
      text += \`\${i}:\${j} \`;
    }
    setOut(text);`),
      "0:10 2:6 3:4 4:2 ",
    );
  });

  it("runs while and do…while", async () => {
    assert.equal(
      await run(`
    let n = 5;
    let text = "";
    while (n > 0) {
      n -= 2;
      text += n;
    }
    do {
      text += "!";
    } while (false);
    setOut(text);`),
      "31-1!",
    );
  });

  it("runs a for with no head, ended by break", async () => {
    assert.equal(
      await run(`
    let n = 0;
    for (;;) {
      n++;
      if (n === 3) break;
    }
    setOut(String(n));`),
      "3",
    );
  });

  it("catches what is thrown, and runs finally", async () => {
    assert.equal(
      await run(`
    let text = "";
    try {
      text += "a";
      throw "boom";
    } catch (e) {
      text += String(e);
    } finally {
      text += "!";
    }
    try {
      text += "b";
    } catch {
      text += "never";
    }
    setOut(text);`),
      "aboom!b",
    );
  });

  it("assigns to a ref in a for head", async () => {
    const compiled = compile(`
export function Counter() {
  const steps = useRef(0);
  const [out, setOut] = useState(0);
  useUpdate(() => {
    for (steps.current = 0; steps.current < 4; steps.current++) {}
    setOut(steps.current);
  });
  return <Text>{out}</Text>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Counter } = await load<{ Counter: new () => Text }>(compiled);
    const world = new World();
    const counter = new Counter();
    world.mount(counter);
    world.tick(1 / 60);
    world.flush();
    assert.equal(counter.text, "4");
  });
});

describe("what a loop's head may hold", () => {
  const codes = (body: string) =>
    compileErrors(`function C() { const [n, setN] = useState(0); useUpdate(() => { ${body} }); return <Entity />; }`).map((d) => d.code);

  it("keeps state out of a for's head and a label off a jump", () => {
    assert.deepEqual(codes("for (let i = 0; i < 3; setN(i)) {}"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("for (const i = 0; i < 3;) {}"), [DiagnosticCode.UnsupportedStatement]);
    assert.ok(codes("outer: while (true) { break outer; }").length > 0);
    assert.deepEqual(codes("break;"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("scopes a for's lets to the loop", () => {
    assert.ok(codes("for (let i = 0; i < 3; i++) {} setN(i);").length > 0, "i is not declared after the loop");
  });
});

void Entity;
