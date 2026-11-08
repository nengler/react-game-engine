/** M3: useTransform and refs: lowering, diagnostics, type-checking of generated code, and runtime behaviour. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, Transform, World } from "@rge/runtime";
import { DiagnosticCode, type ComponentIR, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const RUNNER = `
function Runner() {
  const [lives, setLives] = useState(3);
  const motion = useTransform({ x: 10, y: -5, scaleX: 2 });
  const body = useRef<Sprite>();
  onUpdate((dt) => {
    motion.x += 60 * dt;
    motion.rotation = motion.x / 100;
    body.current.image = motion.x > 100 ? "run.png" : "idle.png";
  });
  onCollisionEnter(() => setLives((n) => n - 1));
  return (
    <Entity name="Runner">
      <Sprite ref={body} image="idle.png" />
      <Sprite image={lives > 0 ? "alive.png" : "dead.png"} />
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
  readonly body: Sprite;
  readonly sprite: Sprite;
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
  it("lowers useTransform to a hook with its initial values", () => {
    const hook = ir(RUNNER).hooks.find((h) => h.kind === "UseTransform");
    assert.ok(hook?.kind === "UseTransform");
    assert.equal(hook.slot, "Runner.motion");
    assert.deepEqual(hook.initial, { x: 10, y: -5, scaleX: 2 });
  });

  it("lowers handler writes to Assign statements with transform and ref targets", () => {
    const hook = ir(RUNNER).hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(hook?.kind === "OnUpdate");
    const [a, b, c] = hook.handler.body as [StatementIR, StatementIR, StatementIR];
    assert.ok(a.kind === "Assign" && a.operator === "+=" && a.target.kind === "TransformField" && a.target.field === "x");
    assert.ok(b.kind === "Assign" && b.operator === "=" && b.value.kind === "Binary" && b.value.left.kind === "TransformRead");
    assert.ok(c.kind === "Assign" && c.target.kind === "RefProperty" && c.target.property === "image");
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
  it("binds the transform to this.transform and refs to the element field", () => {
    const { code } = compile(RUNNER);
    assert.match(code, /this\.transform\.x = 10;/);
    assert.match(code, /this\.transform\.scaleX = 2;/);
    assert.doesNotMatch(code, /this\.transform\.rotation = 0/, "only listed fields are initialised");
    assert.match(code, /readonly body: Sprite = new Sprite/);
    assert.match(code, /this\.transform\.x \+= \(?60 \* dt\)?;/);
    assert.match(code, /this\.body\.image = /);
    const onUpdate = code.slice(code.indexOf("override onUpdate"), code.indexOf("override onCollisionEnter"));
    assert.ok(onUpdate.includes("this.transform.x") && !onUpdate.includes("markDirty") && !onUpdate.includes("setLives"));
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
  it("applies initial transform values and leaves the rest at the defaults", () => {
    const runner = new Runner();
    assert.ok(runner.transform instanceof Transform);
    assert.deepEqual({ ...runner.transform }, { x: 10, y: -5, rotation: 0, scaleX: 2, scaleY: 1 });
    assert.deepEqual({ ...new Entity().transform }, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("writing the transform causes no render", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    assert.equal(world.tick(1), 0);
    assert.equal(runner.transform.x, 70);
    assert.equal(runner.transform.rotation, 0.7);
    assert.equal(runner.isDirty, false);
  });

  it("a ref write goes to the same instance and does not render", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    const body = runner.body;
    assert.equal(world.tick(1), 0);
    assert.equal(body.image, "idle.png");
    assert.equal(world.tick(1), 0);
    assert.equal(runner.body, body, "identity preserved");
    assert.equal(body.image, "run.png");
  });

  it("state changes still render once alongside transform writes", () => {
    const world = new World();
    const runner = new Runner();
    world.mount(runner);
    runner.onCollisionEnter(runner);
    assert.equal(world.tick(0.1), 1);
    assert.equal(runner.lives, 2);
    assert.equal(runner.sprite.image, "alive.png");
  });

  it("a ref to a conditional element is null after unmount and the handler skips it", () => {
    const world = new World();
    const ghost = new Ghost();
    world.mount(ghost);
    const aura = ghost.aura;
    assert.ok(aura);
    world.tick(0.1);
    assert.equal(aura.image, "pulse.png");

    world.tick(0.1, { pressed: () => true, down: () => false, released: () => false, pointerX: 0, pointerY: 0 });
    assert.equal(ghost.aura, null);
    assert.doesNotThrow(() => world.tick(0.1));

    world.tick(0.1, { pressed: () => true, down: () => false, released: () => false, pointerX: 0, pointerY: 0 });
    assert.ok(ghost.aura && ghost.aura !== aura, "a remounted element is a new instance");
  });
});

describe("M3: diagnostics", () => {
  it("rejects a second useTransform", () => {
    assert.deepEqual(codes("", "const a = useTransform(); const b = useTransform();"), [DiagnosticCode.InvalidUseTransform]);
  });

  it("rejects malformed useTransform calls", () => {
    for (const extra of [
      "const t = useTransform({ z: 1 });",
      "const t = useTransform({ x: n });",
      "const t = useTransform({ x: 1, x: 2 });",
      "const t = useTransform(5);",
      "const t = useTransform({}, {});",
      "let t = useTransform();",
      "const { x } = useTransform();",
      "const n2 = useTransform({ x: \"a\" });",
    ]) {
      assert.ok(codes("", extra).includes(DiagnosticCode.InvalidUseTransform), extra);
    }
  });

  it("rejects hooks that are not at the top level", () => {
    assert.ok(codes("onUpdate(() => { const t = useTransform(); });").includes(DiagnosticCode.HookNotAtTopLevel));
    assert.ok(codes("onUpdate(() => { const r = useRef<Sprite>(); });").includes(DiagnosticCode.HookNotAtTopLevel));
  });

  it("rejects transform and ref reads outside handlers", () => {
    const jsx = compileErrors(`
function C() {
  const t = useTransform();
  return <Entity name="C"><Sprite image={t.x > 0 ? "a.png" : "b.png"} /></Entity>;
}`);
    assert.deepEqual(jsx.map((d) => d.code), [DiagnosticCode.HandleReadOutsideHandler]);
    const init = compileErrors(`
function C() {
  const t = useTransform();
  const [n] = useState(t.x);
  return <Entity name="C" />;
}`);
    assert.deepEqual(init.map((d) => d.code), [DiagnosticCode.HandleReadOutsideHandler]);
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

  it("rejects names that collide with state or other handles", () => {
    assert.ok(codes("", "const n = useTransform();").includes(DiagnosticCode.InvalidUseTransform));
    // `sprite` is the generated name of the unnamed <Sprite>, so a ref may take it only if it is the one attached.
    assert.ok(codes("", "const t = useTransform(); const t = useRef<Sprite>();").length > 0);
    assert.ok(codes("", "const n = useRef<Sprite>();").includes(DiagnosticCode.InvalidUseRef));
  });

  it("rejects bad uses of a transform or ref", () => {
    const t = "const t = useTransform(); const r = useRef<Sprite>();";
    const attach = (c: string[]) => c.filter((x) => x !== DiagnosticCode.InvalidUseRef);
    assert.deepEqual(attach(codes("onUpdate(() => { t.z = 1; });", t)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { const q = t; });", t)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.other = 1; });", t)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.current.nope = 1; });", t)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(attach(codes("onUpdate(() => { r.current = 1; });", t)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(attach(codes("onUpdate(() => { t.x %= 2; });", t)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(attach(codes("onUpdate(() => { t.x ||= 2; });", t)), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(attach(codes("onUpdate(() => { const t = 1; });", t)), [DiagnosticCode.InvalidHandler]);
  });
});
