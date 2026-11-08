/**
 * M7: authoring types. Component source imports hooks and built-in elements
 * from `@rge/runtime/jsx`; the TypeScript checker then type-checks the TSX
 * itself (wrong props, bad hook arguments, undefined names).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as authoring from "@rge/runtime/jsx";
import { Transform, runtimeManifest } from "@rge/runtime";
import { AUTHORING_HOOKS, DiagnosticCode, TRANSFORM_FIELDS } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, compile, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

let counter = 0;

/** Type-check authored TSX (inside the repo, so `@rge/runtime/jsx` resolves). */
function checkSource(source: string): { code: string; message: string }[] {
  const fileName = join(OUTPUT_ROOT, `m7-${process.pid}`, `${++counter}`, "Source.tsx");
  return getCompiler()
    .typeCheckSources([{ fileName, text: source }])
    .map((d) => ({ code: d.code, message: d.message }));
}

const IMPORTS = `import { useState, useRef, useUpdate, useInput, onCollisionEnter, clamp, Entity, Sprite, Collider } from "@rge/runtime/jsx";`;

describe("M7: the authoring module", () => {
  it("exports exactly the hooks, built-in elements and functions the compiler accepts", () => {
    const expected = [...runtimeManifest.intrinsics, ...AUTHORING_HOOKS, ...Object.keys(runtimeManifest.functions)].sort();
    assert.deepEqual(Object.keys(authoring).sort(), expected);
  });

  it("derives transform props from the runtime's Transform, so they cannot drift from the compiler", () => {
    assert.deepEqual(Object.keys(new Transform()).sort(), [...TRANSFORM_FIELDS].sort());
  });

  it("is compile-time only: calling a declaration throws", () => {
    assert.throws(() => authoring.useState(0), /compile-time declaration/);
  });
});

describe("M7: type-checking authored TSX", () => {
  it("accepts a component that uses every hook, built-in and a transform", () => {
    const source = `${IMPORTS}
function Hero() {
  const [health, setHealth] = useState(100);
  const [title, setTitle] = useState("hero");
  const [alive, setAlive] = useState<boolean>(true);
  const travelled = useRef(0);
  useUpdate((dt) => {
    setHealth((health) => clamp(health - dt, 0, 100));
    travelled.current += dt;
  });
  useInput((input) => {
    if (input.pressed("Space")) setTitle(\`hero \${input.pointerX}\`);
  });
  onCollisionEnter(() => setAlive(false));
  const hurt = health < 25;
  return (
    <Entity name={title} transform={{ x: health > 0 ? 1 : 0, y: 2, rotation: 0.5, scaleX: 1, scaleY: 1, global: false }}>
      <Sprite image={hurt ? "hurt.png" : "ok.png"} transform={{ y: health }} />
      {alive && <Collider width={16} height={24} />}
      {alive ? <Sprite image="a.png" /> : null}
    </Entity>
  );
}`;
    assert.deepEqual(checkSource(source), []);
    assert.doesNotThrow(() => compile(source));
  });

  it("types useState from its initial value, not as a literal", () => {
    assert.deepEqual(
      checkSource(`${IMPORTS}
function C() {
  const [n, setN] = useState(0);
  const [s, setS] = useState("a");
  setN(5);
  setN((n) => n + 1);
  setS("b");
  return <Entity name={s} transform={{ x: n }} />;
}`),
      [],
    );
  });

  it("reports a wrong prop type, a missing prop and an unknown prop", () => {
    for (const jsx of [
      `<Sprite image={5} />`,
      `<Collider width={1} />`,
      `<Entity nme="typo" />`,
      `<Sprite image="a.png" frames={3} />`,
    ]) {
      const errors = checkSource(`${IMPORTS}\nfunction C() { return <Entity>${jsx}</Entity>; }`);
      assert.ok(errors.length > 0 && errors.every((e) => e.code === DiagnosticCode.SourceTypeError), jsx);
    }
  });

  it("reports bad transform values and fields", () => {
    for (const transform of [`{{ x: "1" }}`, `{{ z: 1 }}`, `{{ global: 1 }}`, `{{ rotation: true }}`, `"x"`]) {
      const errors = checkSource(`${IMPORTS}\nfunction C() { return <Entity transform={${transform}} />; }`);
      assert.ok(errors.length > 0, transform);
    }
  });

  it("reports setter and ref misuse", () => {
    for (const body of [`setN("a");`, `setN((n) => n + "a");`, `r.current = "a";`, `useUpdate((dt) => dt.x);`, `useInput((input) => input.nope);`]) {
      const errors = checkSource(`${IMPORTS}
function C() {
  const [n, setN] = useState(0);
  const r = useRef(0);
  ${body}
  return <Entity />;
}`);
      assert.ok(errors.length > 0, body);
    }
  });

  it("reports a built-in that takes no children, lowercase tags and undefined names", () => {
    const wrap = (jsx: string) => `${IMPORTS}\nfunction C() { return <Entity>${jsx}</Entity>; }`;
    assert.ok(checkSource(wrap(`<Sprite image="a"><Entity /></Sprite>`)).length > 0);
    assert.ok(checkSource(wrap(`<div />`)).length > 0);
    // Not imported: an editor reports it, and so does the checker.
    const unimported = checkSource(`function C() { const [n] = useState(0); return <Entity />; }`);
    assert.ok(unimported.some((e) => /useState/.test(e.message)));
  });

  it("accepts a component used from the same file and a component imported from another file", () => {
    assert.deepEqual(
      checkSource(`${IMPORTS}
function Coin() { return <Entity name="coin"><Sprite image="coin.png" /></Entity>; }
function Level() { return <Entity name="level"><Coin /><Coin /></Entity>; }`),
      [],
    );
  });
});

describe("M7: the CLI type-checks sources", () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

  /** Writes a one-file project inside the repo (so `@rge/runtime/jsx` resolves) and runs the CLI on it. */
  function runCli(source: string, ...flags: string[]) {
    const dir = join(OUTPUT_ROOT, `m7-cli-${process.pid}`, String(++counter));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "Coin.tsx"), source);
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), ...flags], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  const COIN = (props: string) => `${IMPORTS}
export function Coin() {
  return <Entity name="coin"><Sprite ${props} /></Entity>;
}`;

  it("compiles a project whose sources type-check", () => {
    const { status, output } = runCli(COIN(`image="coin.png"`));
    assert.equal(status, 0, output);
  });

  it("fails with a source type error before anything is generated wrongly", () => {
    const { status, output } = runCli(COIN(`imag="coin.png"`));
    assert.equal(status, 1);
    assert.match(output, /RGE9002/);
    assert.match(output, /Did you mean 'image'/);
  });

  it("skips the source check with --no-check", () => {
    assert.equal(runCli(COIN(`imag="coin.png"`), "--no-check").status, 0);
  });
});
