/**
 * M1 (function / statement IR) and M2 (useInput / useUpdate, and collision callbacks):
 * lowering, diagnostics, type-checking of generated code, and runtime behaviour.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, GameObject, Sprite, World, createInputState } from "@rge/runtime";
import { DiagnosticCode, isHandlerHook, type ComponentIR, type FunctionIR, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, stripSpans, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const HERO = `
function Hero() {
  const [health, setHealth] = useState(100);
  const [poisoned, setPoisoned] = useState(false);
  useInput((input) => {
    if (input.pressed("Space")) {
      setHealth(100);
      setPoisoned(false);
    }
  });
  useUpdate((dt) => {
    if (poisoned) {
      setHealth((h) => clamp(h - dt * 5, 0, 100));
    }
  });
  useUpdate((dt) => {
    if (health <= 0) {
      return;
    }
    const regen = poisoned ? 0 : dt;
    setHealth((health) => Math.min(health + regen, 100));
  });
  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
      <Collider
        width={16}
        height={24}
        onCollisionEnter={() => {
          setHealth((h) => h - 10);
          setPoisoned(true);
        }}
      />
    </Entity>
  );
}
`;

interface HeroInstance extends Entity {
  health: number;
  poisoned: boolean;
  setHealth(value: number): void;
  setPoisoned(value: boolean): void;
  readonly sprite: Sprite;
  readonly collider: Collider;
}

let Hero: new () => HeroInstance;

before(async () => {
  ({ Hero } = await load<{ Hero: typeof Hero }>(compile(HERO, "Hero.tsx")));
});

function mount<T extends GameObject>(object: T): { world: World; object: T } {
  const world = new World();
  world.mount(object);
  return { world, object };
}

/** Compile a one-state component whose body is `body`, and return its hooks' IR. */
function irOf(body: string): ComponentIR {
  return compile(`
function C() {
  const [n, setN] = useState(0);
  ${body}
  return <Entity name="C" />;
}`).ir.components[0]!;
}

function handlerOf(component: ComponentIR, index = 1): FunctionIR {
  const hook = component.hooks[index]!;
  assert.ok(isHandlerHook(hook));
  return hook.handler;
}

describe("M1: function and statement IR", () => {
  it("lowers every statement kind", () => {
    const fn = handlerOf(irOf(`useUpdate((dt) => {
      const next = n + dt;
      if (next > 10) { setN(0); return; } else { setN(next); }
      setN((prev) => prev + 1);
      Math.abs(dt);
    });`));
    const kinds = fn.body.map((s) => s.kind);
    assert.deepEqual(kinds, ["LocalConst", "If", "SetState", "ExpressionStatement"]);
    const ifStmt = fn.body[1]! as Extract<StatementIR, { kind: "If" }>;
    assert.deepEqual(ifStmt.then.map((s) => s.kind), ["SetState", "Return"]);
    assert.deepEqual(ifStmt.else.map((s) => s.kind), ["SetState"]);
  });

  it("lowers an updater to a FunctionIR whose parameter is read as ParamRead", () => {
    const fn = handlerOf(irOf("useUpdate(() => setN((prev) => prev + 1));"));
    const set = fn.body[0]!;
    assert.ok(set.kind === "SetState" && "updater" in set);
    assert.equal(set.updater.params.length, 1);
    assert.deepEqual(set.updater.params[0]!.type, { kind: "Primitive", name: "number" });
    const ret = set.updater.body[0]!;
    assert.ok(ret.kind === "Return" && ret.value?.kind === "Binary");
    assert.equal(ret.value.left.kind, "ParamRead");
  });

  it("distinguishes parameters, locals and state reads", () => {
    const fn = handlerOf(irOf("useUpdate((dt) => { const x = dt + n; setN(x); });"));
    const [decl, set] = fn.body as [Extract<StatementIR, { kind: "LocalConst" }>, Extract<StatementIR, { kind: "SetState" }>];
    assert.ok(decl.value.kind === "Binary");
    assert.equal(decl.value.left.kind, "ParamRead");
    assert.equal(decl.value.right.kind, "StateRead");
    assert.ok("value" in set && set.value.kind === "LocalRead");
  });

  it("lowers handle members, allowlisted calls and template literals", () => {
    const component = compile(`
function C() {
  const [label, setLabel] = useState("");
  useInput((input) => {
    if (input.down("A")) setLabel(\`x=\${input.pointerX}\`);
  });
  return <Entity name="C" />;
}`).ir.components[0]!;
    const fn = handlerOf(component);
    const ifStmt = fn.body[0]! as Extract<StatementIR, { kind: "If" }>;
    assert.ok(ifStmt.test.kind === "Call" && ifStmt.test.callee.kind === "Method");
    const set = ifStmt.then[0]!;
    assert.ok(set.kind === "SetState" && "value" in set && set.value.kind === "TemplateLiteral");
    assert.equal(set.value.expressions[0]!.kind, "PropertyRead");
  });

  it("produces IR that is plain data (JSON round-trips)", () => {
    const { ir } = compile(HERO, "Hero.tsx");
    assert.deepEqual(JSON.parse(JSON.stringify(stripSpans(ir))), stripSpans(ir));
  });

  it("generated bodies type-check", () => {
    assert.deepEqual(typeCheck(compile(HERO, "Hero.tsx")), []);
    const withTemplate = compile(`
function C() {
  const [label, setLabel] = useState("");
  useInput((input) => { setLabel(\`p=\${input.pointerX},\${input.pointerY}\`); });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(withTemplate), []);
  });

  it("reports type errors in handler bodies through the generated-code check", () => {
    const bad = compile(`
function C() {
  const [n, setN] = useState(0);
  useUpdate(() => setN("text"));
  return <Entity name="C" />;
}`);
    assert.ok(typeCheck(bad).length > 0);
  });
});

describe("M1: diagnostics", () => {
  const codes = (body: string) =>
    compileErrors(`
function C() {
  const [n, setN] = useState(0);
  ${body}
  return <Entity name="C" />;
}`).map((d) => d.code);

  it("rejects loops, try, await, this and unknown calls", () => {
    for (const stmt of ["while (true) {}", "for (;;) {}", "try { setN(1); } catch (e) {}", "this.x = 1;", "console.log(n);"]) {
      assert.ok(codes(`useUpdate(() => { ${stmt} });`).length > 0, stmt);
    }
    assert.deepEqual(codes("useUpdate(() => { while (true) {} });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { console.log(n); });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => { await setN(1); });").length > 0, true);
  });

  it("rejects `var`, `let` without a value, assignment to state and escaping closures", () => {
    assert.deepEqual(codes("useUpdate(() => { var x = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { let x; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { n = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.ok(codes("useUpdate(() => { const f = () => 1; });").length > 0);
  });

  it("rejects bare expression statements and non-call expressions", () => {
    assert.deepEqual(codes("useUpdate(() => { n + 1; });"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("allows JS shadowing, so `setN((n) => n + 1)` reads the parameter, not the state", async () => {
    const { Counter } = await load<{ Counter: new () => Entity & { n: number } }>(
      compile(`function Counter() {
  const [n, setN] = useState(0);
  useUpdate(() => {
    setN((n) => n + 1);
    setN((n) => n + 1);
  });
  return <Entity name="Counter" />;
}`),
    );
    const world = new World();
    const counter = new Counter();
    world.mount(counter);
    world.tick(1);
    assert.equal(counter.n, 2, "each updater receives the previous value through its own `n`");
    // A handler `const` may shadow state too; state stays reachable as `this.n` in the output.
    const shadowed = compile(`function C() {
  const [n, setN] = useState(5);
  useUpdate((dt) => { const n = dt * 2; setN(n); });
  return <Entity name="C" />;
}`);
    assert.match(shadowed.code, /const n = dt \* 2;\s*this\.setN\(n\);/);
    assert.deepEqual(typeCheck(shadowed), []);
  });

  it("rejects redeclarations in one scope and rebinding allowlisted call names", () => {
    assert.deepEqual(codes("useUpdate(() => { const a = 1; const a = 2; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((a) => { const a = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate(() => { const Math = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((clamp) => setN(1));"), [DiagnosticCode.InvalidHandler]);
    // Inner blocks may shadow outer locals, as in JS.
    const inner = compile(`function C() {
  const [n, setN] = useState(0);
  useUpdate(() => { const a = 1; if (n > 0) { const a = 2; setN(a); } setN(a); });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(inner), []);
  });

  it("scopes locals to their block", () => {
    assert.deepEqual(
      codes("useUpdate(() => { if (n > 0) { const x = 1; setN(x); } setN(x); });"),
      [DiagnosticCode.UnknownIdentifier],
    );
  });

  it("rejects handlers that return values and updaters that do not", () => {
    assert.deepEqual(codes("useUpdate(() => { return 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate(() => setN((p) => { return; }));"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects setters in render expressions and wrong setter arity", () => {
    assert.deepEqual(codes("useUpdate(() => setN());"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => setN(1, 2));"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects calls and members outside the allowlist", () => {
    assert.deepEqual(codes("useUpdate(() => setN(Math.random()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => setN(Math.max()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => setN(clamp(1, 2)));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useInput((input) => setN(input.nope));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useInput((input) => setN(input.pressed()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate((dt) => setN(dt.x));"), [DiagnosticCode.UnsupportedExpression]);
  });

  it("rejects bad handler shapes", () => {
    assert.deepEqual(codes("useUpdate(5);"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((a, b, c) => setN(1));"), [DiagnosticCode.InvalidHandler]);
    assert.ok(compile(`function C() { const [n, setN] = useState(0); useUpdate((dt, input) => { if (input.down("Space")) setN(1); }); return <Entity name="C" />; }`), "an update handler may take the input too");
    assert.deepEqual(codes("useUpdate(({ a }) => setN(1));"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects hooks that are not top-level statements", () => {
    assert.ok(codes("useUpdate(() => { useUpdate(() => setN(1)); });").includes(DiagnosticCode.UnsupportedExpression));
    assert.ok(codes("if (n > 0) { useUpdate(() => setN(1)); }").includes(DiagnosticCode.InvalidComponentBody));
    const inJsx = compileErrors(`
function C() {
  const [n, setN] = useState(0);
  return <Entity name="C" onTick={useUpdate(() => setN(1))} />;
}`);
    assert.ok(inJsx.length > 0);
  });
});

describe("M2: hooks and the frame loop", () => {
  it("generates one override per hook kind; several handlers run in source order", () => {
    const { code } = compile(HERO, "Hero.tsx");
    assert.equal(code.match(/override onUpdate\(/g)?.length, 1);
    assert.match(code, /override onInput\(input: InputState\): void/);
    assert.match(code, /new Collider\(\{ width: 16, height: 24, onCollisionEnter: \(\) => \{/, "a collider's callback is created with the collider");
    assert.doesNotMatch(code, /override onCollisionEnter/, "collision is not a component-wide hook any more");
    assert.match(code, /this\.#onUpdate0\(dt\);\n\s+this\.#onUpdate1\(dt\);/);
  });

  it("runs onInput before onUpdate, then renders", () => {
    const order: string[] = [];
    const { world, object: hero } = mount(new Hero());
    const originalInput = hero.onInput.bind(hero);
    const originalUpdate = hero.onUpdate.bind(hero);
    const originalRender = hero.render.bind(hero);
    hero.onInput = (i) => { order.push("input"); originalInput(i); };
    hero.onUpdate = (dt) => { order.push("update"); originalUpdate(dt); };
    hero.render = () => { order.push("render"); originalRender(); };
    hero.setPoisoned(true);
    world.tick(1, createInputState());
    assert.deepEqual(order, ["input", "update", "render"]);
  });

  it("handles input, update and collision against state", () => {
    const { world, object: hero } = mount(new Hero());
    world.tick(1);
    assert.equal(hero.health, 100);
    world.reportCollision(hero.collider, new Collider({ width: 1, height: 1 }));
    assert.equal(hero.health, 100, "a collision queues updates; they apply at the next render");
    world.flush();
    assert.equal(hero.health, 90);
    assert.equal(hero.poisoned, true);
    world.tick(2); // poison: 90 - 10 = 80
    assert.equal(hero.health, 80);
    assert.equal(hero.sprite.image, "poisoned.png");
    world.tick(0, createInputState({ pressed: ["Space"] }));
    assert.equal(hero.health, 100);
    assert.equal(hero.poisoned, false);
    assert.equal(hero.sprite.image, "normal.png");
  });

  it("clamps and stops through return", () => {
    const { world, object: hero } = mount(new Hero());
    hero.setPoisoned(true);
    hero.setHealth(0);
    world.flush();
    world.tick(1000);
    assert.equal(hero.health, 0); // clamp(…, 0, 100); second handler returned early
  });

  it("renders once per tick however many setters run", () => {
    const { world, object: hero } = mount(new Hero());
    let renders = 0;
    const original = hero.render.bind(hero);
    hero.render = () => { renders++; original(); };
    world.reportCollision(hero.collider, hero.collider); // two setters per notification
    assert.equal(renders, 0); // dispatch alone does not render
    world.tick(1);
    assert.equal(renders, 1);
  });

  it("does not run hooks on objects that are not mounted", () => {
    const hero = new Hero();
    hero.setPoisoned(true);
    new World().tick(1);
    assert.equal(hero.health, 100);
  });

  it("registers only objects that override a hook", () => {
    const world = new World();
    const calls: string[] = [];
    class Plain extends Entity {}
    class Ticking extends Entity {
      override onUpdate(): void { calls.push("ticking"); }
    }
    world.mount(new Plain());
    world.mount(new Ticking());
    world.tick(1);
    assert.deepEqual(calls, ["ticking"]);
  });

  it("starts hooks for a conditional child the frame after it appears, and stops after removal", async () => {
    const mod = await load<{ Spawner: new () => Entity & { on: boolean; ticks: number; setOn(v: boolean): void } }>(
      compile(`
function Counter() {
  const [ticks, setTicks] = useState(0);
  useUpdate(() => setTicks(ticks + 1));
  return <Entity name="Counter" />;
}
function Spawner() {
  const [on, setOn] = useState(false);
  return <Entity name="Spawner">{on && <Counter />}</Entity>;
}`, "Spawner.tsx"),
    );
    const { world, object: spawner } = mount(new mod.Spawner());
    const counter = (): (Entity & { ticks: number }) | undefined =>
      spawner.children.find((c): c is Entity & { ticks: number } => c instanceof Entity && "ticks" in c);
    spawner.setOn(true);
    world.tick(1); // renders and attaches the Counter at the end of this frame
    assert.equal(counter()?.ticks, 0);
    world.tick(1);
    world.tick(1);
    const attached = counter()!;
    assert.equal(attached.ticks, 2);
    spawner.setOn(false);
    world.tick(1); // removal commits at the end of this frame; the hook ran at its start
    assert.equal(counter(), undefined);
    const before = attached.ticks;
    world.tick(1);
    assert.equal(attached.ticks, before);
  });

  it("calls the callback of each collider that was hit, so a component can tell its colliders apart", async () => {
    const mod = await load<{ Fighter: new () => Entity & { hurt: number; blocked: number; setHurt(v: number): void; readonly hitbox: Collider; readonly shield: Collider } }>(
      compile(`
function Fighter() {
  const [hurt, setHurt] = useState(0);
  const [blocked, setBlocked] = useState(0);
  return (
    <Entity name="Fighter">
      <Collider width={8} height={16} onCollisionEnter={() => setHurt((n) => n + 1)} />
      <Collider width={12} height={4} onCollisionEnter={() => setBlocked((n) => n + 1)} />
    </Entity>
  );
}`, "Fighter.tsx"),
    );
    const world = new World();
    const fighter = new mod.Fighter();
    world.mount(fighter);
    const [hitbox, shield] = fighter.children as [Collider, Collider];
    const bullet = new Collider({ width: 1, height: 1 });
    world.mount(bullet);

    world.reportCollision(shield, bullet);
    world.flush();
    assert.deepEqual([fighter.hurt, fighter.blocked], [0, 1], "only the shield's callback ran");
    world.reportCollision(bullet, hitbox);
    world.flush();
    assert.deepEqual([fighter.hurt, fighter.blocked], [1, 1], "the order of the two sides does not matter");
  });

  it("calls both colliders' callbacks, each with the other collider, only while mounted", () => {
    const world = new World();
    const seen: string[] = [];
    const a = new Collider({ width: 1, height: 1, onCollisionEnter: (other) => seen.push(other === b ? "a saw b" : "a saw ?") });
    const b: Collider = new Collider({ width: 1, height: 1, onCollisionEnter: (other) => seen.push(other === a ? "b saw a" : "b saw ?") });
    world.mount(a);
    world.reportCollision(a, b);
    assert.deepEqual(seen, ["a saw b"], "b is not mounted in this world");
    world.mount(b);
    world.reportCollision(a, b);
    assert.deepEqual(seen, ["a saw b", "a saw b", "b saw a"]);
  });

  it("reports the old onCollisionEnter hook with where it went", () => {
    const [diagnostic] = compileErrors(`function C() { onCollisionEnter(() => {}); return <Entity name="C" />; }`);
    assert.equal(diagnostic!.code, DiagnosticCode.UnknownHook);
    assert.match(diagnostic!.message, /<Collider width=\{16\} height=\{24\} onCollisionEnter=/);
  });
});
