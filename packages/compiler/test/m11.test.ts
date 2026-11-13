/**
 * M11: `<Shape>`. A filled rect or circle for debugging colliders and
 * prototyping. Its `kind` is one of a fixed set, which the compiler checks
 * from the runtime manifest when it is a literal.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, SHAPE_KINDS, Shape, World, runtimeManifest } from "@rge/runtime";
import { Compiler, DiagnosticCode, type PropIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const GAUGE = `
interface GaugeProps {
  max: number;
}

function Gauge({ max }: GaugeProps) {
  const [value, setValue] = useState(0);
  const [round, setRound] = useState(false);
  return (
    <Entity name="Gauge" transform={{ x: value }}>
      <Shape kind="rect" width={max} height={4} color="gray" />
      <Shape kind={round ? "circle" : "rect"} width={value} height={4} color={value > 5 ? "red" : "green"} transform={{ x: 2 }} />
    </Entity>
  );
}

interface DotProps {
  size: number;
}

const Dot = ({ size }: DotProps) => <Shape kind="circle" width={size} height={size} color="gold" />;
`;

interface GaugeInstance extends Entity {
  setValue(value: number): void;
  setRound(value: boolean): void;
  readonly shape: Shape;
  readonly shape2: Shape;
}
interface DotInstance extends Shape {
  updateProps(next: { size: number }): void;
}

let Gauge: new (props: { max: number }) => GaugeInstance;
let Dot: new (props: { size: number }) => DotInstance;

before(async () => {
  ({ Gauge, Dot } = await load<{ Gauge: typeof Gauge; Dot: typeof Dot }>(compile(GAUGE, "Gauge.tsx")));
});

const prop = (props: readonly PropIR[], name: string): PropIR => {
  const found = props.find((p) => p.name === name);
  assert.ok(found, name);
  return found;
};

describe("M11: IR and generated code", () => {
  const compiled = compile(GAUGE, "Gauge.tsx");
  const gauge = compiled.ir.components.find((c) => c.name === "Gauge")!;
  const [fixed, moving] = gauge.root.children.map((c) => elementOf(c));

  it("keeps a literal kind static, and lets other values vary", () => {
    assert.deepEqual(prop(fixed!.props, "kind"), { kind: "StaticProp", name: "kind", value: { kind: "StringLiteral", value: "rect" } });
    assert.equal(prop(fixed!.props, "width").kind, "DynamicProp", "a prop read");
    assert.equal(prop(moving!.props, "kind").kind, "DynamicProp", "a conditional of literals is allowed");
    assert.deepEqual((prop(moving!.props, "kind") as { dependencies: unknown }).dependencies, [{ kind: "State", state: "Gauge.round" }]);
  });

  it("builds the shapes and updates the varying fields in place", () => {
    assert.match(compiled.code, /readonly shape: Shape = new Shape\(\{ kind: "rect", width: this\.props\.max, height: 4, color: "gray" \}\);/);
    assert.match(compiled.code, /const (\$\d+) = this\.round \? "circle" : "rect";[^]*?this\.shape2\.kind = \1;/);
    assert.match(compiled.code, /const (\$\d+) = \(this\.value > 5\) \? "red" : "green";[^]*?this\.shape2\.color = \1;/);
  });

  it("makes a Shape-rooted component a Shape, with the required props as placeholders when they vary", () => {
    assert.match(compiled.code, /export class Dot extends Shape<DotProps> \{/);
    assert.match(compiled.code, /super\(\{ kind: "circle", color: "gold", width: undefined as never, height: undefined as never \}, props\);/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("M11: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M11${Math.random()}.tsx`,
        text: `import { Entity, Shape } from "@rge/runtime/jsx";\nfunction C({ n, big }: { n: number; big: boolean }) { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts both kinds, a color and a placement", () => {
    assert.deepEqual(check(`<Shape kind="rect" width={n} height={4} />`), []);
    assert.deepEqual(check(`<Shape kind={big ? "circle" : "rect"} width={n} height={n} color="red" transform={{ x: 1 }} />`), []);
  });

  it("rejects an unknown kind, a missing size and a wrong type, including inside an expression", () => {
    assert.ok(check(`<Shape kind="oval" width={1} height={1} />`).length > 0);
    assert.ok(check(`<Shape kind={big ? "circle" : "oval"} width={1} height={1} />`).length > 0, "a literal inside an expression is caught by the type-check");
    assert.ok(check(`<Shape kind="rect" height={1} />`).length > 0);
    assert.ok(check(`<Shape kind="rect" width="wide" height={1} />`).length > 0);
  });
});

describe("M11: runtime behaviour", () => {
  it("updates in place when state changes, keeping the instance, in one render", () => {
    const world = new World();
    const gauge = new Gauge({ max: 20 });
    world.mount(gauge);
    const [fixed, moving] = [gauge.shape, gauge.shape2];
    assert.deepEqual([fixed.kind, fixed.width, fixed.color, moving.kind, moving.width, moving.color], ["rect", 20, "gray", "rect", 0, "green"]);
    gauge.setValue(8);
    gauge.setRound(true);
    assert.equal(world.flush(), 1);
    assert.deepEqual([moving.kind, moving.width, moving.color], ["circle", 8, "red"]);
    assert.equal(gauge.shape, fixed);
    assert.equal(gauge.shape2, moving);
  });

  it("follows the parent it is placed in", () => {
    const world = new World();
    const gauge = new Gauge({ max: 20 });
    world.mount(gauge);
    assert.equal(gauge.shape2.worldTransform().x, 2, "its own x inside a parent at 0");
    gauge.setValue(50);
    world.flush();
    assert.equal(gauge.shape2.worldTransform().x, 52, "the parent moved, the shape followed");
  });

  it("is a Shape when it is a component's root, and follows its props", () => {
    const world = new World();
    const dot = new Dot({ size: 6 });
    world.mount(dot);
    assert.ok(dot instanceof Shape);
    assert.deepEqual([dot.kind, dot.width, dot.height, dot.color], ["circle", 6, 6, "gold"]);
    dot.updateProps({ size: 9 });
    world.flush();
    assert.deepEqual([dot.width, dot.height], [9, 9]);
  });
});

describe("M11: diagnostics", () => {
  const diag = (body: string) => compileErrors(`function C() { return <Entity name="C">${body}</Entity>; }`);

  it("rejects an unknown kind literal, naming the choices", () => {
    const source = `import { Entity, Shape } from "@rge/runtime/jsx";\nfunction C() { return <Entity name="C"><Shape kind="triangle" width={1} height={1} /></Entity>; }`;
    const errors = getCompiler().compile("C.tsx", source).diagnostics;
    assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
    assert.match(errors[0]!.message, /<Shape kind> must be one of "rect", "circle", not 'triangle'\./);
    assert.deepEqual([errors[0]!.span!.line, errors[0]!.span!.column], [2, source.split("\n")[1]!.indexOf('kind="triangle"') + 1], "at the attribute");
  });

  it("suggests the nearest kind for a typo, and only for a typo", () => {
    assert.match(diag(`<Shape kind="rectangle" width={1} height={1} />`)[0]!.message, /did you mean "rect"\?/);
    assert.match(diag(`<Shape kind="circel" width={1} height={1} />`)[0]!.message, /did you mean "circle"\?/);
    assert.match(diag(`<Shape kind="RECT" width={1} height={1} />`)[0]!.message, /did you mean "rect"\?/, "case is a typo");
    assert.match(diag(`<Shape kind="circ" width={1} height={1} />`)[0]!.message, /did you mean "circle"\?/, "a prefix");
    assert.doesNotMatch(diag(`<Shape kind="triangle" width={1} height={1} />`)[0]!.message, /did you mean/);
    assert.doesNotMatch(diag(`<Shape kind="r" width={1} height={1} />`)[0]!.message, /did you mean/, "too short to guess");
  });

  it("rejects a kind that is not a string", () => {
    for (const value of [`kind={3}`, `kind`, `kind={true}`, `kind={null}`]) {
      assert.deepEqual(diag(`<Shape ${value} width={1} height={1} />`).map((d) => d.code), [DiagnosticCode.InvalidPropValue], value);
    }
  });

  it("checks a Shape at the root of a component too", () => {
    assert.deepEqual(compileErrors(`function C() { return <Shape kind="oval" width={1} height={1} />; }`).map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
  });

  it("leaves other expressions to the type-check", () => {
    const compiled = compile(`function C() { const [big, setBig] = useState(false); return <Entity name="C"><Shape kind={big ? "circle" : "oval"} width={1} height={1} /></Entity>; }`);
    assert.ok(typeCheck(compiled).some((d) => d.code === DiagnosticCode.GeneratedTypeError), "caught in the generated code");
  });

  it("must be imported, and keeps its fields apart from the state of a component rooted at it", () => {
    const result = getCompiler().compile("C.tsx", `import { Entity } from "@rge/runtime/jsx";\nfunction C() { return <Entity name="C"><Shape kind="rect" width={1} height={1} /></Entity>; }`);
    assert.deepEqual(result.diagnostics.map((d) => d.code), [DiagnosticCode.MissingImport]);
    // Since REACT_FEEL_PLAN.md B7 a name the root built-in has is the author's to use: its field is `$name`.
    assert.ok(compile(`function C() { const [width, setWidth] = useState(1); return <Shape kind="rect" width={width} height={1} />; }`).code.includes("$width: number"));
  });

  it("is driven by the manifest, not by Shape: any intrinsic prop can be restricted", () => {
    const compiler = new Compiler({ manifest: { ...runtimeManifest, intrinsicLiterals: { Sprite: { image: ["a.png", "b.png"] } } } });
    try {
      const source = (image: string) => `import { Entity, Sprite } from "@rge/runtime/jsx";\nfunction C() { return <Entity name="C"><Sprite image="${image}" /></Entity>; }`;
      assert.ok(compiler.compile("C.tsx", source("a.png")).ok);
      const bad = compiler.compile("C.tsx", source("c.png"));
      assert.deepEqual(bad.diagnostics.map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
      assert.match(bad.diagnostics[0]!.message, /<Sprite image> must be one of "a\.png", "b\.png"/);
    } finally {
      compiler.close();
    }
  });

  it("knows its kinds from the runtime", () => {
    assert.deepEqual(runtimeManifest.intrinsicLiterals["Shape"]?.["kind"], [...SHAPE_KINDS]);
  });
});
