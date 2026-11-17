/**
 * Imports in component files: components across files, the mandatory imports from the authoring module, and types imported
 * from a plain .ts file. Plain functions imported from a .ts file are in plainfunctions.test.ts.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { Entity, World } from "@tsengine/runtime";

import { DiagnosticCode, AUTHORING_HOOKS } from "../src/index.ts";
import {
  cleanOutput,
  closeCompiler,
  compile,
  compileErrors,
  compileProject,
  compileProjectErrors,
  loadProject,
  typeCheck,
  typeCheckProject,
  elementOf,
  getCompiler,
} from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("components across files", () => {
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
  const s = useMutable({ health: 100 });
  return (
    <Entity name="Player">
      {s.health < 25 && <WarningIcon />}
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

  it("type-check fails when the imported component does not exist", () => {
    const project = compileProject({ "Other.tsx": WARNING.replace("WarningIcon", "Other"), "Player.tsx": PLAYER });
    assert.ok(typeCheckProject(project).length > 0);
  });

  it("runs: the imported component is a persistent child, the conditional one appears when state flips", async () => {
    const project = compileProject({ "WarningIcon.tsx": WARNING, "Player.tsx": PLAYER });
    const { Player } = await loadProject<{ Player: new () => Entity & { s: { [field: string]: unknown } } }>(project, "Player.tsx");
    const world = new World();
    const player = new Player();
    world.mount(player);
    assert.equal(player.children.length, 1);
    assert.equal(player.children[0]!.constructor.name, "WarningIcon");
    player.s.health = 10;
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
      "P.tsx": `import { Entity, Sprite as _S } from "@tsengine/runtime/jsx";\nimport { Entity } from "./Entity.tsx";\nfunction P() { return <Entity name="P" />; }`,
    });
    assert.ok(local.some((d) => d.code === DiagnosticCode.DuplicateComponent));
    const dup = compileProjectErrors({
      "P.tsx": `import { P } from "./Q.tsx";\nfunction P() { return <Entity name="P" />; }`,
    });
    assert.ok(dup.some((d) => d.code === DiagnosticCode.DuplicateComponent));
  });

  it("still reports an unimported component as unknown", () => {
    const unknown = compileProjectErrors({ "P.tsx": `function P() { return <Entity name="P"><WarningIcon /></Entity>; }` });
    assert.deepEqual(
      unknown.map((d) => d.code),
      [DiagnosticCode.UnknownComponent]
    );
  });

  it("rejects imports it would otherwise drop silently", () => {
    for (const source of [
      `import { useState } from "react";`,
      `import "./style.css";`,
      `import * as jsx from "@tsengine/runtime/jsx";`,
      `import jsx from "@tsengine/runtime/jsx";`,
      `import { useState as state } from "@tsengine/runtime/jsx";`,
      `import type { useState } from "@tsengine/runtime/jsx";`,
    ]) {
      const codes = compileErrors(
        `import { Entity } from "@tsengine/runtime/jsx";\n${source}\nfunction S() { return <Entity name="S" />; }`
      ).map((d) => d.code);
      assert.deepEqual(codes, [DiagnosticCode.UnsupportedSyntax], source);
    }
  });

  it("treats a relative .ts import named like a hook as the game state, so it says what to import instead; any other name is a plain function", () => {
    const [d] = compileErrors(
      `import { Entity } from "@tsengine/runtime/jsx";\nimport { useHelper } from "./helper.ts";\nfunction S() { return <Entity name="S" />; }`
    );
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /no game state to import `useHelper` from/);
    assert.ok(
      getCompiler().compile(
        "S.tsx",
        `import { Entity } from "@tsengine/runtime/jsx";\nimport { helper } from "./helper.ts";\nfunction S() { return <Entity name="S" x={helper(1)} />; }`
      ).ok
    );
  });

  it("accepts `type` only on the authoring module's types, and requires it there", () => {
    const wrap = (specifier: string) =>
      `import { Entity, ${specifier} } from "@tsengine/runtime/jsx";\nfunction S() { return <Entity name="S" />; }`;
    assert.ok(getCompiler().compile("S.tsx", wrap("type Child")).ok);
    assert.deepEqual(
      getCompiler()
        .compile("S.tsx", wrap("type useState"))
        .diagnostics.map((d) => d.code),
      [DiagnosticCode.UnknownImport],
      "a value cannot be imported as a type"
    );
    const value = getCompiler().compile("S.tsx", wrap("Child"));
    assert.deepEqual(
      value.diagnostics.map((d) => d.code),
      [DiagnosticCode.UnknownImport]
    );
    assert.match(value.diagnostics[0]!.message, /import \{ type Child \}/);
  });

  it("accepts the authoring module's hooks, built-ins and functions, and leaves no trace of the import in the output", () => {
    const { code } = compile(
      `import { useMutable, useUpdate, clamp, Entity, Sprite } from "@tsengine/runtime/jsx";
function S() {
  const s = useMutable({ n: 0 });
  useUpdate((dt) => { s.n = clamp(s.n + dt, 0, 10); });
  return <Entity name="S"><Sprite image="a.png" /></Entity>;
}`,
      "S.tsx"
    );
    assert.doesNotMatch(code, /tse\/runtime\/jsx/);
    assert.match(code, /import \{ Entity, Sprite, clamp \} from "@tsengine\/runtime";/);
  });

  it("rejects names the authoring module does not export", () => {
    const result = compileErrors(
      `import { useState, useTransform, Nope, Entity } from "@tsengine/runtime/jsx";\nfunction S() { return <Entity name="S" />; }`
    );
    assert.deepEqual(
      result.map((d) => d.code),
      [DiagnosticCode.UnknownImport, DiagnosticCode.UnknownImport, DiagnosticCode.UnknownImport]
    );
    assert.match(result[0]!.message, /^`useState` is replaced by `useMutable`/, "a hook that was replaced says what replaced it");
    assert.match(result[1]!.message, /'useTransform' is not exported/);
  });
});

describe("imports are mandatory", () => {
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

describe("types imported from a .ts file", () => {
  it("are imported by the generated module as types, renamed or not, when it uses them", async () => {
    const project = compileProject({
      "Card.tsx": `
import type { Tower as TowerData } from "./rules.ts";
import { type Kind } from "./rules.ts";
interface CardProps { tower: TowerData | null; kind: Kind; }
export function Card({ tower, kind }: CardProps) {
  return <Entity>{tower !== null && <Text size={8}>{\`\${kind} \${tower.level}\`}</Text>}</Entity>;
}`,
    });
    const code = project["Card.tsx"]!.code;
    assert.match(code, /import type \{ Tower as TowerData, Kind \} from "\.\.\/rules\.ts";/);
  });
});
