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
  const s = useMutable({ health: 100, poisoned: false });
  useInput((input) => {
    if (input.pressed("Space")) {
      s.health = 100;
      s.poisoned = false;
    }
  });
  useUpdate((dt) => {
    if (s.poisoned) {
      s.health = clamp(s.health - dt * 5, 0, 100);
    }
  });
  useUpdate((dt) => {
    if (s.health <= 0) {
      return;
    }
    const regen = s.poisoned ? 0 : dt;
    s.health = Math.min(s.health + regen, 100);
  });
  return (
    <Entity name="Hero">
      <Sprite image={s.poisoned ? "poisoned.png" : "normal.png"} />
      <Collider
        width={16}
        height={24}
        onCollisionEnter={() => {
          s.health -= 10;
          s.poisoned = true;
        }}
      />
    </Entity>
  );
}
`;

interface HeroInstance extends Entity {
  readonly sprite: Sprite;
  readonly collider: Collider;
  s: { health: number;
  poisoned: boolean };
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
  const s = useMutable({ n: 0 });
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
      const next = s.n + dt;
      if (next > 10) { s.n = 0; return; } else { s.n = next; }
      s.n += 1;
      Math.abs(dt);
    });`));
    const kinds = fn.body.map((s) => s.kind);
    assert.deepEqual(kinds, ["LocalConst", "If", "SetState", "ExpressionStatement"]);
    const ifStmt = fn.body[1]! as Extract<StatementIR, { kind: "If" }>;
    assert.deepEqual(ifStmt.then.map((s) => s.kind), ["SetState", "Return"]);
    assert.deepEqual(ifStmt.else.map((s) => s.kind), ["SetState"]);
  });

  it("lowers a compound write to a SetState of the field, from its value as it is now", () => {
    const fn = handlerOf(irOf("useUpdate(() => { s.n += 1; });"));
    const set = fn.body[0]!;
    assert.ok(set.kind === "SetState" && "value" in set && set.value.kind === "Binary");
    assert.equal(set.value.operator, "+");
    assert.deepEqual(set.value.left, { kind: "StateRead", state: "C.s.n", live: true });
  });

  it("distinguishes parameters, locals and state reads", () => {
    const fn = handlerOf(irOf("useUpdate((dt) => { const x = dt + s.n; s.n = x; });"));
    const [decl, set] = fn.body as [Extract<StatementIR, { kind: "LocalConst" }>, Extract<StatementIR, { kind: "SetState" }>];
    assert.ok(decl.value.kind === "Binary");
    assert.equal(decl.value.left.kind, "ParamRead");
    assert.equal(decl.value.right.kind, "StateRead");
    assert.ok("value" in set && set.value.kind === "LocalRead");
  });

  it("lowers handle members, allowlisted calls and template literals", () => {
    const component = compile(`
function C() {
  const s = useMutable({ label: "" });
  useInput((input) => {
    if (input.down("A")) s.label = \`x=\${input.pointerX}\`;
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
  const s = useMutable({ label: "" });
  useInput((input) => { s.label = \`p=\${input.pointerX},\${input.pointerY}\`; });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(withTemplate), []);
  });

  it("reports type errors in handler bodies through the generated-code check", () => {
    const bad = compile(`
function C() {
  const s = useMutable({ n: 0 });
  useUpdate(() => { s.n = "text"; });
  return <Entity name="C" />;
}`);
    assert.ok(typeCheck(bad).length > 0);
  });
});

describe("M1: diagnostics", () => {
  const codes = (body: string) =>
    compileErrors(`
function C() {
  const s = useMutable({ n: 0 });
  ${body}
  return <Entity name="C" />;
}`).map((d) => d.code);

  it("rejects await, this and unknown calls", () => {
    // `console.log` is the standard library, which a handler may call since REACT_FEEL_PLAN.md A1.
    for (const stmt of ["this.x = 1;", "unknownFunction(s.n);"]) {
      assert.ok(codes(`useUpdate(() => { ${stmt} });`).length > 0, stmt);
    }
    // Loops and `try` are handler code since REACT_FEEL_PLAN.md A1 (see loops.test.ts); a labelled jump is still refused.
    assert.deepEqual(codes("useUpdate(() => { outer: for (;;) { break outer; } });").length > 0, true);
    assert.ok(codes("useUpdate(() => { unknownFunction(s.n); });").length > 0);
    assert.deepEqual(codes("useUpdate(() => { await (s.n = 1); });").length > 0, true);
  });

  it("rejects `var`, `let` without a value, assignment to a useMutable itself and escaping closures", () => {
    assert.deepEqual(codes("useUpdate(() => { var x = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { let x; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.deepEqual(codes("useUpdate(() => { s = 1; });"), [DiagnosticCode.UnsupportedStatement]);
    assert.ok(codes("useUpdate(() => { const f = () => 1; });").length > 0);
  });

  it("rejects bare expression statements and non-call expressions", () => {
    assert.deepEqual(codes("useUpdate(() => { s.n + 1; });"), [DiagnosticCode.UnsupportedStatement]);
  });

  it("reads each write back at once, and allows a handler `const` with a field's name", async () => {
    const { Counter } = await load<{ Counter: new () => Entity & { s: { n: number } } }>(
      compile(`function Counter() {
  const s = useMutable({ n: 0 });
  useUpdate(() => {
    s.n += 1;
    s.n += 1;
  });
  return <Entity name="Counter" />;
}`),
    );
    const world = new World();
    const counter = new Counter();
    world.mount(counter);
    world.tick(1);
    assert.equal(counter.s.n, 2, "each write reads the one before it");
    // A handler `const` may have a field's name; the field stays `s.n`, and `this.$s_n` in the output.
    const shadowed = compile(`function C() {
  const s = useMutable({ n: 5 });
  useUpdate((dt) => { const n = dt * 2; s.n = n; });
  return <Entity name="C" />;
}`);
    assert.match(shadowed.code, /const n = dt \* 2;\s*this\.\$set_s_n\(n\);/);
    assert.deepEqual(typeCheck(shadowed), []);
  });

  it("rejects redeclarations in one scope and rebinding allowlisted call names", () => {
    assert.deepEqual(codes("useUpdate(() => { const a = 1; const a = 2; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((a) => { const a = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate(() => { const Math = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((clamp) => { s.n = 1; });"), [DiagnosticCode.InvalidHandler]);
    // Inner blocks may shadow outer locals, as in JS.
    const inner = compile(`function C() {
  const s = useMutable({ n: 0 });
  useUpdate(() => { const a = 1; if (s.n > 0) { const a = 2; s.n = a; } s.n = a; });
  return <Entity name="C" />;
}`);
    assert.deepEqual(typeCheck(inner), []);
  });

  it("scopes locals to their block", () => {
    assert.deepEqual(
      codes("useUpdate(() => { if (s.n > 0) { const x = 1; s.n = x; } s.n = x; });"),
      [DiagnosticCode.UnknownIdentifier],
    );
  });

  it("rejects handlers that return values", () => {
    assert.deepEqual(codes("useUpdate(() => { return 1; });"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects calls and members outside the allowlist", () => {
    // Math.random compiles in a handler since REACT_FEEL_PLAN.md A1, with a warning (handler-expressions.test.ts).
    assert.deepEqual(codes("useUpdate(() => { s.n = Math.max(); });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate(() => { s.n = clamp(1, 2); });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useInput((input) => { s.n = input.nope; });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useInput((input) => { s.n = input.pressed(); });"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("useUpdate((dt) => { s.n = dt.x; });"), [DiagnosticCode.UnsupportedExpression]);
  });

  it("rejects bad handler shapes", () => {
    assert.deepEqual(codes("useUpdate(5);"), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes("useUpdate((a, b, c) => { s.n = 1; });"), [DiagnosticCode.InvalidHandler]);
    assert.ok(compile(`function C() { const s = useMutable({ n: 0 }); useUpdate((dt, input) => { if (input.down("Space")) s.n = 1; }); return <Entity name="C" />; }`), "an update handler may take the input too");
    assert.deepEqual(codes("useUpdate(({ a }) => { s.n = 1; });"), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects hooks that are not top-level statements", () => {
    // One error: the hook's place. (It used to be reported a second time as a call the compiler does not know.)
    assert.deepEqual(codes("useUpdate(() => { useUpdate(() => { s.n = 1; }); });"), [DiagnosticCode.HookNotAtTopLevel]);
    assert.ok(codes("if (s.n > 0) { useUpdate(() => { s.n = 1; }); }").includes(DiagnosticCode.HookNotAtTopLevel));
    const inJsx = compileErrors(`
function C() {
  const s = useMutable({ n: 0 });
  return <Entity name="C" onTick={useUpdate(() => { s.n = 1; })} />;
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
    hero.s.poisoned = (true);
    world.tick(1, createInputState());
    assert.deepEqual(order, ["input", "update", "render"]);
  });

  it("handles input, update and collision against state", () => {
    const { world, object: hero } = mount(new Hero());
    world.tick(1);
    assert.equal(hero.s.health, 100);
    world.reportCollision(hero.collider, new Collider({ width: 1, height: 1 }));
    assert.equal(hero.s.health, 100, "a collision queues updates; they apply at the next render");
    world.flush();
    assert.equal(hero.s.health, 90);
    assert.equal(hero.s.poisoned, true);
    world.tick(2); // poison: 90 - 10 = 80
    assert.equal(hero.s.health, 80);
    assert.equal(hero.sprite.image, "poisoned.png");
    world.tick(0, createInputState({ pressed: ["Space"] }));
    assert.equal(hero.s.health, 100);
    assert.equal(hero.s.poisoned, false);
    assert.equal(hero.sprite.image, "normal.png");
  });

  it("clamps and stops through return", () => {
    const { world, object: hero } = mount(new Hero());
    hero.s.poisoned = (true);
    hero.s.health = (0);
    world.flush();
    world.tick(1000);
    assert.equal(hero.s.health, 0); // clamp(…, 0, 100); second handler returned early
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
    hero.s.poisoned = (true);
    new World().tick(1);
    assert.equal(hero.s.health, 100);
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
    const mod = await load<{ Spawner: new () => Entity & { s: { on: boolean } } }>(
      compile(`
function Counter() {
  const s = useMutable({ ticks: 0 });
  useUpdate(() => { s.ticks += 1; });
  return <Entity name="Counter" />;
}
function Spawner() {
  const s = useMutable({ on: false });
  return <Entity name="Spawner">{s.on && <Counter />}</Entity>;
}`, "Spawner.tsx"),
    );
    const { world, object: spawner } = mount(new mod.Spawner());
    const counter = (): (Entity & { s: { ticks: number } }) | undefined =>
      spawner.children.find((c): c is Entity & { s: { ticks: number } } => c instanceof Entity && "s" in c);
    spawner.s.on = (true);
    world.tick(1); // renders and attaches the Counter at the end of this frame
    assert.equal(counter()?.s.ticks, 0);
    world.tick(1);
    world.tick(1);
    const attached = counter()!;
    assert.equal(attached.s.ticks, 2);
    spawner.s.on = (false);
    world.tick(1); // removal commits at the end of this frame; the hook ran at its start
    assert.equal(counter(), undefined);
    const before = attached.s.ticks;
    world.tick(1);
    assert.equal(attached.s.ticks, before);
  });

  it("calls the callback of each collider that was hit, so a component can tell its colliders apart", async () => {
    const mod = await load<{ Fighter: new () => Entity & { readonly hitbox: Collider; readonly shield: Collider; s: { hurt: number; blocked: number } } }>(
      compile(`
function Fighter() {
  const s = useMutable({ hurt: 0, blocked: 0 });
  return (
    <Entity name="Fighter">
      <Collider width={8} height={16} onCollisionEnter={() => { s.hurt += 1; }} />
      <Collider width={12} height={4} onCollisionEnter={() => { s.blocked += 1; }} />
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
    assert.deepEqual([fighter.s.hurt, fighter.s.blocked], [0, 1], "only the shield's callback ran");
    world.reportCollision(bullet, hitbox);
    world.flush();
    assert.deepEqual([fighter.s.hurt, fighter.s.blocked], [1, 1], "the order of the two sides does not matter");
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

  it("reports useEffect with what to write instead", () => {
    for (const hook of ["useEffect", "useLayoutEffect"]) {
      const [diagnostic] = compileErrors(`function C() { ${hook}(() => {}, []); return <Entity name="C" />; }`);
      assert.equal(diagnostic!.code, DiagnosticCode.UnknownHook);
      assert.match(diagnostic!.message, new RegExp(`There is no '${hook}'.*effect store.*derived \`const\`.*useMount`));
    }
  });
});
