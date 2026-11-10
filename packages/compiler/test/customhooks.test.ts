/** Custom hooks: functions named `use…` that are inlined into the component that calls them. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Entity, World, createInputState } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
function useRunner(speed: number, key: string) {
  const [x, setX] = useState(0);
  const dir = useRef(0);
  useInput((input) => {
    dir.current = input.down(key) ? 1 : 0;
  });
  useUpdate((dt) => {
    setX((x) => x + dir.current * speed * dt);
  });
  const far = x > 50;
  return { x, far };
}

function Pair() {
  const { x: a, far: aFar } = useRunner(100, "ArrowRight");
  const { x: b } = useRunner(10, "ArrowLeft");
  return (
    <Entity name="Pair" transform={{ x: a, y: b }}>
      {aFar && <Entity name="far" />}
    </Entity>
  );
}
`;

describe("custom hooks", () => {
  it("are inlined: the component has the hook's state, ref and handlers written out, once for each call", async () => {
    const compiled = compile(SOURCE, "Pair.tsx");
    assert.deepEqual(typeCheck(compiled), [], "the generated code type-checks");
    assert.doesNotMatch(compiled.code, /useRunner\(/, "the hook is never called at run time");
    const { Pair } = await load<{ Pair: new () => Entity }>(compiled);
    const world = new World();
    const pair = new Pair();
    world.mount(pair);
    // Two calls made two separate states, each with its own speed and key.
    world.tick(0.1, createInputState({ down: ["ArrowRight", "ArrowLeft"] }));
    assert.deepEqual([pair.transform.x, pair.transform.y], [10, 1]);
    world.tick(0.1, createInputState({ down: ["ArrowRight"] }));
    assert.deepEqual([pair.transform.x, pair.transform.y], [20, 1]);
    for (let i = 0; i < 4; i++) world.tick(0.1, createInputState({ down: ["ArrowRight"] }));
    assert.equal(pair.children.length, 1, "the derived `far` the hook returned shows the child once x passes 50");
  });

  it("can be used without a result, take a default for a parameter left out, and call other hooks", async () => {
    const compiled = compile(
      `function useCounter(step = 2) {
         const [n, setN] = useState(0);
         useUpdate(() => { setN((n) => n + step); });
         return n;
       }
       function useDoubleCounter() {
         const one = useCounter();
         const two = useCounter(5);
         return [one, two];
       }
       function usePing() {
         const play = useSound("ping.wav");
         useMount(() => { play(); });
       }
       function Counters() {
         const [one, two] = useDoubleCounter();
         usePing();
         return <Entity name="C" transform={{ x: one, y: two }} />;
       }`,
      "Counters.tsx",
    );
    assert.deepEqual(typeCheck(compiled), []);
    const { Counters } = await load<{ Counters: new () => Entity }>(compiled);
    const world = new World();
    const c = new Counters();
    world.mount(c);
    world.tick(0.1);
    world.tick(0.1);
    assert.deepEqual([c.transform.x, c.transform.y], [4, 10], "the first counter steps by its default of 2, the second by 5");
  });

  it("write a literal argument into the hook, so a parameter can be a sound's path", () => {
    const compiled = compile(
      `function useBeep(path: string, volume: number, count: number) {
         const play = useSound(path);
         const seen = useRef(0);
         useUpdate(() => { if (count !== seen.current) { seen.current = count; play(volume); } });
       }
       function Hit() { const [hits] = useState(0); useBeep("hit.wav", 0.5, hits); return <Entity name="H" />; }`,
      "Hit.tsx",
    );
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /new Sound\("hit\.wav"\)/);
    assert.match(compiled.code, /\.play\(0\.5\)/);
  });

  it("do not leak: a hook's names cannot clash with the component's own", () => {
    const compiled = compile(
      `function useThing() { const [x, setX] = useState(1); useUpdate(() => { setX((x) => x + 1); }); return x; }
       function Both() { const [x] = useState(100); const y = useThing(); return <Entity name="B" transform={{ x, y }} />; }`,
      "Both.tsx",
    );
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /_useThing1_x: number = 1;/);
    assert.match(compiled.code, /\bx: number = 100;/);
  });

  it("report a hook called where only a component statement may be, and a call that does not match the hook", () => {
    const nested = compileErrors(`function useA() { const [n] = useState(0); return n; } function C() { const [on] = useState(true); const v = on ? useA() : 0; return <Entity name="C" transform={{ x: v }} />; }`);
    assert.match(nested[0]!.message, /must be a statement of the component body/);
    const tooMany = compileErrors(`function useA(a: number) { const [n] = useState(a); return n; } function C() { const n = useA(1, 2); return <Entity name="C" transform={{ x: n }} />; }`);
    assert.match(tooMany[0]!.message, /takes 1 argument, but the call passes 2/);
    const none = compileErrors(`function useA() { useUpdate(() => {}); } function C() { const n = useA(); return <Entity name="C" transform={{ x: n }} />; }`);
    assert.match(none[0]!.message, /returns nothing, but its result is used/);
    const unknown = compileErrors(`function C() { useMissing(); return <Entity name="C" />; }`);
    assert.ok(unknown.length > 0, "left to the compiler's own report of a statement it does not understand");
    const shape = compileErrors(`function useA() { return 1; } function C() { const { a } = useA(); return <Entity name="C" />; }`);
    assert.match(shape[0]!.message, /must return an object literal/);
    const recursive = compileErrors(`function useA() { useA(); } function C() { useA(); return <Entity name="C" />; }`);
    assert.match(recursive[0]!.message, /levels deep|recurse/);
  });

  it("keep the rules of a component: a hook that mutates state in place is the same error it would be inline", () => {
    const found = compileErrors(`function useBad() { const [items] = useState<number[]>([]); useUpdate(() => { items.push(1); }); } function C() { useBad(); return <Entity name="C" />; }`);
    assert.ok(found.length > 0);
  });

  it("work from another .tsx file through the command line, which reads the hook where it is imported from", () => {
    const dir = mkdtempSync(join(tmpdir(), "rge-hooks-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src/hooks.tsx"), `import { useState, useUpdate } from "@rge/runtime/jsx";\nexport function useClock(rate: number) {\n  const [t, setT] = useState(0);\n  useUpdate((dt) => { setT((t) => t + dt * rate); });\n  return t;\n}\n`);
      writeFileSync(join(dir, "src/Clock.tsx"), `import { Entity } from "@rge/runtime/jsx";\nimport { useClock } from "./hooks.tsx";\nexport function Clock() {\n  const t = useClock(2);\n  return <Entity name="Clock" transform={{ x: t }} />;\n}\n`);
      const repo = resolve(import.meta.dirname, "../../..");
      execFileSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out"), "--no-check"], { cwd: repo, stdio: "pipe" });
      const clock = readFileSync(join(dir, "out/Clock.ts"), "utf8");
      assert.match(clock, /_useClock1_t/);
      assert.doesNotMatch(clock, /useClock\(/);
      assert.doesNotMatch(clock, /hooks\.ts/, "the hook's file is not imported at run time");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still type-check as authored source: the author's editor sees an ordinary function", () => {
    const found = getCompiler().typeCheckSources([
      { fileName: `${process.cwd()}/.test-output/H${Math.random()}.tsx`, text: `import { Entity, useState } from "@rge/runtime/jsx";\n${SOURCE.replace("function useRunner", "function useRunner")}`.replace(`import { Entity, useState }`, `import { Entity, useState, useRef, useInput, useUpdate }`) },
    ]);
    assert.deepEqual(found, []);
  });
});
