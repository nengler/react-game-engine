/**
 * A built-in's transform props (`x`, `y`, `rotation`, `global`, …): lowering, diagnostics, type-checking of generated code, and
 * runtime behaviour. Position is ordinary state written to those props. There is no `transform` attribute; a component is placed
 * by an <Entity> around it.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, GameObject, Sprite, Transform, World, runtimeManifest } from "@tsengine/runtime";

import { Compiler, DiagnosticCode, type ComponentIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck, withAuthoringImports, elementOf } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const RUNNER = `
function Runner() {
  const s = useMutable({ lives: 3, x: 10, laps: 0, travelled: 0 });
  useUpdate((dt) => {
    s.x += 60 * dt;
    s.travelled += 60 * dt;
    if (s.travelled >= 100) {
      s.travelled -= 100;
      s.laps += 1;
    }
  });
  return (
    <Entity name="Runner" x={s.x} y={-5} rotation={s.x / 100} scaleX={2}>
      <Sprite image={s.x > 100 ? "run.png" : "idle.png"} />
      <Sprite image={s.lives > 0 ? "alive.png" : "dead.png"} />
      <Entity name="shadow" y={4} />
      <Collider width={4} height={4} onCollisionEnter={() => { s.lives -= 1; }} />
    </Entity>
  );
}
`;

const TIMER = `
function Timer() {
  const s = useMutable({ elapsed: 0, label: "" as string });
  useUpdate((dt) => {
    s.elapsed += dt;
    s.label = \`t=\${s.elapsed}\`;
  });
  return <Entity name="Timer" />;
}
`;

interface RunnerInstance extends Entity {
  readonly sprite: Sprite;
  readonly entity: Entity;
  s: { x: number; lives: number; travelled: number; laps: number };
}
interface TimerInstance extends Entity {
  s: { elapsed: number; label: string };
}

let Runner: new () => RunnerInstance;
let Timer: new () => TimerInstance;

before(async () => {
  ({ Runner } = await load<{ Runner: typeof Runner }>(compile(RUNNER, "Runner.tsx")));
  ({ Timer } = await load<{ Timer: typeof Timer }>(compile(TIMER, "Timer.tsx")));
});

function ir(source: string): ComponentIR {
  return compile(source).ir.components[0]!;
}

describe("transform: IR shape", () => {
  it("lowers the transform attribute to static and dynamic transform props", () => {
    const c = ir(RUNNER);
    assert.deepEqual(
      c.root.transform.map((p) => [p.name, p.kind]),
      [
        ["x", "DynamicProp"],
        ["y", "StaticProp"],
        ["rotation", "DynamicProp"],
        ["scaleX", "StaticProp"],
      ]
    );
    const x = c.root.transform[0]!;
    assert.ok(x.kind === "DynamicProp" && x.value.kind === "StateRead");
    assert.deepEqual(x.dependencies, [{ kind: "State", state: "Runner.s.x" }]);
    assert.ok(!c.root.props.some((p) => p.name === "transform"), "transform is not a prop");
    const shadow = elementOf(c.root.children[2]!);
    assert.deepEqual(
      shadow.transform.map((p) => [p.name, p.kind]),
      [["y", "StaticProp"]]
    );
  });
});

describe("transform: generated code", () => {
  it("sets static transform fields once and dynamic ones in render", () => {
    const { code } = compile(RUNNER);
    const constructor = code.slice(code.indexOf("constructor()"), code.indexOf("override render"));
    assert.match(constructor, /this\.transform\.y = -5;/);
    assert.match(constructor, /this\.transform\.scaleX = 2;/);
    assert.match(
      constructor,
      /this\.entity\.transform\.y = 4;\n\s*this\.addChild\(this\.entity\);/,
      "a child's transform is set before it is attached"
    );
    const render = code.slice(code.indexOf("override render"));
    assert.match(render, /const (\$\d+)(?:: [^=]+)? = this\.\$s_x;[^]*?this\.transform\.x = \1;/);
    assert.match(render, /const (\$\d+)(?:: [^=]+)? = \(?this\.\$s_x \/ 100\)?;[^]*?this\.transform\.rotation = \1;/);
    assert.doesNotMatch(render, /transform\.y/, "static fields are not re-applied");
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(RUNNER)), []);
    assert.deepEqual(typeCheck(compile(TIMER)), []);
  });
});

describe("transform: runtime behaviour", () => {
  it("applies the transform at construction and leaves unset fields at the defaults", () => {
    const runner = new Runner();
    assert.ok(runner.transform instanceof Transform);
    assert.deepEqual({ ...runner.transform }, { x: 10, y: -5, z: 0, rotation: 0.1, scaleX: 2, scaleY: 1, global: false, opacity: 1 });
    assert.deepEqual({ ...runner.entity.transform }, { x: 0, y: 4, z: 0, rotation: 0, scaleX: 1, scaleY: 1, global: false, opacity: 1 });
    assert.deepEqual({ ...new Entity().transform }, { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, global: false, opacity: 1 });
  });

  it("moving is a state change: one render per tick, in place", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    const transform = runner.transform;
    assert.equal(world.tick(1), 1);
    assert.equal(runner.s.x, 70);
    assert.equal(runner.transform.x, 70);
    assert.equal(runner.transform.rotation, 0.7);
    assert.equal(runner.transform.y, -5);
    assert.equal(runner.transform, transform, "the transform object is never replaced");
    assert.equal(world.tick(1), 1);
    assert.equal(runner.transform.x, 130);
  });

  it("a field nothing renders persists across frames, and a handler reads its own write", () => {
    const world = new World();
    const timer = new Timer();
    world.mount(timer);
    assert.equal(world.tick(0.5), 1, "a write marks the component, which renders nothing new");
    assert.equal(world.tick(0.25), 1);
    assert.equal(timer.s.elapsed, 0.75);
    assert.equal(timer.s.label, "t=0.75", "a read after a write in the same handler sees the write");
  });

  it("a conditional <Entity> gets its transform when it mounts and keeps it in sync", async () => {
    const { Spawner } = await load<{ Spawner: new () => Entity & { s: { on: boolean; y: number } } }>(
      compile(`function Spawner() {
  const s = useMutable({ on: false, y: 3 });
  return <Entity name="S">{s.on && <Entity name="marker" x={7} y={s.y} />}</Entity>;
}`)
    );
    const world = new World();
    const spawner = new Spawner();
    world.mount(spawner);
    spawner.s.on = true;
    world.flush();
    const marker = spawner.children[0] as Entity;
    assert.deepEqual([marker.transform.x, marker.transform.y], [7, 3]);
    spawner.s.y = 9;
    world.flush();
    assert.equal(spawner.children[0], marker);
    assert.equal(marker.transform.y, 9);
  });

  it("child transforms are relative to the parent unless `global`", async () => {
    const { Ship } = await load<{ Ship: new () => Entity & { s: { x: number; pinned: boolean }; entity: Entity; entity2: Entity } }>(
      compile(`function Ship() {
  const s = useMutable({ x: 100, pinned: true });
  return (
    <Entity name="Ship" x={s.x} y={50}>
      <Entity name="turret" x={10} />
      <Entity name="hud" x={5} y={5} global={s.pinned} />
    </Entity>
  );
}`)
    );
    const world = new World();
    const ship = new Ship();
    world.mount(ship);
    const turret = ship.entity;
    const hud = ship.entity2;
    assert.deepEqual([turret.worldTransform().x, turret.worldTransform().y], [110, 50]);
    assert.deepEqual([hud.worldTransform().x, hud.worldTransform().y], [5, 5]);

    ship.s.x = 200;
    world.flush();
    assert.equal(turret.worldTransform().x, 210, "the child follows its parent");
    assert.equal(hud.worldTransform().x, 5, "a global child does not");

    ship.s.pinned = false;
    world.flush();
    assert.deepEqual([hud.worldTransform().x, hud.worldTransform().y], [205, 55], "`global` can come from state");
  });

  it("places built-in elements too: a Sprite's transform is relative to its parent", async () => {
    const compiled = compile(`function Coin() {
  const s = useMutable({ bob: 0 });
  return (
    <Entity name="Coin" x={50} y={20}>
      <Sprite image="coin.png" y={s.bob} rotation={0.5} />
      <Collider width={8} height={8} x={-4} y={-4} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Coin } = await load<{ Coin: new () => Entity & { s: { bob: number }; sprite: Sprite; collider: GameObject } }>(compiled);
    const world = new World();
    const coin = new Coin();
    world.mount(coin);
    assert.deepEqual(
      [coin.sprite.worldTransform().x, coin.sprite.worldTransform().y, coin.sprite.worldTransform().rotation],
      [50, 20, 0.5]
    );
    assert.deepEqual([coin.collider.worldTransform().x, coin.collider.worldTransform().y], [46, 16]);
    coin.s.bob = 3;
    world.flush();
    assert.equal(coin.sprite.worldTransform().y, 23);
  });

  it("type-checks `global` as a boolean", () => {
    const bad = compile(`function C() { return <Entity name="C" global={1} />; }`);
    assert.deepEqual(
      typeCheck(bad).map((d) => d.code),
      [DiagnosticCode.GeneratedTypeError]
    );
  });
});

describe("transform: diagnostics", () => {
  const jsxCodes = (jsx: string, extra = "") =>
    compileErrors(`
function Child() { return <Entity name="Child" />; }
function C() {
  const s = useMutable({ n: 0 });
  ${extra}
  return <Entity name="C">${jsx}</Entity>;
}`).map((d) => d.code);

  it("rejects a transform attribute, whatever it holds", () => {
    for (const jsx of [
      "<Entity transform={{ x: 1 }} />",
      "<Entity transform={5} />",
      '<Entity transform="x" />',
      "<Entity transform={{ ...other }} />",
      '<Entity transform={{ ["x"]: 1 }} />',
    ]) {
      assert.ok(jsxCodes(jsx).includes(DiagnosticCode.InvalidTransformAttribute), jsx);
    }
    assert.ok(jsxCodes("<Entity x={1} x={2} />").includes(DiagnosticCode.UnsupportedAttribute), "a prop written twice");
  });

  it("rejects the attribute on an intrinsic the manifest does not list as transformable", () => {
    const compiler = new Compiler({ manifest: { ...runtimeManifest, transformIntrinsics: ["Entity"] } });
    try {
      const result = compiler.compile(
        "C.tsx",
        withAuthoringImports(`function C() { return <Entity name="C"><Sprite image="a" x={1} /></Entity>; }`)
      );
      assert.deepEqual(
        result.diagnostics.map((d) => d.code),
        [DiagnosticCode.InvalidTransformAttribute]
      );
    } finally {
      compiler.close();
    }
  });

  it("points useTransform at the x and y props", () => {
    const diagnostics = compileErrors(`function C() { const t = useTransform({ x: 0 }); return <Entity name="C" />; }`);
    const removed = diagnostics.find((d) => d.code === DiagnosticCode.UnknownHook);
    assert.ok(removed);
    assert.match(removed.message, /<Entity x=\{s\.x\} y=\{s\.y\}>/);
  });

  it("rejects `ref={…}` on any element", () => {
    assert.deepEqual(jsxCodes('<Sprite ref={r} image="a" />', "const r = useMutable({ n: 0 });"), [DiagnosticCode.ElementRef]);
    assert.deepEqual(jsxCodes("<Child ref={r} />", "const r = useMutable({ n: 0 });"), [DiagnosticCode.ElementRef]);
    assert.ok(
      compileErrors(`function C() { const r = useMutable({ n: 0 }); return <Entity ref={r} name="C" />; }`).some(
        (d) => d.code === DiagnosticCode.ElementRef
      )
    );
  });

  it("a type that disagrees with the initial value fails the type-check", () => {
    const mismatched = compile(`function C() { const s = useMutable({ r: "a" as number }); return <Entity name="C" />; }`);
    assert.deepEqual(
      typeCheck(mismatched).map((d) => d.code),
      [DiagnosticCode.GeneratedTypeError]
    );
  });
});

describe("placing a component", () => {
  const SCENE = `
function Mover() {
  const s = useMutable({ x: 0 });
  return <Entity name="Mover" x={s.x} />;
}
function Scene() {
  const s = useMutable({ spawn: 50, pinned: false });
  return (
    <Entity name="Scene" x={100}>
      <Entity x={s.spawn} y={5} global={s.pinned}>
        <Mover />
      </Entity>
    </Entity>
  );
}`;

  it("refuses a transform attribute on a component, naming the wrapper to write", () => {
    const found = compileErrors(`
function Mover() { return <Entity name="Mover" />; }
function Scene() { return <Entity name="Scene"><Mover transform={{ x: 5 }} /></Entity>; }`);
    const placed = found.find((d) => d.code === DiagnosticCode.InvalidTransformAttribute);
    assert.ok(placed, found.map((d) => d.message).join("\n"));
    assert.match(placed.message, /<Entity x=\{…\} y=\{…\}><Mover … \/><\/Entity>/);
  });

  it("composes the wrapper's place over the child's own transform", async () => {
    const { Scene } = await load<{
      Scene: new () => Entity & { s: { spawn: number; pinned: boolean } };
    }>(compile(SCENE));
    const world = new World();
    const scene = new Scene();
    world.mount(scene);
    const wrapper = scene.children[0]!;
    const mover = wrapper.children[0] as Entity & { s: { x: number } };
    assert.deepEqual([wrapper.transform.x, wrapper.transform.y, mover.transform.x], [50, 5, 0]);
    assert.deepEqual([mover.worldTransform().x, mover.worldTransform().y], [150, 5], "scene 100 + wrapper 50, own transform 0");

    mover.s.x = 7;
    world.flush();
    assert.equal(mover.worldTransform().x, 157, "the child moves relative to where it was placed");

    scene.s.spawn = 80;
    world.flush();
    assert.equal(mover.worldTransform().x, 187, "the place follows the parent's state");

    scene.s.pinned = true;
    world.flush();
    assert.equal(mover.worldTransform().x, 87, "a global wrapper ignores the scene's transform; the child's own still applies");
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(SCENE)), []);
  });
});
