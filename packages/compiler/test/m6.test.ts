/**
 * M6: prefabs and scenes. An exported component is a prefab: the compiler
 * emits a registry and a data schema; a scene (JSON, or a Tiled map) places
 * prefabs by name; `loadScene` builds the objects. A scene loaded from data
 * must give the same tree as the TSX that composes the same components.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Entity, GameObject, Sprite, World, loadScene, type PrefabRegistry, type Scene } from "@rge/runtime";
import {
  DiagnosticCode,
  checkProject,
  constantValue,
  importTiled,
  prefabsIndexSource,
  prefabsJson,
  projectSchemas,
  type CompilerDiagnostic,
  type ExprIR,
  type ProjectModule,
} from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, compile, compileProject, getCompiler, load, sameOrder, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const WORLD = `
import { type Child, Entity, Sprite, useMount, useRef, useState, useUpdate } from "@rge/runtime/jsx";

interface EnemyProps {
  speed: number;
  tint?: "red" | "blue";
  bounds?: number[];
  style?: { bold: boolean };
  onDefeated?: () => void;
}

export function Enemy({ speed, tint = "red", bounds = [0, 10] }: EnemyProps) {
  return (
    <Entity name="Enemy">
      <Sprite image={tint === "red" ? "enemy-red.png" : "enemy-blue.png"} />
    </Entity>
  );
}

interface FrameProps {
  title: string;
  children: Child;
}

export function Frame({ title, children }: FrameProps) {
  return (
    <Entity name="Frame">
      <Sprite image={title + ".png"} />
      <Entity name="Content">{children}</Entity>
    </Entity>
  );
}

export function Marker() {
  return <Entity name="Marker" />;
}

interface MoverProps {
  speed?: number;
}

export function Mover({ speed = 10 }: MoverProps) {
  const [x, setX] = useState(0);
  useUpdate((dt) => setX((x) => x + dt * speed));
  return <Entity name="Mover" transform={{ x }} />;
}

interface ProbeProps {
  tag: string;
}

export function Probe({ tag }: ProbeProps) {
  const mounted = useRef(0);
  useMount(() => {
    mounted.current += 1;
  });
  return <Entity name={tag} />;
}

function Hidden() {
  return <Entity name="Hidden" />;
}

export function Level() {
  return (
    <Entity name="Level">
      <Frame title="hud">
        <Enemy speed={1} transform={{ x: 10 }} />
        <Enemy speed={2} tint="blue" transform={{ x: 20, y: 5, rotation: 0.5 }} />
      </Frame>
      <Hidden />
    </Entity>
  );
}
`;

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

describe("M6: the prefab registry", () => {
  it("lists the exported components, not the private ones", () => {
    assert.deepEqual(Object.keys(world.prefabs).sort(), ["Enemy", "Frame", "Level", "Marker", "Mover", "Probe"]);
    assert.deepEqual(compiled.ir.components.map((c) => [c.name, c.isExported]), [
      ["Enemy", true], ["Frame", true], ["Marker", true], ["Mover", true], ["Probe", true], ["Hidden", false], ["Level", true],
    ]);
  });

  it("describes each value prop: type, optional, settable and constant defaults; callbacks are left out", () => {
    assert.deepEqual(world.prefabs["Enemy"]!.props, [
      { name: "speed", type: { kind: "Primitive", name: "number" }, optional: false, settable: true },
      { name: "tint", type: { kind: "Literals", values: ["red", "blue"] }, optional: true, settable: true, default: "red" },
      { name: "bounds", type: { kind: "Array", element: { kind: "Primitive", name: "number" } }, optional: true, settable: true, default: [0, 10] },
      { name: "style", type: { kind: "SourceText", text: "{ bold: boolean }" }, optional: true, settable: false },
    ]);
  });

  it("leaves children out of the props, and gives a component without props a plain create", () => {
    assert.deepEqual(world.prefabs["Frame"]!.props.map((p) => p.name), ["title"]);
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
    assert.deepEqual(withDefault.ir.components.map((c) => c.isExported), [true], "export default makes it a prefab");
    assert.match(withDefault.code, /export const prefabs = \{\n\s+Coin: \{/);
    assert.deepEqual(typeCheck(withDefault), []);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("emits nothing for a module that exports no component", () => {
    assert.doesNotMatch(compile(`function Private() { return <Entity name="p" />; }`).code, /prefabs/);
  });
});

describe("M6: constant defaults", () => {
  const num = (value: number): ExprIR => ({ kind: "NumberLiteral", value });
  const str = (value: string): ExprIR => ({ kind: "StringLiteral", value });

  it("evaluates literals and operators over them to JSON", () => {
    assert.deepEqual(constantValue(num(3)), { value: 3 });
    assert.deepEqual(constantValue({ kind: "Unary", operator: "-", operand: num(3) }), { value: -3 });
    assert.deepEqual(constantValue({ kind: "Binary", operator: "*", left: num(2), right: { kind: "Binary", operator: "+", left: num(3), right: num(4) } }), { value: 14 });
    assert.deepEqual(constantValue({ kind: "Binary", operator: "+", left: str("a"), right: str("b") }), { value: "ab" });
    assert.deepEqual(constantValue({ kind: "Conditional", test: { kind: "BooleanLiteral", value: true }, whenTrue: num(1), whenFalse: num(2) }), { value: 1 });
    assert.deepEqual(constantValue({ kind: "TemplateLiteral", quasis: ["n", "!"], expressions: [num(2)] }), { value: "n2!" });
    assert.deepEqual(constantValue({ kind: "ArrayLiteral", elements: [{ spread: false, value: num(1) }, { spread: true, value: { kind: "ArrayLiteral", elements: [{ spread: false, value: num(2) }] } }] }), { value: [1, 2] });
    assert.deepEqual(constantValue({ kind: "ObjectLiteral", properties: [{ kind: "Property", name: "a", value: num(1) }] }), { value: { a: 1 } });
    assert.deepEqual(constantValue({ kind: "NullLiteral" }), { value: null });
  });

  it("returns null for anything that is not constant or not JSON", () => {
    assert.equal(constantValue({ kind: "PropRead", name: "x" }), null);
    assert.equal(constantValue({ kind: "Binary", operator: "+", left: num(1), right: { kind: "PropRead", name: "x" } }), null);
    assert.equal(constantValue({ kind: "Binary", operator: "/", left: num(1), right: num(0) }), null, "Infinity is not JSON");
  });
});

describe("M6: project checks and outputs", () => {
  it("builds the merged registry and the data schema", () => {
    const source = prefabsIndexSource([
      { ir: compiled.ir, generatedName: "World.ts" },
      { ir: compile(`function P() { return <Entity name="p" />; }`).ir, generatedName: "Private.ts" },
    ]);
    assert.equal(source, `// Generated by @rge/compiler. Do not edit.\nimport { prefabs as prefabs0 } from "./World.ts";\n\nexport const prefabs = { ...prefabs0 };\n`);
    assert.equal(prefabsIndexSource([]), `// Generated by @rge/compiler. Do not edit.\n\nexport const prefabs = {};\n`);
    const schema = JSON.parse(prefabsJson(project())) as { version: number; prefabs: Record<string, { module: string; props: { name: string }[] }> };
    assert.equal(schema.version, 1);
    assert.deepEqual(Object.keys(schema.prefabs), ["Enemy", "Frame", "Level", "Marker", "Mover", "Probe"]);
    assert.equal(schema.prefabs["Enemy"]!.module, "World.tsx");
    assert.deepEqual(schema.prefabs["Enemy"]!.props.map((p) => p.name), ["speed", "tint", "bounds", "style"]);
  });

  it("rejects the same exported name in two files", () => {
    const files = compileProject({
      "A.tsx": `export function Dup() { return <Entity name="a" />; }`,
      "B.tsx": `export function Dup() { return <Entity name="b" />; }`,
    });
    const modules = Object.entries(files).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }));
    const diagnostics = checkProject(modules);
    assert.deepEqual(diagnostics.map((d) => d.code), [DiagnosticCode.DuplicateComponent]);
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
    assert.deepEqual(diagnostics.map((d) => d.code), [DiagnosticCode.ComponentCycle]);
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
      "CondB.tsx": `import { CondA } from "./CondA.tsx";\nexport function CondB() { const [on, setOn] = useState(false); return <Entity name="b">{on && <CondA />}</Entity>; }`,
    });
    assert.deepEqual(checkProject(Object.entries(files).map(([name, m]) => ({ ir: m.ir, generatedName: name.replace(".tsx", ".ts") }))), []);
  });
});

/** Line and column (1-based) of the first `needle` in `text`. */
function where(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, needle);
  const head = text.slice(0, index).split("\n");
  return { line: head.length, column: head.at(-1)!.length + 1 };
}

describe("M6: scene validation", () => {
  const check = (text: string): CompilerDiagnostic[] => getCompiler().validateScene("scene.json", text, projectSchemas(project()));
  const expectOne = (text: string, code: string, needle: string, message: RegExp): void => {
    const diagnostics = check(text);
    assert.deepEqual(diagnostics.map((d) => d.code), [code], JSON.stringify(diagnostics.map((d) => d.message)));
    assert.deepEqual({ line: diagnostics[0]!.span!.line, column: diagnostics[0]!.span!.column }, where(text, needle), "points at the value");
    assert.match(diagnostics[0]!.message, message);
  };
  const scene = (entity: string): string => `{\n  "version": 1,\n  "entities": [\n    ${entity}\n  ]\n}\n`;

  it("accepts a valid scene, defaults left out, nested children, every transform field", () => {
    const text = scene(`{ "id": "f", "prefab": "Frame", "props": { "title": "t" }, "transform": { "x": -4, "y": 2.5, "rotation": 0.5, "scaleX": 2, "scaleY": 2, "global": false },
      "children": [{ "id": "e", "prefab": "Enemy", "props": { "speed": 1, "tint": "blue", "bounds": [1, -2] } }, { "id": "m", "prefab": "Marker" }] }`);
    assert.deepEqual(check(text), []);
  });

  it("reports an unknown prefab at its name, with the known ones", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Nope" }`), DiagnosticCode.UnknownPrefab, `"Nope"`, /entities\[0\]\.prefab: Unknown prefab 'Nope'\. Prefabs: Enemy, Frame, Level, Marker, Mover, Probe/);
  });

  it("reports an unknown prop at its value, and says callbacks cannot be set", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "onDefeated": 5 } }`), DiagnosticCode.UnknownPrefabProp, `5`, /entities\[0\]\.props\.onDefeated: Enemy has no prop 'onDefeated' \(props: speed, tint, bounds, style\)\. Callback props cannot be set/);
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "props": { "x": 77 } }`), DiagnosticCode.UnknownPrefabProp, `77`, /it takes no props/);
  });

  it("reports a missing required prop on the props object, or on the entity when there are none", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "tint": "red" } }`), DiagnosticCode.MissingPrefabProp, `{ "tint"`, /Enemy needs the prop 'speed' \(number\)/);
    expectOne(scene(`{ "id": "a", "prefab": "Frame" }`), DiagnosticCode.MissingPrefabProp, `{ "id": "a"`, /Frame needs the prop 'title' \(string\)/);
  });

  it("reports a value of the wrong type at the value", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": "fast" } }`), DiagnosticCode.WrongPropType, `"fast"`, /entities\[0\]\.props\.speed: Expected a number, got the string "fast"/);
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "tint": "green" } }`), DiagnosticCode.WrongPropType, `"green"`, /one of "red", "blue"/);
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "bounds": [1, "two"] } }`), DiagnosticCode.WrongPropType, `"two"`, /props\.bounds\[1\]: Expected a number/);
    expectOne(scene(`{ "id": "a", "prefab": "Frame", "props": { "title": true } }`), DiagnosticCode.WrongPropType, `true`, /Expected a string, got true/);
  });

  it("reports a prop data cannot express", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Enemy", "props": { "speed": 1, "style": { "bold": true } } }`), DiagnosticCode.PropNotSettable, `{ "bold"`, /typed \{ bold: boolean \}, which data cannot express/);
  });

  it("reports a duplicate id, among nested entities too, pointing at the second", () => {
    const text = scene(`{ "id": "a", "prefab": "Marker", "children": [{ "id": "a", "prefab": "Marker" }] }`);
    const diagnostics = check(text);
    assert.deepEqual(diagnostics.map((d) => d.code), [DiagnosticCode.DuplicateSceneId]);
    assert.match(diagnostics[0]!.message, /entities\[0\]\.children\[0\]\.id: Duplicate id 'a' \(first used at entities\[0\]\.id\)/);
  });

  it("checks the transform", () => {
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "transform": { "x": "left" } }`), DiagnosticCode.WrongPropType, `"left"`, /transform\.x: Expected a number/);
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "transform": { "global": 9 } }`), DiagnosticCode.WrongPropType, `9`, /true or false/);
    expectOne(scene(`{ "id": "a", "prefab": "Marker", "transform": { "z": 1 } }`), DiagnosticCode.SceneShape, `"z"`, /Unknown key 'z'/);
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
    assert.deepEqual(diagnostics.map((d) => d.code), [DiagnosticCode.SceneSyntax]);
    assert.match(diagnostics[0]!.message, /^Invalid JSON/);
  });

  it("keeps validating after a problem, so one run reports them all", () => {
    const text = scene(`{ "id": "a", "prefab": "Nope" }, { "id": "a", "prefab": "Enemy", "props": { "speed": "x", "zzz": 1 } }`);
    assert.deepEqual(check(text).map((d) => d.code).sort(), [DiagnosticCode.DuplicateSceneId, DiagnosticCode.UnknownPrefab, DiagnosticCode.UnknownPrefabProp, DiagnosticCode.WrongPropType].sort());
  });
});

describe("M6: the Tiled importer", () => {
  const map = (layers: unknown[]): string => JSON.stringify({ type: "map", layers });
  const objects = (...list: Record<string, unknown>[]) => ({ type: "objectgroup", name: "Things", objects: list });

  it("turns object layers into entities: class or type, ids, position, properties of each type", () => {
    const { scene, diagnostics } = importTiled(
      "m.tmj",
      map([
        { type: "tilelayer", name: "Ground", data: [] },
        objects(
          { id: 7, class: "Enemy", x: 32, y: 48, properties: [{ name: "speed", type: "float", value: 1.5 }, { name: "n", type: "int", value: 2 }, { name: "ok", type: "bool", value: false }, { name: "tint", type: "string", value: "blue" }, { name: "sprite", type: "file", value: "a.png" }, { name: "c", type: "color", value: "#ff0000" }] },
          { id: 8, type: "Marker", x: 1, y: 2 },
        ),
      ]),
    );
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(scene, {
      version: 1,
      entities: [
        { id: "Things/7", prefab: "Enemy", props: { speed: 1.5, n: 2, ok: false, tint: "blue", sprite: "a.png", c: "#ff0000" }, transform: { x: 32, y: 48 } },
        { id: "Things/8", prefab: "Marker", transform: { x: 1, y: 2 } },
      ],
    });
  });

  it("converts rotation to radians, and flattens groups", () => {
    const { scene } = importTiled("m.tmj", map([{ type: "group", name: "G", layers: [{ type: "group", name: "Inner", layers: [objects({ id: 1, class: "Marker", x: 0, y: 0, rotation: 180 })] }] }]));
    assert.deepEqual(scene.entities.map((e) => [e.id, e.transform.rotation]), [["Things/1", Math.PI]].map(([id, r]) => [id, Math.round((r as number) * 1e6) / 1e6]));
  });

  it("moves a tile object from its bottom-left anchor to its top-left, along its rotated up axis", () => {
    const flat = importTiled("m.tmj", map([objects({ id: 1, class: "Marker", gid: 5, x: 100, y: 100, height: 16, rotation: 0 })])).scene.entities[0]!;
    assert.deepEqual(flat.transform, { x: 100, y: 84 });
    const turned = importTiled("m.tmj", map([objects({ id: 1, class: "Marker", gid: 5, x: 100, y: 100, height: 16, rotation: 90 })])).scene.entities[0]!;
    assert.deepEqual([turned.transform.x, turned.transform.y], [116, 100]);
  });

  it("skips an object with no class, with a warning, and reports property types it cannot hold", () => {
    const { scene, diagnostics } = importTiled("m.tmj", map([objects({ id: 1, name: "spawn", x: 0, y: 0 }, { id: 2, class: "Enemy", x: 0, y: 0, properties: [{ name: "target", type: "object", value: 3 }, { name: "speed", type: "float", value: "fast" }] })]));
    assert.deepEqual(scene.entities.map((e) => e.id), ["Things/2"], "the skipped object is not an entity");
    assert.deepEqual(diagnostics.map((d) => [d.code, d.severity]), [
      [DiagnosticCode.TiledImport, "warning"],
      [DiagnosticCode.TiledImport, "error"],
      [DiagnosticCode.TiledImport, "error"],
    ]);
    assert.match(diagnostics[0]!.message, /m\.tmj: layer 'Things', object 1 \('spawn'\) has no type/);
    assert.match(diagnostics[1]!.message, /property 'target' has the type 'object'/);
    assert.match(diagnostics[2]!.message, /property 'speed' is not a number/);
  });

  it("rejects what is not a Tiled map", () => {
    assert.match(importTiled("m.tmj", "{").diagnostics[0]!.message, /not valid JSON/);
    assert.match(importTiled("m.tmj", "{}").diagnostics[0]!.message, /not a Tiled map/);
    assert.deepEqual(importTiled("m.tmj", "{}").scene.entities, []);
  });

  it("produces a scene that validates against the prefabs", () => {
    const { scene } = importTiled("m.tmj", map([objects({ id: 1, class: "Enemy", x: 4, y: 5, properties: [{ name: "speed", type: "int", value: 2 }] }, { id: 2, class: "Enemy", x: 4, y: 5 })]));
    const diagnostics = getCompiler().validateScene("m.scene.json", JSON.stringify(scene, null, 2), projectSchemas(project()));
    assert.deepEqual(diagnostics.map((d) => d.code), [DiagnosticCode.MissingPrefabProp], "the second object forgot its required speed");
  });
});

describe("M6: loadScene", () => {
  /** A tree as plain data: what a scene and the equivalent TSX must agree on. */
  function describeTree(object: GameObject): unknown {
    const fields = (t: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; global: boolean }) => ({ x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY, global: t.global });
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
            { id: "a", prefab: "Enemy", props: { speed: 1 }, transform: { x: 10 } },
            { id: "b", prefab: "Enemy", props: { speed: 2, tint: "blue" }, transform: { x: 20, y: 5, rotation: 0.5 } },
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
    const ids = loadScene(w, { version: 1, entities: [{ id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "m", prefab: "Marker" }] }] }, world.prefabs);
    const content = ids.get("f")!.children[1]!;
    sameOrder(content.children, [ids.get("m")], "inside Content, not after it");
  });

  it("appends children after the own children of a component that does not render {children}", () => {
    const w = new World();
    const ids = loadScene(w, { version: 1, entities: [{ id: "e", prefab: "Enemy", props: { speed: 1 }, children: [{ id: "m", prefab: "Marker" }] }] }, world.prefabs);
    assert.deepEqual(ids.get("e")!.children.map((c) => c.constructor.name), ["Sprite", "Marker"]);
  });

  it("places an entity under the component's own, state-driven transform", () => {
    const w = new World();
    const ids = loadScene(w, { version: 1, entities: [{ id: "m", prefab: "Mover", props: { speed: 10 }, transform: { x: 100, y: 7 } }] }, world.prefabs);
    const mover = ids.get("m")!;
    assert.deepEqual([mover.placement.x, mover.placement.y], [100, 7]);
    w.tick(2);
    assert.equal(mover.transform.x, 20, "its own movement is not overwritten by the placement");
    assert.equal(mover.worldTransform().x, 120, "and composes with it");
  });

  it("mounts every object once, children first, however deep", () => {
    const w = new World();
    const ids = loadScene(w, { version: 1, entities: [{ id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "p", prefab: "Probe", props: { tag: "p" } }] }] }, world.prefabs);
    assert.equal((ids.get("p") as unknown as { mounted: number }).mounted, 1);
  });

  it("returns every object, nested ones included, by id", () => {
    const ids = loadScene(new World(), { version: 1, entities: [{ id: "f", prefab: "Frame", props: { title: "t" }, children: [{ id: "m", prefab: "Marker" }] }, { id: "m2", prefab: "Marker" }] }, world.prefabs);
    assert.deepEqual([...ids.keys()], ["f", "m", "m2"]);
  });

  it("fails clearly on an unknown prefab or a repeated id (validation is a build step)", () => {
    assert.throws(() => loadScene(new World(), { version: 1, entities: [{ id: "a", prefab: "Nope" }] }, world.prefabs), /Scene entity 'a': unknown prefab 'Nope' \(known: Enemy, Frame/);
    assert.throws(() => loadScene(new World(), { version: 1, entities: [{ id: "a", prefab: "Marker" }, { id: "a", prefab: "Marker" }] }, world.prefabs), /duplicate id/);
  });

  it("does not let a scene name something on the prototype", () => {
    assert.throws(() => loadScene(new World(), { version: 1, entities: [{ id: "a", prefab: "toString" }] }, world.prefabs), /unknown prefab 'toString'/);
  });
});

describe("M6: the CLI", () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
  let counter = 0;

  /** Writes a project inside the repo (so `@rge/runtime/jsx` resolves), runs the CLI with --scenes, and reads back what it wrote. */
  function run(files: Record<string, string>, scenes: Record<string, string>) {
    const dir = join(OUTPUT_ROOT, `m6-cli-${process.pid}`, String(++counter));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", name), text);
    }
    for (const [name, text] of Object.entries(scenes)) {
      mkdirSync(join(dir, "scenes"), { recursive: true });
      writeFileSync(join(dir, "scenes", name), text);
    }
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), "--scenes", join(dir, "scenes")], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, out: join(dir, "out") };
  }

  const FILES = { "Enemy.tsx": `import { Entity } from "@rge/runtime/jsx";\ninterface EnemyProps { speed: number }\nexport function Enemy({ speed }: EnemyProps) { return <Entity name="Enemy" transform={{ x: speed }} />; }` };
  const GOOD = `{ "version": 1, "entities": [{ "id": "a", "prefab": "Enemy", "props": { "speed": 2 } }] }`;
  const TMJ = JSON.stringify({ type: "map", layers: [{ type: "objectgroup", name: "Units", objects: [{ id: 1, class: "Enemy", x: 8, y: 9, properties: [{ name: "speed", type: "int", value: 3 }] }] }] });

  it("writes prefabs.ts and prefabs.json, validates scenes, and imports a Tiled map", () => {
    const { status, output, out } = run(FILES, { "good.json": GOOD, "map.tmj": TMJ });
    assert.equal(status, 0, output);
    assert.match(output, /wrote prefabs\.ts and prefabs\.json \(1 prefab\)/);
    assert.match(readFileSync(join(out, "prefabs.ts"), "utf8"), /import \{ prefabs as prefabs0 \} from "\.\/Enemy\.ts";/);
    assert.deepEqual(Object.keys((JSON.parse(readFileSync(join(out, "prefabs.json"), "utf8")) as { prefabs: object }).prefabs), ["Enemy"]);
    const imported = JSON.parse(readFileSync(join(out, "scenes", "map.scene.json"), "utf8")) as { entities: { id: string; transform: object }[] };
    assert.deepEqual(imported.entities.map((e) => e.id), ["Units/1"]);
  });

  it("fails a bad scene with its file, line and column and JSON path", () => {
    const { status, output } = run(FILES, { "bad.json": `{\n  "version": 1,\n  "entities": [\n    { "id": "a", "prefab": "Enemy", "props": { "speed": "fast" } }\n  ]\n}\n` });
    assert.equal(status, 1);
    assert.match(output, /bad\.json:4:57 - error RGE1506: entities\[0\]\.props\.speed: Expected a number, got the string "fast"/);
  });

  it("fails a Tiled map whose object does not fit its prefab", () => {
    const { status, output } = run(FILES, { "map.tmj": JSON.stringify({ type: "map", layers: [{ type: "objectgroup", name: "Units", objects: [{ id: 1, class: "Enemy", x: 0, y: 0 }] }] }) });
    assert.equal(status, 1);
    assert.match(output, /map\.scene\.json:\d+:\d+ - error RGE1505: entities\[0\]: Enemy needs the prop 'speed'/);
  });

  /** Runs the CLI with exactly these arguments after the source and output directories. */
  function runWith(files: Record<string, string>, extra: (dir: string) => string[], scenes: Record<string, string> = {}) {
    const dir = join(OUTPUT_ROOT, `m6-cli-${process.pid}`, `w${++counter}`);
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
    for (const [name, text] of Object.entries(scenes)) {
      mkdirSync(join(dir, "scenes"), { recursive: true });
      writeFileSync(join(dir, "scenes", name), text);
    }
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), ...extra(dir)], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, out: join(dir, "out") };
  }

  it("refuses a flag with no value, instead of silently skipping what it was for", () => {
    for (const flag of ["--scenes", "--runtime"]) {
      const { status, output } = runWith(FILES, () => [flag]);
      assert.equal(status, 2, flag);
      assert.match(output, new RegExp(`${flag} needs a value`));
    }
    const followedByFlag = runWith(FILES, () => ["--scenes", "--no-check"]);
    assert.equal(followedByFlag.status, 2, "the next argument is another flag, not a value");
  });

  it("refuses an unknown option, and a scenes or source directory that does not exist", () => {
    const unknown = runWith(FILES, () => ["--sceens", "x"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.output, /unknown option --sceens/);
    const missing = runWith(FILES, (dir) => ["--scenes", join(dir, "nope")]);
    assert.equal(missing.status, 2);
    assert.match(missing.output, /The scenes directory '.*nope' does not exist/);
    assert.doesNotMatch(missing.output, /at .*\.ts:\d+/, "a message, not a stack trace");
  });

  it("writes prefabs.ts and prefabs.json only when every file compiled, so they are never missing a component", () => {
    const broken = { ...FILES, "Broken.tsx": `import { Entity } from "@rge/runtime/jsx";\nexport function Broken() { return <Entity name="b">{oops}</Entity>; }` };
    const partial = runWith(broken, () => ["--no-check"]);
    assert.equal(partial.status, 1);
    assert.match(partial.output, /skipped prefabs\.ts and prefabs\.json: not every file compiled/);
    assert.equal(existsSync(join(partial.out, "prefabs.ts")), false);
    assert.equal(existsSync(join(partial.out, "prefabs.json")), false);
    assert.equal(existsSync(join(partial.out, "Enemy.ts")), true, "the file that compiled is still written, as before");
    const whole = runWith(FILES, () => ["--no-check"]);
    assert.equal(existsSync(join(whole.out, "prefabs.ts")), true);
  });

  it("fails duplicate exported names, and does not validate scenes against a broken project", () => {
    const { status, output } = run({ ...FILES, "Other.tsx": `import { Entity } from "@rge/runtime/jsx";\nexport function Enemy() { return <Entity name="Other" />; }` }, { "good.json": GOOD });
    assert.equal(status, 1);
    assert.match(output, /RGE1206: Exported component 'Enemy' is also exported from/);
    assert.match(output, /skipped scene validation/);
  });
});
