/**
 * M3: the `transform` attribute and refs: lowering, diagnostics, type-checking
 * of generated code, and runtime behaviour. Position is ordinary state written
 * to `transform={{ ... }}`; there is no `useTransform` hook.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, Transform, World, createInputState } from "@rge/runtime";
import { DiagnosticCode, type ComponentIR, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const RUNNER = `
function Runner() {
  const [lives, setLives] = useState(3);
  const [x, setX] = useState(10);
  const body = useRef<Sprite>();
  onUpdate((dt) => {
    setX((previous) => previous + 60 * dt);
    body.current.image = x > 100 ? "run.png" : "idle.png";
  });
  onCollisionEnter(() => setLives((n) => n - 1));
  return (
    <Entity name="Runner" transform={{ x, y: -5, rotation: x / 100, scaleX: 2 }}>
      <Sprite ref={body} image="idle.png" />
      <Sprite image={lives > 0 ? "alive.png" : "dead.png"} />
      <Entity name="shadow" transform={{ y: 4 }} />
    </Entity>
  );
}
`;

const GHOST = `
function Ghost() {
  const [visible, setVisible] = useState(true);
  const aura = useRef<Sprite>();
  onInput((input) => {
    if (input.pressed("Space")) setVisible((v) => !v);
  });
  onUpdate(() => {
    if (aura.current) {
      aura.current.image = "pulse.png";
    }
  });
  return (
    <Entity name="Ghost">
      {visible && <Sprite ref={aura} image="aura.png" />}
    </Entity>
  );
}
`;

interface RunnerInstance extends Entity {
  lives: number;
  x: number;
  readonly body: Sprite;
  readonly sprite: Sprite;
  readonly entity: Entity;
}
interface GhostInstance extends Entity {
  aura: Sprite | null;
}

let Runner: new () => RunnerInstance;
let Ghost: new () => GhostInstance;

before(async () => {
  ({ Runner } = await load<{ Runner: typeof Runner }>(compile(RUNNER, "Runner.tsx")));
  ({ Ghost } = await load<{ Ghost: typeof Ghost }>(compile(GHOST, "Ghost.tsx")));
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
    assert.deepEqual(x.dependencies, ["Runner.x"]);
    assert.ok(!c.root.props.some((p) => p.name === "transform"), "transform is not a prop");
    const shadow = c.root.children[2]!.element;
    assert.deepEqual(shadow.transform.map((p) => [p.name, p.kind]), [["y", "StaticProp"]]);
    assert.ok(!c.hooks.some((h) => (h.kind as string) === "UseTransform"));
  });

  it("lowers ref writes to Assign statements with a RefProperty target", () => {
    const hook = ir(RUNNER).hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const [a, b] = hook.handler.body as [StatementIR, StatementIR];
    assert.ok(a.kind === "SetState");
    assert.ok(b.kind === "Assign" && b.operator === "=" && b.target.kind === "RefProperty" && b.target.property === "image");
  });

  it("resolves a ref to its element, whose field takes the ref's name", () => {
    const c = ir(RUNNER);
    assert.equal(c.refs.length, 1);
    const ref = c.refs[0]!;
    const first = c.root.children[0]!.element;
    assert.equal(ref.target, first.id);
    assert.equal(ref.name, "body");
    assert.equal(first.fieldName, "body");
    assert.equal(c.root.children[1]!.element.fieldName, "sprite"); // unnamed elements keep generated names
    assert.ok(!first.props.some((p) => p.name === "ref"), "ref is not a prop");
  });

  it("lowers `r.current` to RefRead", () => {
    const hook = ir(GHOST).hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const stmt = hook.handler.body[0]!;
    assert.ok(stmt.kind === "If" && stmt.test.kind === "RefRead");
  });
});

describe("M3: generated code", () => {
  it("sets static transform fields once and dynamic ones in render", () => {
    const { code } = compile(RUNNER);
    const constructor = code.slice(code.indexOf("constructor()"), code.indexOf("setLives("));
    assert.match(constructor, /this\.transform\.y = -5;/);
    assert.match(constructor, /this\.transform\.scaleX = 2;/);
    assert.match(constructor, /this\.entity\.transform\.y = 4;\n\s*this\.addChild\(this\.entity\);/, "a child's transform is set before it is attached");
    const render = code.slice(code.indexOf("override render"));
    assert.match(render, /this\.transform\.x = this\.x;/);
    assert.match(render, /this\.transform\.rotation = \(?this\.x \/ 100\)?;/);
    assert.doesNotMatch(render, /transform\.y/, "static fields are not re-applied");
    assert.match(code, /readonly body: Sprite = new Sprite/);
    assert.match(code, /this\.body\.image = /);
  });

  it("type-checks", () => {
    assert.deepEqual(typeCheck(compile(RUNNER)), []);
    assert.deepEqual(typeCheck(compile(GHOST)), []);
  });

  it("forces a null check for a ref to a conditional element", () => {
    const unchecked = compile(`
function Bad() {
  const [on, setOn] = useState(true);
  const aura = useRef<Sprite>();
  onUpdate(() => { aura.current.image = "x.png"; });
  return <Entity name="Bad">{on && <Sprite ref={aura} image="a.png" />}</Entity>;
}`);
    assert.deepEqual(typeCheck(unchecked).map((d) => d.code), [DiagnosticCode.GeneratedTypeError]);
  });
});

describe("M3: runtime behaviour", () => {
  it("applies the transform at construction and leaves unset fields at the defaults", () => {
    const runner = new Runner();
    assert.ok(runner.transform instanceof Transform);
    assert.deepEqual({ ...runner.transform }, { x: 10, y: -5, rotation: 0.1, scaleX: 2, scaleY: 1 });
    assert.deepEqual({ ...runner.entity.transform }, { x: 0, y: 4, rotation: 0, scaleX: 1, scaleY: 1 });
    assert.deepEqual({ ...new Entity().transform }, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
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

  it("a ref write goes to the same instance and does not render by itself", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    const body = runner.body;
    world.tick(1); // x 10 → 70; the write saw 10
    assert.equal(body.image, "idle.png");
    world.tick(1); // the write sees 70
    world.tick(1); // the write sees 130
    assert.equal(runner.body, body, "identity preserved");
    assert.equal(body.image, "run.png");
  });

  it("a conditional <Entity> gets its transform when it mounts and keeps it in sync", async () => {
    const { Spawner } = await load<{ Spawner: new () => Entity & { setOn: (v: boolean) => void; setY: (v: number) => void; marker: Entity | null } }>(
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

  it("a ref to a conditional element is null after unmount and the handler skips it", () => {
    const world = new World();
    const ghost = new Ghost();
    world.mount(ghost);
    const aura = ghost.aura;
    assert.ok(aura);
    world.tick(0.1);
    assert.equal(aura.image, "pulse.png");

    const space = createInputState({ pressed: ["Space"] });
    world.tick(0.1, space);
    assert.equal(ghost.aura, null);
    assert.doesNotThrow(() => world.tick(0.1));

    world.tick(0.1, space);
    assert.ok(ghost.aura && ghost.aura !== aura, "a remounted element is a new instance");
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
      "<Entity transform={{ z: 1 }} />",
      "<Entity transform={{ x: 1, x: 2 }} />",
      "<Entity transform={5} />",
      "<Entity transform=\"x\" />",
      "<Entity transform={{ ...other }} />",
      "<Entity transform={{ [\"x\"]: 1 }} />",
      "<Sprite image=\"a\" transform={{ x: 1 }} />",
      "<Child transform={{ x: 1 }} />",
    ]) {
      assert.ok(jsxCodes(jsx).includes(DiagnosticCode.InvalidTransformAttribute), jsx);
    }
    assert.ok(jsxCodes("<Entity transform={{ x: 1 }} transform={{ y: 1 }} />").includes(DiagnosticCode.UnsupportedAttribute));
  });

  it("points useTransform at the transform attribute", () => {
    const diagnostics = compileErrors(`function C() { const t = useTransform({ x: 0 }); return <Entity name="C" />; }`);
    const removed = diagnostics.find((d) => d.code === DiagnosticCode.UnknownHook);
    assert.ok(removed);
    assert.match(removed.message, /transform=\{\{ x, y \}\}/);
  });

  it("rejects a ref write to a property JSX sets from state", () => {
    const conflicting = jsxCodes(
      "<Sprite ref={s} image={n > 0 ? \"a\" : \"b\"} />",
      "const s = useRef<Sprite>(); onUpdate(() => { s.current.image = \"c\"; });",
    );
    assert.deepEqual(conflicting, [DiagnosticCode.ConflictingRefWrite]);
    // A static prop may be overridden imperatively.
    assert.doesNotThrow(() =>
      compile(`function C() { const s = useRef<Sprite>(); onUpdate(() => { s.current.image = "c"; }); return <Entity name="C"><Sprite ref={s} image="a" /></Entity>; }`),
    );
  });

  it("rejects hooks that are not at the top level", () => {
    assert.ok(codes("onUpdate(() => { const r = useRef<Sprite>(); });").includes(DiagnosticCode.HookNotAtTopLevel));
  });

  it("rejects ref reads outside handlers", () => {
    const jsx = compileErrors(`
function C() {
  const r = useRef<Sprite>();
  return <Entity name="C"><Sprite ref={r} image="a" /><Sprite image={r.current.image} /></Entity>;
}`);
    assert.deepEqual(jsx.map((d) => d.code), [DiagnosticCode.HandleReadOutsideHandler]);
  });

  it("rejects unattached, doubly attached, mistyped and root refs", () => {
    const body = (extra: string, jsx: string) => compileErrors(`
function C() {
  ${extra}
  return <Entity name="C">${jsx}</Entity>;
}`).map((d) => d.code);
    assert.deepEqual(body("const r = useRef<Sprite>();", "<Sprite image=\"a\" />"), [DiagnosticCode.InvalidUseRef]);
    assert.deepEqual(body("const r = useRef<Sprite>();", "<Sprite ref={r} image=\"a\" /><Sprite ref={r} image=\"b\" />"), [DiagnosticCode.InvalidUseRef]);
    assert.deepEqual(body("const r = useRef<Collider>();", "<Sprite ref={r} image=\"a\" />"), [DiagnosticCode.InvalidUseRef, DiagnosticCode.InvalidUseRef]);
    assert.deepEqual(body("const r = useRef<Sprite>();", "<Sprite ref={other} image=\"a\" />").includes(DiagnosticCode.InvalidUseRef), true);
    assert.deepEqual(
      compileErrors(`function C() { const r = useRef<Entity>(); return <Entity ref={r} name="C" />; }`).map((d) => d.code),
      [DiagnosticCode.InvalidUseRef, DiagnosticCode.InvalidUseRef],
    );
  });

  it("rejects malformed useRef calls", () => {
    for (const extra of ["const r = useRef();", "const r = useRef<Sprite>(null);", "const r = useRef<Nope>();", "const r = useRef<number>();"]) {
      assert.ok(codes("", extra).includes(DiagnosticCode.InvalidUseRef), extra);
    }
  });

  it("rejects ref names that collide with state", () => {
    assert.ok(codes("", "const n = useRef<Sprite>();").includes(DiagnosticCode.InvalidUseRef));
  });

  it("rejects bad uses of a ref, and assignments to anything else", () => {
    const r = "const r = useRef<Sprite>();";
    const attach = (c: string[]) => c.filter((x) => x !== DiagnosticCode.InvalidUseRef);
    assert.deepEqual(attach(codes("onUpdate(() => { const q = r; });", r)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.other = 1; });", r)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.current.nope = 1; });", r)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.current = 1; });", r)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.current.image ||= \"a\"; });", r)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("onUpdate(() => { n = 2; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(attach(codes("onUpdate(() => { const r = 1; });", r)), [DiagnosticCode.InvalidHandler]);
  });
});
