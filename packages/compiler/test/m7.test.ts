import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
/**
 * M7: authoring types. Component source imports hooks and built-in elements
 * from `@tsengine/runtime/jsx`; the TypeScript checker then type-checks the TSX
 * itself (wrong props, bad hook arguments, undefined names).
 */
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Transform, runtimeManifest } from "@tsengine/runtime";
import * as authoring from "@tsengine/runtime/jsx";

import { LIBRARY_HOOKS } from "../src/hooks/library.ts";
import { TIMER_FUNCTIONS, AUTHORING_HOOKS, DiagnosticCode, TRANSFORM_FIELDS } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, compile, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

let counter = 0;

/** Type-check authored TSX (inside the repo, so `@tsengine/runtime/jsx` resolves). */
function checkSource(source: string): { code: string; message: string }[] {
  const fileName = join(OUTPUT_ROOT, `m7-${process.pid}`, `${++counter}`, "Source.tsx");
  return getCompiler()
    .typeCheckSources([{ fileName, text: source }])
    .map((d) => ({ code: d.code, message: d.message }));
}

const IMPORTS = `import { useMutable, useUpdate, useInput, clamp, Entity, Sprite, Collider } from "@tsengine/runtime/jsx";`;

describe("M7: the authoring module", () => {
  it("exports exactly the hooks, built-in elements and functions the compiler accepts, and the engine's own custom hooks", () => {
    const expected = [
      ...runtimeManifest.intrinsics,
      ...AUTHORING_HOOKS,
      ...Object.keys(runtimeManifest.functions),
      ...LIBRARY_HOOKS,
      ...Object.keys(TIMER_FUNCTIONS),
    ].sort();
    assert.deepEqual(Object.keys(authoring).sort(), expected);
  });

  it("derives transform props from the runtime's Transform, so they cannot drift from the compiler", () => {
    assert.deepEqual(Object.keys(new Transform()).sort(), [...TRANSFORM_FIELDS].sort());
  });

  it("is compile-time only: calling a declaration throws", () => {
    assert.throws(() => authoring.useMutable({ n: 0 }), /compile-time declaration/);
  });
});

describe("M7: type-checking authored TSX", () => {
  it("accepts a component that uses every hook, built-in and a transform", () => {
    const source = `${IMPORTS}
function Hero() {
  const s = useMutable({ health: 100, title: "hero", alive: (true) as boolean, travelled: 0 });
  useUpdate((dt) => {
    s.health = clamp(s.health - dt, 0, 100);
    s.travelled += dt;
  });
  useInput((input) => {
    if (input.pressed("Space")) s.title = \`hero \${input.pointerX}\`;
  });
  const hurt = s.health < 25;
  return (
    <Entity name={s.title} transform={{ x: s.health > 0 ? 1 : 0, y: 2, rotation: 0.5, scaleX: 1, scaleY: 1, global: false }}>
      <Sprite image={hurt ? "hurt.png" : "ok.png"} transform={{ y: s.health }} />
      {s.alive && <Collider width={16} height={24} onCollisionEnter={(other) => { s.alive = false; }} />}
      {s.alive ? <Sprite image="a.png" /> : null}
    </Entity>
  );
}`;
    assert.deepEqual(checkSource(source), []);
    assert.doesNotThrow(() => compile(source));
  });

  it("types a list field so the in-place forms type-check and a helper that takes `T[]` does not", () => {
    const component = (body: string) => `${IMPORTS}
interface Foe { id: number; hp: number }
function hurt(list: Foe[]) { list[0]!.hp = 0; }
function count(list: readonly Foe[]) { return list.length; }
function Hero() {
  const s = useMutable({ foes: [] as Foe[], hp: [3, 3] as number[], n: 0 });
  useUpdate(() => { ${body} });
  return <Entity name="H" />;
}`;
    const forms =
      "s.foes.push({ id: 1, hp: 2 }); s.foes.splice(0, 1); s.foes.sort((a, b) => a.hp - b.hp); s.foes[0]!.hp -= 1; s.hp[0]! -= 1; s.hp[1] = 5; s.n = count(s.foes) + s.foes.length; s.foes = s.foes.filter((f) => f.hp > 0);";
    assert.deepEqual(checkSource(component(forms)), [], "the forms the compiler turns into a copy");
    const helper = checkSource(component("hurt(s.foes);"));
    assert.equal(helper.length, 1);
    assert.match(JSON.stringify(helper), /MutableList|not assignable/);
  });

  it("types a useMutable field from its initial value, not as a literal", () => {
    assert.deepEqual(
      checkSource(`${IMPORTS}
function C() {
  const st = useMutable({ n: 0, s: "a" });
  st.n = 5;
  st.n += 1;
  st.s = "b";
  return <Entity name={st.s} transform={{ x: st.n }} />;
}`),
      []
    );
  });

  it("reports a wrong prop type, a missing prop and an unknown prop", () => {
    for (const jsx of [`<Sprite image={5} />`, `<Collider width={1} />`, `<Entity nme="typo" />`, `<Sprite image="a.png" frames={3} />`]) {
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

  it("accepts transform and key on a component element, whose props type does not declare them", () => {
    const source = `${IMPORTS}
interface CoinProps { value: number }
function Coin({ value }: CoinProps) { return <Entity name="coin" transform={{ y: value }} />; }
function Level() { return <Entity name="level"><Coin value={1} transform={{ x: 10, global: true }} /></Entity>; }`;
    assert.deepEqual(checkSource(source), []);
    assert.ok(checkSource(source.replace("global: true", `global: "yes"`)).length > 0, "its values are still type-checked");
    assert.ok(
      checkSource(source.replace("<Coin value={1}", "<Coin value={1} nope={2}")).length > 0,
      "other unknown props are still reported"
    );
  });

  it("reports field and ref misuse", () => {
    for (const body of [`s.n = "a";`, `s.nope = 1;`, `r.current = "a";`, `useUpdate((dt) => dt.x);`, `useInput((input) => input.nope);`]) {
      const errors = checkSource(`${IMPORTS}
function C() {
  const s = useMutable({ n: 0, r: 0 });
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
    const unimported = checkSource(`function C() { const s = useMutable({ n: 0 }); return <Entity />; }`);
    assert.ok(unimported.some((e) => /useMutable/.test(e.message)));
  });

  it("accepts a component used from the same file and a component imported from another file", () => {
    assert.deepEqual(
      checkSource(`${IMPORTS}
function Coin() { return <Entity name="coin"><Sprite image="coin.png" /></Entity>; }
function Level() { return <Entity name="level"><Coin /><Coin /></Entity>; }`),
      []
    );
  });
});

describe("M7: imports are mandatory", () => {
  /** Calls the compiler directly, so the test helpers cannot add imports for us. */
  const codes = (source: string) =>
    getCompiler()
      .compile("Raw.tsx", source)
      .diagnostics.map((d) => d.code);
  const messages = (source: string) =>
    getCompiler()
      .compile("Raw.tsx", source)
      .diagnostics.map((d) => d.message);

  it("reports each hook, element and function used without an import, once per name", () => {
    const source = `function C() {
  const s = useMutable({ n: 0, m: 0 });
  useUpdate((dt) => { s.n = clamp(s.n + dt, 0, 10); });
  useUpdate((dt) => { s.m = clamp(s.m + dt, 0, 10); });
  return <Entity name="C"><Sprite image="a.png" /><Sprite image="b.png" /></Entity>;
}`;
    const result = getCompiler().compile("Raw.tsx", source);
    assert.ok(!result.ok);
    assert.ok(result.diagnostics.every((d) => d.code === DiagnosticCode.MissingImport));
    // useUpdate is used twice, Sprite twice: still one report per name, in order of first use.
    assert.deepEqual(
      result.diagnostics.map((d) => /'(\w+)'/.exec(d.message)?.[1]),
      ["useMutable", "useUpdate", "clamp", "Entity", "Sprite"]
    );
  });

  it("names the import line to add", () => {
    const [message] = messages(`function C() { return <Entity name="C" />; }`);
    assert.equal(message, `'Entity' is not imported: add \`import { Entity } from "@tsengine/runtime/jsx"\`.`);
  });

  it("reports a name once per file, however many components use it", () => {
    const source = `function A() { return <Entity name="A" />; }\nfunction B() { return <Entity name="B" />; }`;
    assert.deepEqual(codes(source), [DiagnosticCode.MissingImport]);
  });

  it("is satisfied by importing, and does not ask for globals like Math", () => {
    const source = `import { useMutable, useUpdate, Entity } from "@tsengine/runtime/jsx";
function C() {
  const s = useMutable({ n: 0 });
  useUpdate(() => { s.n = Math.floor(s.n + 1); });
  return <Entity name="C" />;
}`;
    assert.deepEqual(codes(source), []);
  });

  it("checks every hook kind, including the ones that shaped earlier tests", () => {
    for (const hook of ["useMutable", "useUpdate", "useInput"]) {
      const body = hook === "useMutable" ? `const a = useMutable({ n: 0 });` : `${hook}(() => {});`;
      const others = ["Entity", ...AUTHORING_HOOKS.filter((h) => h !== hook)].join(", ");
      const result = codes(`import { ${others} } from "@tsengine/runtime/jsx";\nfunction C() { ${body} return <Entity name="C" />; }`);
      assert.deepEqual(result, [DiagnosticCode.MissingImport], hook);
    }
  });

  it("is a separate error from a name the entry point does not export", () => {
    assert.deepEqual(codes(`import { Entity, Nope } from "@tsengine/runtime/jsx";\nfunction C() { return <Entity name="C" />; }`), [
      DiagnosticCode.UnknownImport,
    ]);
  });
});

describe("M7: the CLI type-checks sources", () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

  /** Writes a one-file project inside the repo (so `@tsengine/runtime/jsx` resolves) and runs the CLI on it. */
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
    assert.match(output, /TSE9002/);
    assert.match(output, /Did you mean 'image'/);
  });

  it("skips the source check with --no-check", () => {
    assert.equal(runCli(COIN(`imag="coin.png"`), "--no-check").status, 0);
  });

  it("fails a source that does not import what it uses, with both the compiler's and TypeScript's error", () => {
    const { status, output } = runCli(`export function Coin() { return <Entity name="coin" />; }`);
    assert.equal(status, 1);
    assert.match(output, /TSE1005: 'Entity' is not imported: add `import \{ Entity \} from "@tsengine\/runtime\/jsx"`/);
    assert.match(output, /TSE9002/);
  });
});
