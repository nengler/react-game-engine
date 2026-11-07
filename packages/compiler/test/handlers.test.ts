/** onUpdate / onCollisionEnter handlers: statement IR, codegen, runtime dispatch and diagnostics. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const HERO = `
function Hero() {
  const [health, setHealth] = useState(100);
  const [poisoned, setPoisoned] = useState(false);
  onUpdate((dt) => {
    if (poisoned) {
      const next = health - dt * 5;
      setHealth(next > 0 ? next : 0);
    } else {
      setHealth(health);
    }
  });
  onCollisionEnter(() => {
    setHealth((h) => h - 10);
    setPoisoned(true);
  });
  return (
    <Entity name="Hero">
      <Sprite image={poisoned ? "poisoned.png" : "normal.png"} />
    </Entity>
  );
}
`;

interface HeroInstance extends Entity {
  health: number;
  poisoned: boolean;
  setPoisoned(value: boolean): void;
  readonly sprite: Sprite;
}

let Hero: new () => HeroInstance;

before(async () => {
  ({ Hero } = await load<{ Hero: typeof Hero }>(compile(HERO, "Hero.tsx")));
});

describe("handler compilation", () => {
  it("generates code that type-checks", () => {
    assert.deepEqual(typeCheck(compile(HERO, "Hero.tsx")), []);
  });

  it("lowers handlers to statement IR", () => {
    const hero = compile(HERO, "Hero.tsx").ir.components[0]!;
    assert.deepEqual(hero.hooks.map((h) => h.kind), ["UseState", "UseState", "OnUpdate", "OnCollisionEnter"]);
    const update = hero.hooks[2]!;
    assert.ok(update.kind === "OnUpdate");
    assert.equal(update.deltaParam, "dt");
    assert.deepEqual(update.body.map((s) => s.kind), ["If"]);
    const collision = hero.hooks[3]!;
    assert.ok(collision.kind === "OnCollisionEnter");
    // The updater `h => h - 10` is lowered with `h` as a read of the health state.
    const first = collision.body[0]!;
    assert.ok(first.kind === "SetState");
    assert.ok(first.value.kind === "Binary");
    assert.deepEqual(first.value.left, { kind: "StateRead", state: first.state });
  });

  it("emits overriding methods", () => {
    const { code } = compile(HERO, "Hero.tsx");
    assert.match(code, /override onUpdate\(dt: number\): void/);
    assert.match(code, /override onCollisionEnter\(\): void/);
  });

  it("supports expression-bodied handlers without parameters", async () => {
    const mod = await load<{ Ticker: new () => Entity & { n: number } }>(
      compile(
        `
function Ticker() {
  const [n, setN] = useState(0);
  onUpdate(() => setN(n + 1));
  return <Entity name="Ticker" />;
}`,
        "Ticker.tsx",
      ),
    );
    const world = new World();
    const ticker = new mod.Ticker();
    world.mount(ticker);
    world.update(1);
    world.update(1);
    assert.equal(ticker.n, 2);
  });
});

describe("handler runtime behaviour", () => {
  it("onUpdate runs on World.update and state changes re-render", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    world.update(1);
    assert.equal(hero.health, 100); // not poisoned: no change
    world.collide(hero, new Entity());
    assert.equal(hero.health, 90);
    assert.equal(hero.poisoned, true);
    assert.equal(hero.sprite.image, "poisoned.png");
    world.update(2);
    assert.equal(hero.health, 80);
  });

  it("clamps through the conditional expression", () => {
    const world = new World();
    const hero = new Hero();
    world.mount(hero);
    hero.setPoisoned(true);
    world.update(1000);
    assert.equal(hero.health, 0);
  });

  it("does not update objects that are not mounted", () => {
    const world = new World();
    const hero = new Hero();
    hero.setPoisoned(true);
    world.update(1);
    assert.equal(hero.health, 100);
  });

  it("notifies both participants of a collision", async () => {
    const mod = await load<{ A: new () => Entity & { hits: number } }>(
      compile(
        `
function A() {
  const [hits, setHits] = useState(0);
  onCollisionEnter(() => setHits(hits + 1));
  return <Entity name="A" />;
}`,
        "A.tsx",
      ),
    );
    const world = new World();
    const a = new mod.A();
    const b = new mod.A();
    world.mount(a);
    world.mount(b);
    world.collide(a, b);
    assert.equal(a.hits, 1);
    assert.equal(b.hits, 1);
  });
});

describe("handler diagnostics", () => {
  const wrap = (body: string) => `
function C() {
  const [n, setN] = useState(0);
  ${body}
  return <Entity name="C" />;
}`;
  const codes = (src: string) => compileErrors(src).map((d) => d.code);

  it("rejects non-setter call statements", () => {
    assert.deepEqual(codes(wrap("onUpdate(() => { console.log(n); });")), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects unsupported statements", () => {
    assert.deepEqual(codes(wrap("onUpdate(() => { while (true) {} });")), [DiagnosticCode.UnsupportedStatement]);
  });

  it("rejects duplicate handlers", () => {
    assert.deepEqual(codes(wrap("onUpdate(() => setN(1)); onUpdate(() => setN(2));")), [DiagnosticCode.DuplicateHandler]);
  });

  it("rejects non-arrow handler arguments", () => {
    assert.deepEqual(codes(wrap("onUpdate(5);")), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects parameters on onCollisionEnter and extra parameters on onUpdate", () => {
    assert.deepEqual(codes(wrap("onCollisionEnter((other) => setN(1));")), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes(wrap("onUpdate((a, b) => setN(1));")), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects parameters that shadow component names", () => {
    assert.deepEqual(codes(wrap("onUpdate((n) => setN(1));")), [DiagnosticCode.InvalidHandler]);
  });

  it("scopes locals to their block", () => {
    assert.deepEqual(
      codes(wrap("onUpdate(() => { if (n > 0) { const x = 1; setN(x); } setN(x); });")),
      [DiagnosticCode.UnknownIdentifier],
    );
  });

  it("rejects handler hooks nested in other statements", () => {
    assert.ok(codes(wrap("onUpdate(() => { onUpdate(() => setN(1)); });")).includes(DiagnosticCode.UnsupportedStatement));
  });
});
