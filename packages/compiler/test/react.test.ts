/**
 * React idioms the compiler accepts: values derived in the component body,
 * ternary children, snapshot state reads, and JS shadowing in updaters (see
 * handlers.test.ts).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, Sprite, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck, elementOf } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const STATUS = `
function Status() {
  const s = useMutable({ health: 100 });
  const hurt = s.health < 25;
  const image = hurt ? "hurt.png" : "ok.png";
  useUpdate(() => {
    if (hurt) s.health += 1;
  });
  return (
    <Entity name="Status">
      <Sprite image={image} />
      {hurt ? <Sprite image="warning.png" /> : <Entity name="fine" />}
      {s.health > 90 ? <Sprite image="sparkle.png" /> : null}
      <Collider width={4} height={4} onCollisionEnter={() => { s.health -= 50; }} />
    </Entity>
  );
}
`;

interface StatusInstance extends Entity {
  readonly collider: Collider;
  s: { health: number };
}

/** A collision with something outside the component: the status collider's callback runs once. */
function hit(world: World, status: StatusInstance): void {
  world.reportCollision(status.collider, new Collider({ width: 1, height: 1 }));
}

describe("React idioms", () => {
  it("inlines component-body consts, so JSX that uses them updates with state", async () => {
    const compiled = compile(STATUS);
    const sprite = elementOf(compiled.ir.components[0]!.root.children[0]!);
    const image = sprite.props[0]!;
    assert.ok(image.kind === "DynamicProp", "a const derived from state is dynamic where it is used");
    assert.deepEqual(image.dependencies, [{ kind: "State", state: "Status.s.health" }]);
    assert.deepEqual(typeCheck(compiled), []);

    const { Status } = await load<{ Status: new () => StatusInstance }>(compiled);
    const world = new World();
    const status = new Status();
    world.mount(status);
    const first = status.children[0] as Sprite;
    assert.equal(first.image, "ok.png");
    hit(world, status);
    hit(world, status);
    world.flush();
    assert.equal(status.s.health, 0);
    assert.equal(status.children[0], first, "same instance, updated in place");
    assert.equal(first.image, "hurt.png");
    world.tick(1); // the handler's `hurt` reads current state
    assert.equal(status.s.health, 1);
  });

  it("lowers `{c ? <A /> : <B />}` and `{c ? <A /> : null}` to conditional children in source order", async () => {
    const { Status } = await load<{ Status: new () => StatusInstance }>(compile(STATUS));
    const world = new World();
    const status = new Status();
    world.mount(status);
    const describe = () => status.children.filter((c) => !(c instanceof Collider)).map((c) => (c instanceof Sprite ? c.image : (c as Entity).name));
    assert.deepEqual(describe(), ["ok.png", "fine", "sparkle.png"]);
    hit(world, status);
    hit(world, status);
    world.flush();
    assert.deepEqual(describe(), ["hurt.png", "warning.png"]);
  });

  it("takes a fragment as a condition's branch or a child: its elements come and go together, in an implicit Entity", async () => {
    const compiled = compile(`
function Pickup() {
  const s = useMutable({ taken: false });
  useUpdate(() => { s.taken = true; });
  return (
    <Entity name="Pickup">
      {!s.taken && (
        <>
          <Sprite image="gem.png" />
          <Sprite image="shine.png" />
        </>
      )}
      {s.taken ? <><Sprite image="empty.png" /></> : null}
      <>
        <Sprite image="base.png" />
      </>
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Pickup } = await load<{ Pickup: new () => Entity }>(compiled);
    const world = new World();
    const pickup = new Pickup();
    world.mount(pickup);
    const images = () => pickup.children.map((c) => c.children.map((s) => (s as Sprite).image));
    assert.deepEqual(images(), [["gem.png", "shine.png"], ["base.png"]]);
    world.tick(0.1);
    world.flush();
    assert.deepEqual(images(), [["empty.png"], ["base.png"]]);
  });

  it("rejects consts that are redeclared, read before declaration, or not plain expressions", () => {
    const codes = (body: string) =>
      compileErrors(`function C() {
  const s = useMutable({ n: 0 });
  ${body}
  return <Entity name="C" />;
}`).map((d) => d.code);
    assert.deepEqual(codes("const a = 1; const a = 2;"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("const s = 1;"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("const a = 1; const a = useMutable({ n: 0 });"), [DiagnosticCode.InvalidUseState]);
    assert.deepEqual(codes("const a = b; const b = 1;"), [DiagnosticCode.UnknownIdentifier]);
    // An arrow in the body is a function of the component since REACT_FEEL_PLAN.md B6 (hooks-as-functions.test.ts).
    assert.ok(compile(`function C() { const f = () => 1; return <Entity />; }`).code.includes("readonly f = () =>"));
    // `let` and loops in the body are a render block since REACT_FEEL_PLAN.md A1 (render-blocks.test.ts); `var` is not.
    assert.deepEqual(codes("var a = 1;"), [DiagnosticCode.InvalidComponentBody]);
  });

  it("gives every handler the latest writes, in the order they run, and renders once (docs/MUTABLE_STATE.md)", async () => {
    const { Snap } = await load<{ Snap: new () => Entity & { s: { n: number; seenBySecond: number; doubled: number } } }>(
      compile(`function Snap() {
  const s = useMutable({ n: 1, seenBySecond: 0, doubled: 0 });
  useUpdate(() => {
    s.n += 10;
    s.n += 10; // reads the write before it: 1 + 10 + 10
    s.doubled = s.n * 2; // reads 21
  });
  useUpdate(() => {
    s.seenBySecond = s.n; // a later handler sees the earlier one's writes
  });
  return <Entity name="Snap" />;
}`),
    );
    const world = new World();
    const snap = new Snap();
    world.mount(snap);
    assert.equal(world.tick(1), 1, "one render for every write of the frame");
    assert.deepEqual([snap.s.n, snap.s.doubled, snap.s.seenBySecond], [21, 42, 21]);
    world.tick(1);
    assert.deepEqual([snap.s.n, snap.s.doubled, snap.s.seenBySecond], [41, 82, 41]);
  });

  it("renders nothing when every queued update ends where it started", async () => {
    const { Same } = await load<{ Same: new () => Entity & { n: number } }>(
      compile(`function Same() {
  const s = useMutable({ n: 5 });
  useUpdate(() => { s.n = 5; });
  return <Entity name="Same" />;
}`),
    );
    const world = new World();
    world.mount(new Same());
    assert.equal(world.tick(1), 0);
  });

  it("rejects ternary children whose branches are not elements or null", () => {
    const codes = compileErrors(`function C() {
  const s = useMutable({ n: 0 });
  return <Entity name="C">{s.n > 0 ? <Sprite image="a" /> : 5}</Entity>;
}`).map((d) => d.code);
    assert.deepEqual(codes, [DiagnosticCode.UnsupportedJsxChild]);
  });
});
