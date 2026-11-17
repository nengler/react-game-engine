import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
/** Custom hooks: functions named `use…` that are inlined into the component that calls them. */
import { after, describe, it } from "node:test";

import { Entity, World, createInputState } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = `
function useRunner(speed: number, key: string) {
  const s = useMutable({ x: 0, dir: 0 });
  useInput((input) => {
    s.dir = input.down(key) ? 1 : 0;
  });
  useUpdate((dt) => {
    s.x += s.dir * speed * dt;
  });
  const far = s.x > 50;
  return { x: s.x, far };
}

function Pair() {
  const { x: a, far: aFar } = useRunner(100, "ArrowRight");
  const { x: b } = useRunner(10, "ArrowLeft");
  return (
    <Entity name="Pair" x={a} y={b}>
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
         const s = useMutable({ n: 0 });
         useUpdate(() => { s.n += step; });
         return s.n;
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
         return <Entity name="C" x={one} y={two} />;
       }`,
      "Counters.tsx"
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

  it("hand back their own state, a useMutable the caller writes under its own name, one per call; and functions that change it", async () => {
    const compiled = compile(`
function useCounter(start: number) {
  const s = useMutable({ count: start });
  return s;
}
function useNamed() {
  const s = useMutable({ on: false });
  const toggle = () => {
    s.on = !s.on;
  };
  return { on: s.on, toggle };
}
function Two() {
  const a = useCounter(1);
  const b = useCounter(10);
  const { on, toggle } = useNamed();
  useUpdate(() => {
    a.count += 1;
    b.count += 5;
    toggle();
  });
  return <Entity name="Two" x={a.count} y={b.count} z={on ? 1 : 0} />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Two } = await load<{ Two: new () => Entity & { a: { count: number }; b: { count: number } } }>(compiled);
    const world = new World();
    const two = new Two();
    world.mount(two);
    world.tick(0.1);
    assert.deepEqual([two.a.count, two.b.count], [2, 15]);
    assert.deepEqual([two.transform.x, two.transform.y], [2, 15]);
    assert.equal(
      Object.entries(two.saveHotState() ?? {}).find(([key]) => key.endsWith(".on"))?.[1],
      true,
      "toggled by the hook's own function"
    );
  });

  it("write a literal argument into the hook, so a parameter can be a sound's path", () => {
    const compiled = compile(
      `function useBeep(path: string, volume: number, count: number) {
         const play = useSound(path);
         const s = useMutable({ seen: 0 });
         useUpdate(() => { if (count !== s.seen) { s.seen = count; play(volume); } });
       }
       function Hit() { const s = useMutable({ hits: 0 }); useBeep("hit.wav", 0.5, s.hits); return <Entity name="H" />; }`,
      "Hit.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /new Sound\("hit\.wav"\)/);
    assert.match(compiled.code, /\.play\(0\.5\)/);
  });

  it("do not leak: a hook's names cannot clash with the component's own", () => {
    const compiled = compile(
      `function useThing() { const s = useMutable({ x: 1 }); useUpdate(() => { s.x += 1; }); return s.x; }
       function Both() { const s = useMutable({ x: 100 }); const y = useThing(); return <Entity name="B" x={s.x} y={y} />; }`,
      "Both.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    // The hook's mutable is named after the hook (`thing`), so its `x` never meets the component's `s.x`.
    assert.match(compiled.code, /\$thing_x: number = 1;/);
    assert.match(compiled.code, /"Both\.thing\.x"/, "and is saved under that name");
    assert.match(compiled.code, /\$s_x: number = 100;/);
  });

  it("report a hook called where only a component statement may be, and a call that does not match the hook", () => {
    const nested = compileErrors(
      `function useA() { const s = useMutable({ n: 0 }); return s.n; } function C() { const s = useMutable({ on: true }); const v = s.on ? useA() : 0; return <Entity name="C" x={v} />; }`
    );
    assert.match(nested[0]!.message, /must be a statement of the component body/);
    const tooMany = compileErrors(
      `function useA(a: number) { const s = useMutable({ n: a }); return s.n; } function C() { const n = useA(1, 2); return <Entity name="C" x={n} />; }`
    );
    assert.match(tooMany[0]!.message, /takes 1 argument, but the call passes 2/);
    const none = compileErrors(
      `function useA() { useUpdate(() => {}); } function C() { const n = useA(); return <Entity name="C" x={n} />; }`
    );
    assert.match(none[0]!.message, /returns nothing, but its result is used/);
    const unknown = compileErrors(`function C() { useMissing(); return <Entity name="C" />; }`);
    assert.ok(unknown.length > 0, "left to the compiler's own report of a statement it does not understand");
    const shape = compileErrors(`function useA() { return 1; } function C() { const { a } = useA(); return <Entity name="C" />; }`);
    assert.match(shape[0]!.message, /must return an object literal/);
    const recursive = compileErrors(`function useA() { useA(); } function C() { useA(); return <Entity name="C" />; }`);
    assert.match(recursive[0]!.message, /levels deep|recurse/);
  });

  it("keep the rules of a component: a hook that returns a list method's result is the same error it would be inline", () => {
    const found = compileErrors(
      `function useBad() { const s = useMutable({ items: [] as number[] }); useUpdate(() => { const n = s.items.push(1); s.items = [n]; }); } function C() { useBad(); return <Entity name="C" />; }`
    );
    assert.ok(found.length > 0);
  });

  it("work from another .tsx file through the command line, which reads the hook where it is imported from", () => {
    const dir = mkdtempSync(join(tmpdir(), "tse-hooks-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src/hooks.tsx"),
        `import { useMutable, useUpdate } from "@tsengine/runtime/jsx";\nexport function useClock(rate: number) {\n  const s = useMutable({ t: 0 });\n  useUpdate((dt) => { s.t += dt * rate; });\n  return s.t;\n}\n`
      );
      writeFileSync(
        join(dir, "src/Clock.tsx"),
        `import { Entity } from "@tsengine/runtime/jsx";\nimport { useClock } from "./hooks.tsx";\nexport function Clock() {\n  const t = useClock(2);\n  return <Entity name="Clock" x={t} />;\n}\n`
      );
      const repo = resolve(import.meta.dirname, "../../..");
      execFileSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out"), "--no-check"], {
        cwd: repo,
        stdio: "pipe",
      });
      const clock = readFileSync(join(dir, "out/Clock.ts"), "utf8");
      assert.match(clock, /\$clock_t: number = 0;/, "the hook's state is the component's own, named after the hook");
      assert.doesNotMatch(clock, /useClock\(/);
      assert.doesNotMatch(clock, /hooks\.ts/, "the hook's file is not imported at run time");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still type-check as authored source: the author's editor sees an ordinary function", () => {
    const found = getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/H${Math.random()}.tsx`,
        text: `import { Entity, useMutable, useInput, useUpdate } from "@tsengine/runtime/jsx";\n${SOURCE}`,
      },
    ]);
    assert.deepEqual(found, []);
  });
});

describe("custom hooks: the name of a hook's own state", () => {
  it("is the hook's name without `use`, numbered where it is taken, and never a name the component has", () => {
    const compiled = compile(
      `function useThing() { const s = useMutable({ x: 1 }); useUpdate(() => { s.x += 1; }); return s.x; }
       function Twice() { const a = useThing(); const b = useThing(); return <Entity name="T" x={a} y={b} />; }
       function Taken() { const thing = useMutable({ n: 0 }); const a = useThing(); return <Entity name="K" x={a + thing.n} />; }`,
      "Names.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /\$thing_x: number = 1;/);
    assert.match(compiled.code, /\$thing2_x: number = 1;/, "a second call of the same hook");
    assert.match(compiled.code, /\$thing_n: number = 0;[^]*\$thing2_x/, "and one the component already has");
  });

  it("is the call's own name where the hook returns it, and falls back to a prefix where the hook's name is a keyword", () => {
    const compiled = compile(
      `function useCounter() { const s = useMutable({ n: 0 }); return s; }
       function useDefault() { const s = useMutable({ n: 0 }); useUpdate(() => { s.n += 1; }); return s.n; }
       function C() { const counter = useCounter(); const d = useDefault(); return <Entity name="C" x={counter.n + d} />; }`,
      "Names2.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /\$counter_n: number = 0;/);
    assert.match(compiled.code, /\$_useDefault\d_s_n: number = 0;/);
  });
});
