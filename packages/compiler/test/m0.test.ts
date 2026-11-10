/** M0 hardening: nested conditional commit, runtime manifest as config, components across files. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, World, runtimeManifest } from "@rge/runtime";
import { Compiler, DiagnosticCode } from "../src/index.ts";
import {
  cleanOutput, closeCompiler, compile, compileErrors, compileProject, compileProjectErrors, load, loadProject, typeCheck, typeCheckProject, withAuthoringImports, elementOf, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("M0: nested conditionals commit without a World", () => {
  const NESTED = `
function Nested() {
  const [outer, setOuter] = useState(true);
  const [inner, setInner] = useState(true);
  return (
    <Entity name="Nested">
      {outer && (
        <Entity name="Outer">
          {inner && <Sprite image="deep.png" />}
        </Entity>
      )}
    </Entity>
  );
}`;

  it("attaches the full subtree of a freshly constructed object", async () => {
    const { Nested } = await load<{ Nested: new () => Entity }>(compile(NESTED, "Nested.tsx"));
    const nested = new Nested();
    assert.equal(nested.children.length, 1);
    const outer = nested.children[0]!;
    assert.equal(outer.children.length, 1);
    assert.ok(outer.children[0] instanceof Sprite);
    assert.equal(nested.hasPendingStructure, false);
    assert.equal(outer.hasPendingStructure, false);
  });

  it("still settles correctly inside a World when state flips later", async () => {
    const mod = await load<{ Nested: new () => Entity & { setOuter(v: boolean): void; setInner(v: boolean): void } }>(
      compile(NESTED, "Nested.tsx"),
    );
    const world = new World();
    const nested = new mod.Nested();
    world.mount(nested);
    nested.setInner(false);
    world.flush();
    assert.equal(nested.children[0]!.children.length, 0);
    nested.setOuter(false);
    world.flush();
    assert.equal(nested.children.length, 0);
    nested.setOuter(true);
    nested.setInner(true);
    world.flush();
    assert.equal(nested.children[0]!.children.length, 1);
  });
});

describe("M0: runtime manifest as compiler config", () => {
  const LIGHT = `
function Lamp() {
  return (
    <Entity name="Lamp">
      <Light radius={4} />
    </Entity>
  );
}`;

  it("rejects an intrinsic the manifest does not list", () => {
    const compiler = new Compiler();
    try {
      const result = compiler.compile("Lamp.tsx", withAuthoringImports(LIGHT));
      assert.deepEqual(result.diagnostics.map((d) => d.code), [DiagnosticCode.UnknownComponent]);
    } finally {
      compiler.close();
    }
  });

  it("accepts a new intrinsic with no compiler edit", () => {
    const manifest = { ...runtimeManifest, intrinsics: [...runtimeManifest.intrinsics, "Light"] };
    const compiler = new Compiler({ manifest });
    try {
      const result = compiler.compile("Lamp.tsx", withAuthoringImports(LIGHT, manifest));
      assert.ok(result.ok);
      assert.match(result.code, /import \{ Entity, Light \} from "@rge\/runtime";/);
      assert.match(result.code, /new Light\(\{ radius: 4 \}\)/);
    } finally {
      compiler.close();
    }
  });

  it("reserves the manifest's member names for generated state", () => {
    const compiler = new Compiler();
    try {
      const result = compiler.compile("Bad.tsx", withAuthoringImports(`
function Bad() {
  const [render, setRender] = useState(0);
  return <Entity name="Bad" />;
}`));
      assert.deepEqual(result.diagnostics.map((d) => d.code), [DiagnosticCode.InvalidUseState]);
    } finally {
      compiler.close();
    }
  });

  it("takes the reserved names, host intrinsic and functions from the manifest it is given", () => {
    const manifest = { ...runtimeManifest, reservedMembers: [...runtimeManifest.reservedMembers, "score"], functions: { clamp: 3, wrap: 2 } };
    const compiler = new Compiler({ manifest });
    try {
      const reserved = compiler.compile("R.tsx", withAuthoringImports(`
function R() {
  const [score, setScore] = useState(0);
  return <Entity name="R" />;
}`, manifest));
      assert.deepEqual(reserved.diagnostics.map((d) => d.code), [DiagnosticCode.InvalidUseState]);
      const calls = compiler.compile("W.tsx", withAuthoringImports(`
function W() {
  const [n, setN] = useState(0);
  useUpdate(() => setN(wrap(n, 10)));
  return <Entity name="W" />;
}`, manifest));
      assert.ok(calls.ok);
      assert.match(calls.code, /import \{ Entity, wrap \} from "@rge\/runtime";/);
    } finally {
      compiler.close();
    }
  });
});

describe("M0: components across files", () => {
  const WARNING = `
export function WarningIcon() {
  return (
    <Entity name="Warning">
      <Sprite image="warning.png" />
    </Entity>
  );
}`;
  const PLAYER = `
import { WarningIcon } from "./WarningIcon.tsx";

function Player() {
  const [health, setHealth] = useState(100);
  return (
    <Entity name="Player">
      {health < 25 && <WarningIcon />}
      <WarningIcon />
    </Entity>
  );
}`;

  it("lowers an imported component to an Imported ref", () => {
    const project = compileProject({ "WarningIcon.tsx": WARNING, "Player.tsx": PLAYER });
    const player = project["Player.tsx"]!.ir.components[0]!;
    const refs = player.root.children.map((c) => elementOf(c).component);
    assert.deepEqual(refs, [
      { kind: "Imported", name: "WarningIcon", module: "./WarningIcon.tsx", isDefault: false },
      { kind: "Imported", name: "WarningIcon", module: "./WarningIcon.tsx", isDefault: false },
    ]);
  });

  it("rewrites the specifier to the generated .ts and imports each name once", () => {
    const project = compileProject({ "WarningIcon.tsx": WARNING, "Player.tsx": PLAYER });
    const { code } = project["Player.tsx"]!;
    assert.equal(code.match(/from "\.\/WarningIcon\.ts"/g)?.length, 1);
    assert.match(code, /import \{ WarningIcon \} from "\.\/WarningIcon\.ts";/);
    assert.match(code, /new WarningIcon\(\)/);
  });

  it("type-checks across both generated files", () => {
    const project = compileProject({ "WarningIcon.tsx": WARNING, "Player.tsx": PLAYER });
    assert.deepEqual(typeCheckProject(project), []);
  });

  it("type-check fails when the imported component does not exist", () => {
    const project = compileProject({ "Other.tsx": WARNING.replace("WarningIcon", "Other"), "Player.tsx": PLAYER });
    assert.ok(typeCheckProject(project).length > 0);
  });

  it("runs: the imported component is a persistent child, the conditional one appears when state flips", async () => {
    const project = compileProject({ "WarningIcon.tsx": WARNING, "Player.tsx": PLAYER });
    const { Player } = await loadProject<{ Player: new () => Entity & { setHealth(v: number): void } }>(project, "Player.tsx");
    const world = new World();
    const player = new Player();
    world.mount(player);
    assert.equal(player.children.length, 1);
    assert.equal(player.children[0]!.constructor.name, "WarningIcon");
    player.setHealth(10);
    world.flush();
    assert.equal(player.children.length, 2);
  });

  it("generated single-file output is unchanged when nothing is imported", () => {
    const { code } = compile(WARNING, "Solo.tsx");
    assert.doesNotMatch(code, /import \{[^}]*\} from "\.\//);
    assert.deepEqual(typeCheck(compile(WARNING, "Solo.tsx")), []);
  });

  it("rejects namespace, aliased and type-only component imports", () => {
    const body = `function P() { return <Entity name="P"><WarningIcon /></Entity>; }`;
    for (const imp of [
      `import * as W from "./WarningIcon.tsx";`,
      `import { WarningIcon as W } from "./WarningIcon.tsx";`,
      `import { type WarningIcon } from "./WarningIcon.tsx";`,
    ]) {
      const codes = compileProjectErrors({ "P.tsx": `${imp}\n${body}` }).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.UnsupportedSyntax), imp);
    }
  });

  it("rejects an import that collides with an intrinsic or a local component", () => {
    const local = compileProjectErrors({
      "P.tsx": `import { Sprite } from "./Sprite.tsx";\nfunction P() { return <Entity name="P" />; }`,
    });
    assert.ok(local.some((d) => d.code === DiagnosticCode.DuplicateComponent));
    const dup = compileProjectErrors({
      "P.tsx": `import { P } from "./Q.tsx";\nfunction P() { return <Entity name="P" />; }`,
    });
    assert.ok(dup.some((d) => d.code === DiagnosticCode.DuplicateComponent));
  });

  it("still reports an unimported component as unknown", () => {
    const unknown = compileProjectErrors({ "P.tsx": `function P() { return <Entity name="P"><WarningIcon /></Entity>; }` });
    assert.deepEqual(unknown.map((d) => d.code), [DiagnosticCode.UnknownComponent]);
  });

  it("rejects imports it would otherwise drop silently", () => {
    for (const source of [
      `import { useState } from "react";`,
      `import "./style.css";`,
      `import * as jsx from "@rge/runtime/jsx";`,
      `import jsx from "@rge/runtime/jsx";`,
      `import { useState as state } from "@rge/runtime/jsx";`,
      `import type { useState } from "@rge/runtime/jsx";`,
    ]) {
      const codes = compileErrors(`import { Entity } from "@rge/runtime/jsx";\n${source}\nfunction S() { return <Entity name="S" />; }`).map((d) => d.code);
      assert.deepEqual(codes, [DiagnosticCode.UnsupportedSyntax], source);
    }
  });

  it("treats a relative .ts import named like a hook as the game state, so it says what to import instead; any other name is a plain function", () => {
    const [d] = compileErrors(`import { Entity } from "@rge/runtime/jsx";\nimport { useHelper } from "./helper.ts";\nfunction S() { return <Entity name="S" />; }`);
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /no game state to import `useHelper` from/);
    assert.ok(getCompiler().compile("S.tsx", `import { Entity } from "@rge/runtime/jsx";\nimport { helper } from "./helper.ts";\nfunction S() { return <Entity name="S" transform={{ x: helper(1) }} />; }`).ok);
  });

  it("accepts `type` only on the authoring module's types, and requires it there", () => {
    const wrap = (specifier: string) => `import { Entity, ${specifier} } from "@rge/runtime/jsx";\nfunction S() { return <Entity name="S" />; }`;
    assert.ok(getCompiler().compile("S.tsx", wrap("type Child")).ok);
    assert.deepEqual(getCompiler().compile("S.tsx", wrap("type useState")).diagnostics.map((d) => d.code), [DiagnosticCode.UnknownImport], "a value cannot be imported as a type");
    const value = getCompiler().compile("S.tsx", wrap("Child"));
    assert.deepEqual(value.diagnostics.map((d) => d.code), [DiagnosticCode.UnknownImport]);
    assert.match(value.diagnostics[0]!.message, /import \{ type Child \}/);
  });

  it("accepts the authoring module's hooks, built-ins and functions, and leaves no trace of the import in the output", () => {
    const { code } = compile(`import { useState, useUpdate, clamp, Entity, Sprite } from "@rge/runtime/jsx";
function S() {
  const [n, setN] = useState(0);
  useUpdate((dt) => setN((n) => clamp(n + dt, 0, 10)));
  return <Entity name="S"><Sprite image="a.png" /></Entity>;
}`, "S.tsx");
    assert.doesNotMatch(code, /rge\/runtime\/jsx/);
    assert.match(code, /import \{ Entity, Sprite, clamp \} from "@rge\/runtime";/);
  });

  it("rejects names the authoring module does not export", () => {
    const result = compileErrors(`import { useState, useTransform, Nope, Entity } from "@rge/runtime/jsx";\nfunction S() { return <Entity name="S" />; }`);
    assert.deepEqual(result.map((d) => d.code), [DiagnosticCode.UnknownImport, DiagnosticCode.UnknownImport]);
    assert.match(result[0]!.message, /'useTransform' is not exported/);
  });
});
