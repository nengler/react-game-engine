/**
 * React idioms the compiler accepts: values derived in the component body,
 * ternary children, and JS shadowing in updaters (see handlers.test.ts).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const STATUS = `
function Status() {
  const [health, setHealth] = useState(100);
  const hurt = health < 25;
  const image = hurt ? "hurt.png" : "ok.png";
  onCollisionEnter(() => {
    setHealth((health) => health - 50);
  });
  onUpdate(() => {
    if (hurt) setHealth((health) => health + 1);
  });
  return (
    <Entity name="Status">
      <Sprite image={image} />
      {hurt ? <Sprite image="warning.png" /> : <Entity name="fine" />}
      {health > 90 ? <Sprite image="sparkle.png" /> : null}
    </Entity>
  );
}
`;

interface StatusInstance extends Entity {
  health: number;
}

describe("React idioms", () => {
  it("inlines component-body consts, so JSX that uses them updates with state", async () => {
    const compiled = compile(STATUS);
    const sprite = compiled.ir.components[0]!.root.children[0]!.element;
    const image = sprite.props[0]!;
    assert.ok(image.kind === "DynamicProp", "a const derived from state is dynamic where it is used");
    assert.deepEqual(image.dependencies, ["Status.health"]);
    assert.deepEqual(typeCheck(compiled), []);

    const { Status } = await load<{ Status: new () => StatusInstance }>(compiled);
    const world = new World();
    const status = new Status();
    world.mount(status);
    const first = status.children[0] as Sprite;
    assert.equal(first.image, "ok.png");
    status.onCollisionEnter(status);
    status.onCollisionEnter(status);
    world.flush();
    assert.equal(status.health, 0);
    assert.equal(status.children[0], first, "same instance, updated in place");
    assert.equal(first.image, "hurt.png");
    world.tick(1); // the handler's `hurt` reads current state
    assert.equal(status.health, 1);
  });

  it("lowers `{c ? <A /> : <B />}` and `{c ? <A /> : null}` to conditional children in source order", async () => {
    const { Status } = await load<{ Status: new () => StatusInstance }>(compile(STATUS));
    const world = new World();
    const status = new Status();
    world.mount(status);
    const describe = () => status.children.map((c) => (c instanceof Sprite ? c.image : (c as Entity).name));
    assert.deepEqual(describe(), ["ok.png", "fine", "sparkle.png"]);
    status.onCollisionEnter(status);
    status.onCollisionEnter(status);
    world.flush();
    assert.deepEqual(describe(), ["hurt.png", "warning.png"]);
  });

  it("rejects consts that are redeclared, read before declaration, or not plain expressions", () => {
    const codes = (body: string) =>
      compileErrors(`function C() {
  const [n, setN] = useState(0);
  ${body}
  return <Entity name="C" />;
}`).map((d) => d.code);
    assert.deepEqual(codes("const a = 1; const a = 2;"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("const n = 1;"), [DiagnosticCode.InvalidComponentBody]);
    assert.deepEqual(codes("const a = 1; const [a, setA] = useState(0);"), [DiagnosticCode.InvalidUseState]);
    assert.deepEqual(codes("const a = b; const b = 1;"), [DiagnosticCode.UnknownIdentifier]);
    assert.deepEqual(codes("const f = () => 1;"), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes("let a = 1;"), [DiagnosticCode.InvalidComponentBody]);
    assert.ok(codes("const r = useRef<Sprite>(); const s = r.current;").includes(DiagnosticCode.HandleReadOutsideHandler));
  });

  it("rejects ternary children whose branches are not elements or null", () => {
    const codes = compileErrors(`function C() {
  const [n, setN] = useState(0);
  return <Entity name="C">{n > 0 ? <Sprite image="a" /> : 5}</Entity>;
}`).map((d) => d.code);
    assert.deepEqual(codes, [DiagnosticCode.UnsupportedJsxChild]);
  });
});
