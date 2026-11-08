/**
 * M1 (function / statement IR) and M2 (onInput / onUpdate / onCollisionEnter):
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
  onInput((input) => {
    if (input.pressed("Space")) {
      setHealth(100);
      setPoisoned(false);
    }
  });
  onUpdate((dt) => {
    if (poisoned) {
      setHealth((h) => clamp(h - dt * 5, 0, 100));
    }
  });
  onUpdate((dt) => {
    if (health <= 0) {
      return;
    }
    const regen = poisoned ? 0 : dt;
    setHealth(Math.min(health + regen, 100));
  });
  onCollisionEnter(() => {
    setHealth((h) => h - 10);
    setPoisoned(true);
  });
  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
      <Collider width={16} height={24} />
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
    const fn = handlerOf(irOf(`onUpdate((dt) => {
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
    const fn = handlerOf(irOf("onUpdate(() => setN((prev) => prev + 1));"));
    const set = fn.body[0]!;
    assert.ok(set.kind === "SetState" && "updater" in set);
    assert.equal(set.updater.params.length, 1);
    assert.deepEqual(set.updater.params[0]!.type, { kind: "Primitive", name: "number" });
    const ret = set.updater.body[0]!;
    assert.ok(ret.kind === "Return" && ret.value?.kind === "Binary");
    assert.equal(ret.value.left.kind, "ParamRead");
  });

  it("distinguishes parameters, locals and state reads", () => {
    const fn = handlerOf(irOf("onUpdate((dt) => { const x = dt + n; setN(x); });"));
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
  onInput((input) => {
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
  onInput((input) => { setLabel(\`p=\${input.pointerX},\${input.pointerY}\`); });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(withTemplate), []);
  });

  it("reports type errors in handler bodies through the generated-code check", () => {
    const bad = compile(`
function C() {
  const [n, setN] = useState(0);
  onUpdate(() => setN("text"));
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
      assert.ok(codes(`onUpdate(() => { ${stmt} });`).length > 0, stmt);
    }
    assert.deepEqual(codes("onUpdate(() => { while (true) {} });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("onUpdate(() => { console.log(n); });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onUpdate(() => { await setN(1); });").length > 0, true);
  });

  it("rejects `let`, assignment and escaping closures", () => {
    assert.deepEqual(codes("onUpdate(() => { let x = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("onUpdate(() => { n = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.ok(codes("onUpdate(() => { const f = () => 1; });").length > 0);
  });

  it("rejects bare expression statements and non-call expressions", () => {
    assert.deepEqual(codes("onUpdate(() => { n + 1; });"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects shadowing component bindings, including via updater parameters", () => {
    assert.deepEqual(codes("onUpdate((n) => setN(1));"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate(() => { const n = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate(() => setN((n) => n + 1));"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate(() => { const Math = 1; });"), [DiagnosticCode.InvalidHandler]);
  });

  it("scopes locals to their block", () => {
    assert.deepEqual(
      codes("onUpdate(() => { if (n > 0) { const x = 1; setN(x); } setN(x); });"),
      [DiagnosticCode.UnknownIdentifier],
    );
  });

  it("rejects handlers that return values and updaters that do not", () => {
    assert.deepEqual(codes("onUpdate(() => { return 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate(() => setN((p) => { return; }));"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects setters in render expressions and wrong setter arity", () => {
    assert.deepEqual(codes("onUpdate(() => setN());"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("onUpdate(() => setN(1, 2));"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects calls and members outside the allowlist", () => {
    assert.deepEqual(codes("onUpdate(() => setN(Math.random()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onUpdate(() => setN(Math.max()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onUpdate(() => setN(clamp(1, 2)));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onInput((input) => setN(input.nope));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onInput((input) => setN(input.pressed()));"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("onUpdate((dt) => setN(dt.x));"), [DiagnosticCode.UnsupportedExpression]);
  });

  it("rejects bad handler shapes", () => {
    assert.deepEqual(codes("onUpdate(5);"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate((a, b) => setN(1));"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("onUpdate(({ a }) => setN(1));"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects hooks that are not top-level statements", () => {
    assert.ok(codes("onUpdate(() => { onUpdate(() => setN(1)); });").includes(DiagnosticCode.UnsupportedExpression));
    assert.ok(codes("if (n > 0) { onUpdate(() => setN(1)); }").includes(DiagnosticCode.InvalidComponentBody));
    const inJsx = compileErrors(`
function C() {
  const [n, setN] = useState(0);
  return <Entity name="C" onTick={onUpdate(() => setN(1))} />;
}`);
    assert.ok(inJsx.length > 0);
  });
});

describe("M2: hooks and the frame loop", () => {
  it("generates one override per hook kind; several handlers run in source order", () => {
    const { code } = compile(HERO, "Hero.tsx");
    assert.equal(code.match(/override onUpdate\(/g)?.length, 1);
    assert.match(code, /override onInput\(input: InputState\): void/);
    assert.match(code, /override onCollisionEnter\(\): void/);
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
  onUpdate(() => setTicks(ticks + 1));
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

  it("dispatches collisions to the nearest compiled component owning each collider", async () => {
    const mod = await load<{ Shooter: new () => Entity & { hits: number }; Boss: new () => Entity & { hits: number } }>(
      compile(`
function Shooter() {
  const [hits, setHits] = useState(0);
  onCollisionEnter(() => setHits(hits + 1));
  return (
    <Entity name="Shooter">
      <Entity name="Muzzle"><Collider width={1} height={1} /></Entity>
    </Entity>
  );
}
function Boss() {
  const [hits, setHits] = useState(0);
  onCollisionEnter((other) => setHits(hits + 1));
  return <Entity name="Boss"><Collider width={9} height={9} /></Entity>;
}`, "Owners.tsx"),
    );
    const world = new World();
    const shooter = new mod.Shooter();
    const boss = new mod.Boss();
    world.mount(shooter);
    world.mount(boss);
    const muzzleCollider = shooter.children[0]!.children[0]!;
    const bossCollider = boss.children[0]!;
    assert.ok(muzzleCollider instanceof Collider);
    world.reportCollision(muzzleCollider, bossCollider);
    assert.equal(shooter.hits, 1); // the Collider sits in a plain <Entity>; the owner is the component
    assert.equal(boss.hits, 1);
  });

  it("passes the other component to onCollisionEnter", async () => {
    const mod = await load<{ Probe: new () => Entity & { seen: boolean } }>(
      compile(`
function Probe() {
  const [seen, setSeen] = useState(false);
  onCollisionEnter((other) => setSeen(true));
  return <Entity name="Probe"><Collider width={1} height={1} /></Entity>;
}`, "Probe.tsx"),
    );
    const world = new World();
    const a = new mod.Probe();
    const b = new mod.Probe();
    world.mount(a);
    world.mount(b);
    const received: GameObject[] = [];
    a.onCollisionEnter = (other) => received.push(other);
    world.reportCollision(a.children[0]!, b.children[0]!);
    assert.deepEqual(received, [b]);
  });
});
