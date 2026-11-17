/**
 * Prefabs and scenes. An exported component is a prefab: the compiler emits a registry and a data schema; a scene (JSON, or a
 * Tiled map: tilemap.test.ts) places prefabs by name; `loadScene` builds the objects. A scene loaded from data must give the
 * same tree as the TSX that composes the same components. The CLI's `--scenes` is in cli.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, GameObject, Sprite, World, loadScene, type PrefabRegistry, type Scene } from "@tsengine/runtime";

import {
  DiagnosticCode,
  checkProject,
  constantValue,
  prefabsIndexSource,
  prefabsJson,
  projectSchemas,
  type CompilerDiagnostic,
  type ExprIR,
  type ProjectModule,
} from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileProject, getCompiler, load, sameOrder, typeCheck } from "./helpers.ts";
import { WORLD } from "./scene-fixture.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

interface WorldModule {
  prefabs: PrefabRegistry;
  Level: new () => Entity;
}

let compiled: ReturnType<typeof compile>;
let world: WorldModule;

before(async () => {
  compiled = compile(WORLD, "World.tsx");
  world = await load<WorldModule>(compiled);
});

const project = (): ProjectModule[] => [{ ir: compiled.ir, generatedName: "World.ts" }];

describe("the prefab registry", () => {
  it("lists the exported components, not the private ones", () => {
    assert.deepEqual(Object.keys(world.prefabs).sort(), ["Enemy", "Frame", "Level", "Marker", "Mover", "Probe"]);
    assert.deepEqual(
      compiled.ir.components.map((c) => [c.name, c.isExported]),
      [
        ["Enemy", true],
        ["Frame", true],
        ["Marker", true],
        ["Mover", true],
        ["Probe", true],
        ["Hidden", false],
        ["Level", true],
      ]
    );
  });

  it("describes each value prop: type, optional, settable and constant defaults; callbacks are left out", () => {
    assert.deepEqual(world.prefabs["Enemy"]!.props, [
      { name: "speed", type: { kind: "Primitive", name: "number" }, optional: false, settable: true },
      { name: "tint", type: { kind: "Literals", values: ["red", "blue"] }, optional: true, settable: true, default: "red" },
      {
        name: "bounds",
        type: { kind: "Array", element: { kind: "Primitive", name: "number" } },
        optional: true,
        settable: true,
        default: [0, 10],
      },
      { name: "style", type: { kind: "SourceText", text: "{ bold: boolean }" }, optional: true, settable: false },
    ]);
  });

  it("leaves children out of the props, and gives a component without props a plain create", () => {
    assert.deepEqual(
      world.prefabs["Frame"]!.props.map((p) => p.name),
      ["title"]
    );
    assert.deepEqual(world.prefabs["Marker"]!.props, []);
    assert.match(compiled.code, /Marker: \{\n\s+create: \(\) => new Marker\(\),/);
    assert.match(compiled.code, /create: \(props: ConstructorParameters<typeof Enemy>\[0\]\) => new Enemy\(props\),/);
  });

  it("creates working instances", () => {
    const enemy = world.prefabs["Enemy"]!.create({ speed: 3 }) as Entity & { props: Record<string, unknown> };
    assert.deepEqual(enemy.props, { speed: 3, tint: "red", bounds: [0, 10] });
    assert.ok(world.prefabs["Marker"]!.create() instanceof Entity);
  });

  it("includes a default export, and type-checks the generated module", () => {
    const withDefault = compile(`const Coin = () => <Entity name="Coin" />;\nexport default Coin;`);
    assert.deepEqual(
      withDefault.ir.components.map((c) => c.isExported),
      [true],
      "export default makes it a prefab"
    );
    assert.match(withDefault.code, /export const prefabs = \{\n\s+Coin: \{/);
    assert.deepEqual(typeCheck(withDefault), []);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("emits nothing for a module that exports no component", () => {
    assert.doesNotMatch(compile(`function Private() { return <Entity name="p" />; }`).code, /prefabs/);
  });
});

describe("constant defaults", () => {
  const num = (value: number): ExprIR => ({ kind: "NumberLiteral", value });
  const str = (value: string): ExprIR => ({ kind: "StringLiteral", value });

  it("evaluates literals and operators over them to JSON", () => {
    assert.deepEqual(constantValue(num(3)), { value: 3 });
    assert.deepEqual(constantValue({ kind: "Unary", operator: "-", operand: num(3) }), { value: -3 });
    assert.deepEqual(
      constantValue({ kind: "Binary", operator: "*", left: num(2), right: { kind: "Binary", operator: "+", left: num(3), right: num(4) } }),
      { value: 14 }
    );
    assert.deepEqual(constantValue({ kind: "Binary", operator: "+", left: str("a"), right: str("b") }), { value: "ab" });
    assert.deepEqual(
      constantValue({ kind: "Conditional", test: { kind: "BooleanLiteral", value: true }, whenTrue: num(1), whenFalse: num(2) }),
      { value: 1 }
    );
    assert.deepEqual(constantValue({ kind: "TemplateLiteral", quasis: ["n", "!"], expressions: [num(2)] }), { value: "n2!" });
    assert.deepEqual(
      constantValue({
        kind: "ArrayLiteral",
        elements: [
          { spread: false, value: num(1) },
          { spread: true, value: { kind: "ArrayLiteral", elements: [{ spread: false, value: num(2) }] } },
        ],
      }),
      { value: [1, 2] }
    );
    assert.deepEqual(constantValue({ kind: "ObjectLiteral", properties: [{ kind: "Property", name: "a", value: num(1) }] }), {
      value: { a: 1 },
    });
    assert.deepEqual(constantValue({ kind: "NullLiteral" }), { value: null });
  });

  it("returns null for anything that is not constant or not JSON", () => {
    assert.equal(constantValue({ kind: "PropRead", name: "x" }), null);
    assert.equal(constantValue({ kind: "Binary", operator: "+", left: num(1), right: { kind: "PropRead", name: "x" } }), null);
    assert.equal(constantValue({ kind: "Binary", operator: "/", left: num(1), right: num(0) }), null, "Infinity is not JSON");
  });
});

describe("project checks and outputs", () => {
  it("builds the merged registry and the data schema", () => {
    const source = prefabsIndexSource([
      { ir: compiled.ir, generatedName: "World.ts" },
      { ir: compile(`function P() { return <Entity name="p" />; }`).ir, generatedName: "Private.ts" },
    ]);
    assert.equal(
      source,
      `// Generated by @tsengine/compiler. Do not edit.\nimport { prefabs as prefabs0 } from "./World.ts";\n\nexport const prefabs = { ...prefabs0 };\n`
    );
    assert.equal(prefabsIndexSource([]), `// Generated by @tsengine/compiler. Do not edit.\n\nexport const prefabs = {};\n`);
    const schema = JSON.parse(prefabsJson(project())) as {
      version: number;
      prefabs: Record<string, { module: string; props: { name: string }[] }>;
    };
    assert.equal(schema.version, 1);
    assert.deepEqual(Object.keys(schema.prefabs), ["Enemy", "Frame", "Level", "Marker", "Mover", "Probe"]);
    assert.equal(schema.prefabs["Enemy"]!.module, "World.tsx");
    assert.deepEqual(
      schema.prefabs["Enemy"]!.props.map((p) => p.name),
      ["speed", "tint", "bounds", "style"]
    );
  });

  it("rejects the same exported name in two files", () => {
    const files = compileProject({
      "A.tsx": `export function Dup() { return <Entity name="a" />; }`,
      "B.tsx": `export function Dup() { return <Entity name="b" />; }`,
    });
    const modules = Object.entries(files).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }));
    const diagnostics = checkProject(modules);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [DiagnosticCode.DuplicateComponent]
    );
    assert.match(diagnostics[0]!.message, /'Dup' is also exported from A\.tsx/);
  });

  it("finds a static cycle through other files, once, and no false positive", () => {
    const cyclic = compileProject({
      "CycA.tsx": `import { CycB } from "./CycB.tsx";\nexport function CycA() { return <Entity name="a"><CycB /></Entity>; }`,
      "CycB.tsx": `import CycC from "./CycC.tsx";\nexport function CycB() { return <Entity name="b"><CycC /></Entity>; }`,
      "CycC.tsx": `import { CycA } from "./CycA.tsx";\nconst CycC = () => <Entity name="c"><CycA /></Entity>;\nexport default CycC;`,
    });
    const modules = Object.entries(cyclic).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }));
    const diagnostics = checkProject(modules);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [DiagnosticCode.ComponentCycle]
    );
    assert.match(diagnostics[0]!.message, /CycA → CycB → CycC → CycA/);

    const fine = compileProject({
      "OkA.tsx": `import { OkB } from "./OkB.tsx";\nexport function OkA() { return <Entity name="a"><OkB /></Entity>; }`,
      "OkB.tsx": `export function OkB() { return <Entity name="b" />; }`,
    });
    assert.deepEqual(checkProject(Object.entries(fine).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }))), []);
  });

  it("does not follow a condition: only static containment cycles", () => {
    const files = compileProject({
      "CondA.tsx": `import { CondB } from "./CondB.tsx";\nexport function CondA() { return <Entity name="a"><CondB /></Entity>; }`,
      "CondB.tsx": `import { CondA } from "./CondA.tsx";\nexport function CondB() { const s = useMutable({ on: false }); return <Entity name="b">{s.on && <CondA />}</Entity>; }`,
    });
    assert.deepEqual(
      checkProject(Object.entries(files).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }))),
      []
    );
  });
});

/** Line and column (1-based) of the first `needle` in `text`. */
function where(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, needle);
  const head = text.slice(0, index).split("\n");
  return { line: head.length, column: head.at(-1)!.length + 1 };
}

describe("scene validation", () => {
  const check = (text: string): CompilerDiagnostic[] => getCompiler().validateScene("scene.json", text, projectSchemas(project()));
  const expectOne = (text: string, code: string, needle: string, message: RegExp): void => {
    const diagnostics = check(text);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [code],
      JSON.stringify(diagnostics.map((d) => d.message))
    );
    assert.deepEqual(
      { line: diagnostics[0]!.span!.line, column: diagnostics[0]!.span!.column },
      where(text, needle),
      "points at the value"
    );
    assert.match(diagnostics[0]!.message, message);
  };
  const scene = (entity: string): string => `{\n  "version": 1,\n  "entities": [\n    ${entity}\n  ]\n}\n`;

  it("accepts a valid scene, defaults left out, nested children, every transform field", () => {
    const text =
      scene(`{ "id": "f", "prefab": "Frame", "props": { "title": "t" }, "transform": { "x": -4, "y": 2.5, "z": 3, "rotation": 0.5, "scaleX": 2, "scaleY": 2, "global": false },
      "children": [{ "id": "e", "prefab": "Enemy", "props": { "speed": 1, "tint": "blue", "bounds": [1, -2] } }, { "id": "m", "prefab": "Marker" }] }`);
    assert.deepEqual(check(text), []);
  });

  it("reports an unknown prefab at its name, with the known ones", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Nope" }`),
      DiagnosticCode.UnknownPrefab,
      `"Nope"`,
      /entities\[0\]\.prefab: Unknown prefab 'Nope'\. Prefabs: Enemy, Frame, Level, Marker, Mover, Probe/
    );
  });

  it("reports an unknown prop at its value, and says callbacks cannot be set", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "onDefeated": 5 } }`),
      DiagnosticCode.UnknownPrefabProp,
      `5`,
      /entities\[0\]\.props\.onDefeated: Enemy has no prop 'onDefeated' \(props: speed, tint, bounds, style\)\. Callback props cannot be set/
    );
    expectOne(
      scene(`{ "id": "a", "prefab": "Marker", "props": { "x": 77 } }`),
      DiagnosticCode.UnknownPrefabProp,
      `77`,
      /it takes no props/
    );
  });

  it("reports a missing required prop on the props object, or on the entity when there are none", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "tint": "red" } }`),
      DiagnosticCode.MissingPrefabProp,
      `{ "tint"`,
      /Enemy needs the prop 'speed' \(number\)/
    );
    expectOne(
      scene(`{ "id": "a", "prefab": "Frame" }`),
      DiagnosticCode.MissingPrefabProp,
      `{ "id": "a"`,
      /Frame needs the prop 'title' \(string\)/
    );
  });

  it("reports a value of the wrong type at the value", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": "fast" } }`),
      DiagnosticCode.WrongPropType,
      `"fast"`,
      /entities\[0\]\.props\.speed: Expected a number, got the string "fast"/
    );
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "tint": "green" } }`),
      DiagnosticCode.WrongPropType,
      `"green"`,
      /one of "red", "blue"/
    );
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "bounds": [1, "two"] } }`),
      DiagnosticCode.WrongPropType,
      `"two"`,
      /props\.bounds\[1\]: Expected a number/
    );
    expectOne(
      scene(`{ "id": "a", "prefab": "Frame", "props": { "title": true } }`),
      DiagnosticCode.WrongPropType,
      `true`,
      /Expected a string, got true/
    );
  });

  it("reports a prop data cannot express", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "style": { "bold": true } } }`),
      DiagnosticCode.PropNotSettable,
      `{ "bold"`,
      /typed \{ bold: boolean \}, which data cannot express/
    );
  });

  it("reports a duplicate id, among nested entities too, pointing at the second", () => {
    const text = scene(`{ "id": "a", "prefab": "Marker", "children": [{ "id": "a", "prefab": "Marker" }] }`);
    const diagnostics = check(text);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [DiagnosticCode.DuplicateSceneId]
    );
    assert.match(diagnostics[0]!.message, /entities\[0\]\.children\[0\]\.id: Duplicate id 'a' \(first used at entities\[0\]\.id\)/);
  });

  it("checks the transform", () => {
    expectOne(
      scene(`{ "id": "a", "prefab": "Marker", "transform": { "x": "left" } }`),
      DiagnosticCode.WrongPropType,
      `"left"`,
      /transform\.x: Expected a number/
    );
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "transform": { "global": 9 } }`), DiagnosticCode.WrongPropType, `9`, /true or false/);
    expectOne(
      scene(`{ "id": "a", "prefab": "Marker", "transform": { "z": "front" } }`),
      DiagnosticCode.WrongPropType,
      `"front"`,
      /transform\.z: Expected a number/
    );
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "transform": { "w": 1 } }`), DiagnosticCode.SceneShape, `"w"`, /Unknown key 'w'/);
  });

  it("checks the shape of the scene", () => {
    expectOne(`{ "version": 2, "entities": [] }`, DiagnosticCode.SceneShape, `2`, /Unsupported scene version 2/);
    expectOne(`{ "version": 1 }`, DiagnosticCode.SceneShape, `{ "version"`, /needs an `entities` array/);
    expectOne(`{ "version": 1, "entities": {} }`, DiagnosticCode.SceneShape, `{}`, /must be an array/);
    expectOne(`[]`, DiagnosticCode.SceneShape, `[]`, /A scene is an object/);
    expectOne(scene(`5`), DiagnosticCode.SceneShape, `5`, /An entity is an object/);
    expectOne(scene(`{ "prefab": "Marker" }`), DiagnosticCode.SceneShape, `{ "prefab"`, /needs an `id`/);
    expectOne(scene(`{ "id": "a" }`), DiagnosticCode.SceneShape, `{ "id"`, /needs a `prefab`/);
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "extra": 1 }`), DiagnosticCode.SceneShape, `"extra"`, /Unknown key 'extra'/);
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "id": "b" }`), DiagnosticCode.SceneShape, `"id": "b"`, /Duplicate key 'id'/);
  });

  it("reports invalid JSON with a position", () => {
    const diagnostics = check(`{\n  "version": 1,\n  "entities": [,]\n}`);
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [DiagnosticCode.SceneSyntax]
    );
    assert.match(diagnostics[0]!.message, /^Invalid JSON/);
  });

  it("keeps validating after a problem, so one run reports them all", () => {
    const text = scene(`{ "id": "a", "prefab": "Nope" }, { "id": "a", "prefab": "Enemy", "props": { "speed": "x", "zzz": 1 } }`);
    assert.deepEqual(
      check(text)
        .map((d) => d.code)
        .sort(),
      [DiagnosticCode.DuplicateSceneId, DiagnosticCode.UnknownPrefab, DiagnosticCode.UnknownPrefabProp, DiagnosticCode.WrongPropType].sort()
    );
  });
});

describe("loadScene", () => {
  /** A tree as plain data: what a scene and the equivalent TSX must agree on. */
  function describeTree(object: GameObject): unknown {
    const fields = (t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; global: boolean }) => ({
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      scaleX: t.scaleX,
      scaleY: t.scaleY,
      global: t.global,
    });
    return {
      type: object.constructor.name,
      ...(object instanceof Entity ? { name: object.name } : {}),
      ...(object instanceof Sprite ? { image: object.image } : {}),
      props: object.props,
      placement: fields(object.placement),
      transform: fields(object.transform),
      children: object.children.map(describeTree),
    };
  }

  it("builds the same tree as the TSX that composes the same components", () => {
    const fromCode = new world.Level();
    const scene: Scene = {
      version: 1,
      entities: [
        {
          id: "hud",
          prefab: "Frame",
          props: { title: "hud" },
          children: [
            { id: "a", prefab: "Enemy", props: { speed: 1 } },
            { id: "b", prefab: "Enemy", props: { speed: 2, tint: "blue" } },
          ],
        },
      ],
    };
    const w = new World();
    const ids = loadScene(w, scene, world.prefabs);
    assert.deepEqual(describeTree(ids.get("hud")!), describeTree(fromCode.children[0]!));
    assert.equal(ids.get("hud")!.parent, w.root, "mounted");
  });

  it("mounts passed children at the slot of a component that renders {children}", () => {
    const w = new World();
    const ids = loadScene(
      w,
      { version: 1, entities: [{ id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "m", prefab: "Marker" }] }] },
      world.prefabs
    );
    const content = ids.get("f")!.children[1]!;
    sameOrder(content.children, [ids.get("m")], "inside Content, not after it");
  });

  it("appends children after the own children of a component that does not render {children}", () => {
    const w = new World();
    const ids = loadScene(
      w,
      { version: 1, entities: [{ id: "e", prefab: "Enemy", props: { speed: 1 }, children: [{ id: "m", prefab: "Marker" }] }] },
      world.prefabs
    );
    assert.deepEqual(
      ids.get("e")!.children.map((c) => c.constructor.name),
      ["Sprite", "Marker"]
    );
  });

  it("places an entity under the component's own, state-driven transform", () => {
    const w = new World();
    const ids = loadScene(
      w,
      { version: 1, entities: [{ id: "m", prefab: "Mover", props: { speed: 10 }, transform: { x: 100, y: 7 } }] },
      world.prefabs
    );
    const mover = ids.get("m")!;
    assert.deepEqual([mover.placement.x, mover.placement.y], [100, 7]);
    w.tick(2);
    assert.equal(mover.transform.x, 20, "its own movement is not overwritten by the placement");
    assert.equal(mover.worldTransform().x, 120, "and composes with it");
  });

  it("mounts every object once, children first, however deep", () => {
    const w = new World();
    const ids = loadScene(
      w,
      {
        version: 1,
        entities: [{ id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "p", prefab: "Probe", props: { tag: "p" } }] }],
      },
      world.prefabs
    );
    w.flush();
    assert.equal((ids.get("p") as unknown as { s: { mounted: number } }).s.mounted, 1);
  });

  it("returns every object, nested ones included, by id", () => {
    const ids = loadScene(
      new World(),
      {
        version: 1,
        entities: [
          { id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "m", prefab: "Marker" }] },
          { id: "m2", prefab: "Marker" },
        ],
      },
      world.prefabs
    );
    assert.deepEqual([...ids.keys()], ["f", "m", "m2"]);
  });

  it("fails clearly on an unknown prefab or a repeated id (validation is a build step)", () => {
    assert.throws(
      () => loadScene(new World(), { version: 1, entities: [{ id: "a", prefab: "Nope" }] }, world.prefabs),
      /Scene entity 'a': unknown prefab 'Nope' \(known: Enemy, Frame/
    );
    assert.throws(
      () =>
        loadScene(
          new World(),
          {
            version: 1,
            entities: [
              { id: "a", prefab: "Marker" },
              { id: "a", prefab: "Marker" },
            ],
          },
          world.prefabs
        ),
      /duplicate id/
    );
  });

  it("does not let a scene name something on the prototype", () => {
    assert.throws(
      () => loadScene(new World(), { version: 1, entities: [{ id: "a", prefab: "toString" }] }, world.prefabs),
      /unknown prefab 'toString'/
    );
  });
});
