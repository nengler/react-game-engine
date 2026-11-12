/**
 * M3: the `transform` attribute and value refs: lowering, diagnostics,
 * type-checking of generated code, and runtime behaviour. Position is ordinary
 * state written to `transform={{ ... }}`; refs hold values that never render.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, GameObject, Sprite, Transform, World } from "@rge/runtime";
import { runtimeManifest } from "@rge/runtime";
import { Compiler, DiagnosticCode, type ComponentIR, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck, withAuthoringImports, elementOf } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const RUNNER = `
function Runner() {
  const [lives, setLives] = useState(3);
  const [x, setX] = useState(10);
  const [laps, setLaps] = useState(0);
  const travelled = useRef(0);
  useUpdate((dt) => {
    setX((x) => x + 60 * dt);
    travelled.current += 60 * dt;
    if (travelled.current >= 100) {
      travelled.current -= 100;
      setLaps((laps) => laps + 1);
    }
  });
  return (
    <Entity name="Runner" transform={{ x, y: -5, rotation: x / 100, scaleX: 2 }}>
      <Sprite image={x > 100 ? "run.png" : "idle.png"} />
      <Sprite image={lives > 0 ? "alive.png" : "dead.png"} />
      <Entity name="shadow" transform={{ y: 4 }} />
      <Collider width={4} height={4} onCollisionEnter={() => setLives((n) => n - 1)} />
    </Entity>
  );
}
`;

const TIMER = `
function Timer() {
  const elapsed = useRef(0);
  const label = useRef<string>("");
  useUpdate((dt) => {
    elapsed.current += dt;
    label.current = \`t=\${elapsed.current}\`;
  });
  return <Entity name="Timer" />;
}
`;

interface RunnerInstance extends Entity {
  lives: number;
  x: number;
  laps: number;
  travelled: number;
  readonly sprite: Sprite;
  readonly entity: Entity;
}
interface TimerInstance extends Entity {
  elapsed: number;
  label: string;
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

function codes(body: string, extra = ""): string[] {
  return compileErrors(`
function C() {
  const [n, setN] = useState(0);
  ${extra}
  ${body}
  return <Entity name="C"><Sprite image="a.png" /></Entity>;
}`).map((d) => d.code);
}

describe("M3: IR shape", () => {
  it("lowers the transform attribute to static and dynamic transform props", () => {
    const c = ir(RUNNER);
    assert.deepEqual(
      c.root.transform.map((p) => [p.name, p.kind]),
      [["x", "DynamicProp"], ["y", "StaticProp"], ["rotation", "DynamicProp"], ["scaleX", "StaticProp"]],
    );
    const x = c.root.transform[0]!;
    assert.ok(x.kind === "DynamicProp" && x.value.kind === "StateRead");
    assert.deepEqual(x.dependencies, [{ kind: "State", state: "Runner.x" }]);
    assert.ok(!c.root.props.some((p) => p.name === "transform"), "transform is not a prop");
    const shadow = elementOf(c.root.children[2]!);
    assert.deepEqual(shadow.transform.map((p) => [p.name, p.kind]), [["y", "StaticProp"]]);
  });

  it("lowers useRef to a typed value with an initial value", () => {
    assert.deepEqual(
      ir(RUNNER).refs.map((r) => [r.name, r.type, r.initialValue]),
      [["travelled", { kind: "Primitive", name: "number" }, { kind: "NumberLiteral", value: 0 }]],
    );
    assert.deepEqual(ir(TIMER).refs.map((r) => [r.name, r.type]), [["elapsed", { kind: "Primitive", name: "number" }], ["label", { kind: "Primitive", name: "string" }]]);
  });

  it("lowers `.current` writes to Assign and reads to RefRead", () => {
    const hook = ir(RUNNER).hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const [, write, check] = hook.handler.body as [StatementIR, StatementIR, StatementIR];
    assert.ok(write.kind === "Assign" && write.operator === "+=" && write.target.kind === "RefCurrent");
    assert.ok(check.kind === "If" && check.test.kind === "Binary" && check.test.left.kind === "RefRead");
  });
});

describe("M3: generated code", () => {
  it("sets static transform fields once and dynamic ones in render", () => {
    const { code } = compile(RUNNER);
    const constructor = code.slice(code.indexOf("constructor()"), code.indexOf("override render"));
    assert.match(constructor, /this\.transform\.y = -5;/);
    assert.match(constructor, /this\.transform\.scaleX = 2;/);
    assert.match(constructor, /this\.entity\.transform\.y = 4;\n\s*this\.addChild\(this\.entity\);/, "a child's transform is set before it is attached");
    const render = code.slice(code.indexOf("override render"));
    assert.match(render, /const (\$\d+) = this\.x;[^]*?this\.transform\.x = \1;/);
    assert.match(render, /const (\$\d+) = \(?this\.x \/ 100\)?;[^]*?this\.transform\.rotation = \1;/);
    assert.doesNotMatch(render, /transform\.y/, "static fields are not re-applied");
  });

  it("emits a ref as a plain field read and written directly, with no dirty marking", () => {
    const { code } = compile(TIMER);
    assert.match(code, /^  elapsed: number = 0;$/m);
    assert.match(code, /^  label: string = "";$/m);
    assert.match(code, /this\.elapsed \+= dt;/);
    assert.doesNotMatch(code, /markDirty|override render/);
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(RUNNER)), []);
    assert.deepEqual(typeCheck(compile(TIMER)), []);
  });
});

describe("M3: runtime behaviour", () => {
  it("applies the transform at construction and leaves unset fields at the defaults", () => {
    const runner = new Runner();
    assert.ok(runner.transform instanceof Transform);
    assert.deepEqual({ ...runner.transform }, { x: 10, y: -5, z: 0, rotation: 0.1, scaleX: 2, scaleY: 1, global: false });
    assert.deepEqual({ ...runner.entity.transform }, { x: 0, y: 4, z: 0, rotation: 0, scaleX: 1, scaleY: 1, global: false });
    assert.deepEqual({ ...new Entity().transform }, { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1, global: false });
  });

  it("moving is a state change: one render per tick, in place", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    const transform = runner.transform;
    assert.equal(world.tick(1), 1);
    assert.equal(runner.x, 70);
    assert.equal(runner.transform.x, 70);
    assert.equal(runner.transform.rotation, 0.7);
    assert.equal(runner.transform.y, -5);
    assert.equal(runner.transform, transform, "the transform object is never replaced");
    assert.equal(world.tick(1), 1);
    assert.equal(runner.transform.x, 130);
  });

  it("ref writes never render, and persist across frames", () => {
    const world = new World();
    const timer = new Timer();
    world.mount(timer);
    assert.equal(world.tick(0.5), 0);
    assert.equal(world.tick(0.25), 0);
    assert.equal(timer.elapsed, 0.75);
    assert.equal(timer.label, "t=0.75", "a ref read after a write in the same handler sees the write");
  });

  it("refs can gate state changes without rendering in between", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    world.tick(1); // travelled 60: no lap
    assert.equal(runner.laps, 0);
    world.tick(1); // travelled 120 → a lap, 20 carried over
    assert.equal(runner.laps, 1);
    assert.equal(runner.travelled, 20);
  });

  it("a conditional <Entity> gets its transform when it mounts and keeps it in sync", async () => {
    const { Spawner } = await load<{ Spawner: new () => Entity & { setOn: (v: boolean) => void; setY: (v: number) => void } }>(
      compile(`function Spawner() {
  const [on, setOn] = useState(false);
  const [y, setY] = useState(3);
  return <Entity name="S">{on && <Entity name="marker" transform={{ x: 7, y }} />}</Entity>;
}`),
    );
    const world = new World();
    const spawner = new Spawner();
    world.mount(spawner);
    spawner.setOn(true);
    world.flush();
    const marker = spawner.children[0] as Entity;
    assert.deepEqual([marker.transform.x, marker.transform.y], [7, 3]);
    spawner.setY(9);
    world.flush();
    assert.equal(spawner.children[0], marker);
    assert.equal(marker.transform.y, 9);
  });

  it("child transforms are relative to the parent unless `global`", async () => {
    const { Ship } = await load<{ Ship: new () => Entity & { setX: (v: number) => void; setPinned: (v: boolean) => void; entity: Entity; entity2: Entity } }>(
      compile(`function Ship() {
  const [x, setX] = useState(100);
  const [pinned, setPinned] = useState(true);
  return (
    <Entity name="Ship" transform={{ x, y: 50 }}>
      <Entity name="turret" transform={{ x: 10 }} />
      <Entity name="hud" transform={{ x: 5, y: 5, global: pinned }} />
    </Entity>
  );
}`),
    );
    const world = new World();
    const ship = new Ship();
    world.mount(ship);
    const turret = ship.entity;
    const hud = ship.entity2;
    assert.deepEqual([turret.worldTransform().x, turret.worldTransform().y], [110, 50]);
    assert.deepEqual([hud.worldTransform().x, hud.worldTransform().y], [5, 5]);

    ship.setX(200);
    world.flush();
    assert.equal(turret.worldTransform().x, 210, "the child follows its parent");
    assert.equal(hud.worldTransform().x, 5, "a global child does not");

    ship.setPinned(false);
    world.flush();
    assert.deepEqual([hud.worldTransform().x, hud.worldTransform().y], [205, 55], "`global` can come from state");
  });

  it("places built-in elements too: a Sprite's transform is relative to its parent", async () => {
    const compiled = compile(`function Coin() {
  const [bob, setBob] = useState(0);
  return (
    <Entity name="Coin" transform={{ x: 50, y: 20 }}>
      <Sprite image="coin.png" transform={{ y: bob, rotation: 0.5 }} />
      <Collider width={8} height={8} transform={{ x: -4, y: -4 }} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Coin } = await load<{ Coin: new () => Entity & { setBob: (v: number) => void; sprite: Sprite; collider: GameObject } }>(compiled);
    const world = new World();
    const coin = new Coin();
    world.mount(coin);
    assert.deepEqual([coin.sprite.worldTransform().x, coin.sprite.worldTransform().y, coin.sprite.worldTransform().rotation], [50, 20, 0.5]);
    assert.deepEqual([coin.collider.worldTransform().x, coin.collider.worldTransform().y], [46, 16]);
    coin.setBob(3);
    world.flush();
    assert.equal(coin.sprite.worldTransform().y, 23);
  });

  it("type-checks `global` as a boolean", () => {
    const bad = compile(`function C() { return <Entity name="C" transform={{ global: 1 }} />; }`);
    assert.deepEqual(typeCheck(bad).map((d) => d.code), [DiagnosticCode.GeneratedTypeError]);
  });
});

describe("M3: diagnostics", () => {
  const jsxCodes = (jsx: string, extra = "") =>
    compileErrors(`
function Child() { return <Entity name="Child" />; }
function C() {
  const [n, setN] = useState(0);
  ${extra}
  return <Entity name="C">${jsx}</Entity>;
}`).map((d) => d.code);

  it("rejects malformed transform attributes", () => {
    for (const jsx of [
      "<Entity transform={{ w: 1 }} />",
      "<Entity transform={{ x: 1, x: 2 }} />",
      "<Entity transform={5} />",
      "<Entity transform=\"x\" />",
      "<Entity transform={{ ...other }} />",
      "<Entity transform={{ [\"x\"]: 1 }} />",
    ]) {
      assert.ok(jsxCodes(jsx).includes(DiagnosticCode.InvalidTransformAttribute), jsx);
    }
    assert.ok(jsxCodes("<Entity transform={{ x: 1 }} transform={{ y: 1 }} />").includes(DiagnosticCode.UnsupportedAttribute));
  });

  it("rejects the attribute on an intrinsic the manifest does not list as transformable", () => {
    const compiler = new Compiler({ manifest: { ...runtimeManifest, transformIntrinsics: ["Entity"] } });
    try {
      const result = compiler.compile("C.tsx", withAuthoringImports(`function C() { return <Entity name="C"><Sprite image="a" transform={{ x: 1 }} /></Entity>; }`));
      assert.deepEqual(result.diagnostics.map((d) => d.code), [DiagnosticCode.InvalidTransformAttribute]);
    } finally {
      compiler.close();
    }
  });

  it("points useTransform at the transform attribute", () => {
    const diagnostics = compileErrors(`function C() { const t = useTransform({ x: 0 }); return <Entity name="C" />; }`);
    const removed = diagnostics.find((d) => d.code === DiagnosticCode.UnknownHook);
    assert.ok(removed);
    assert.match(removed.message, /transform=\{\{ x, y \}\}/);
  });

  it("rejects `ref={…}` on any element: refs hold values, not elements", () => {
    assert.deepEqual(jsxCodes("<Sprite ref={r} image=\"a\" />", "const r = useRef(0);"), [DiagnosticCode.InvalidUseRef]);
    assert.deepEqual(jsxCodes("<Child ref={r} />", "const r = useRef(0);"), [DiagnosticCode.InvalidUseRef]);
    assert.ok(
      compileErrors(`function C() { const r = useRef(0); return <Entity ref={r} name="C" />; }`).some((d) => d.code === DiagnosticCode.InvalidUseRef),
    );
  });

  it("rejects malformed useRef calls", () => {
    for (const extra of [
      "const r = useRef();",
      "const r = useRef(1, 2);",
      "const r = useRef<Sprite>(null);",
      "const r = useRef(null);",
      "const r = useRef(n);",
      "let r = useRef(0);",
      "const { current } = useRef(0);",
    ]) {
      assert.ok(codes("", extra).includes(DiagnosticCode.InvalidUseRef), extra);
    }
    // As with useState, a type argument that disagrees with the initial value fails the type-check.
    const mismatched = compile(`function C() { const r = useRef<number>("a"); return <Entity name="C" />; }`);
    assert.deepEqual(typeCheck(mismatched).map((d) => d.code), [DiagnosticCode.GeneratedTypeError]);
  });

  it("rejects hooks that are not at the top level", () => {
    assert.ok(codes("useUpdate(() => { const r = useRef(0); });").includes(DiagnosticCode.HookNotAtTopLevel));
  });

  it("rejects `.current` reads outside handlers: in JSX, state initialisers and derived consts", () => {
    const outside = (body: string) => compileErrors(`function C() {
  const r = useRef(0);
  ${body}
}`).map((d) => d.code);
    assert.deepEqual(outside(`return <Entity name="C"><Sprite image={r.current > 0 ? "a" : "b"} /></Entity>;`), [DiagnosticCode.HandleReadOutsideHandler]);
    assert.deepEqual(outside(`const [n] = useState(r.current); return <Entity name="C" />;`), [DiagnosticCode.HandleReadOutsideHandler]);
    assert.deepEqual(outside(`const big = r.current > 5; return <Entity name="C" />;`), [DiagnosticCode.HandleReadOutsideHandler]);
  });

  it("rejects ref names that collide with state", () => {
    assert.ok(codes("", "const n = useRef(0);").includes(DiagnosticCode.InvalidUseRef));
  });

  it("rejects bad uses of a ref, and assignments to anything else", () => {
    const r = "const r = useRef(0);";
    assert.deepEqual(codes("useUpdate(() => { const q = r; });", r), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => { r.other = 1; });", r), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => { r = 1; });", r), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { r.current |= 1; });", r), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { n = 2; });"), [DiagnosticCode.UnsupportedStatement]);
  });
});
