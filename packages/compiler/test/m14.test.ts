/**
 * M14: `<Pointer>`. A hit area for presses, with an `onPress` callback prop
 * like `<Collider onCollisionEnter>`. The runtime tests the press against the
 * pointer's world transform and size (`pointer.test.ts`).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Pointer, World, runtimeManifest } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, elementOf, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const MENU = `
function Menu() {
  const s = useMutable({ open: false, taps: 0 });
  return (
    <Entity name="Menu" transform={{ x: 100 }}>
      <Pointer width={40} height={20} transform={{ x: 10 }} onPress={() => { s.open = !s.open; }} />
      <Pointer width={s.taps + 5} height={20} onPress={() => { s.taps += 1; }} />
    </Entity>
  );
}

const Button = () => {
  const s = useMutable({ pressed: 0 });
  return <Pointer width={30} height={30} onPress={() => { s.pressed += 1; }} />;
};
`;

interface MenuInstance extends Entity {
  readonly open: boolean;
  readonly taps: number;
  readonly pointer: Pointer;
  readonly pointer2: Pointer;
  s: { [field: string]: unknown };
}
interface ButtonInstance extends Pointer {
  readonly pressed: number;
  s: { [field: string]: unknown };
}

let Menu: new () => MenuInstance;
let Button: new () => ButtonInstance;

before(async () => {
  ({ Menu, Button } = await load<{ Menu: typeof Menu; Button: typeof Button }>(compile(MENU, "Menu.tsx")));
});

describe("M14: IR and generated code", () => {
  const compiled = compile(MENU, "Menu.tsx");

  it("lowers onPress to a callback prop with no parameters", () => {
    const menu = compiled.ir.components.find((c) => c.name === "Menu")!;
    const [first] = menu.root.children.map((c) => elementOf(c));
    assert.equal(first!.component.name, "Pointer");
    assert.ok(first!.props.some((p) => p.kind === "CallbackProp" && p.name === "onPress"));
  });

  it("builds the pointer with its callback, and makes a Pointer-rooted component a Pointer", () => {
    assert.match(compiled.code, /new Pointer\(\{ width: 40, height: 20, onPress: \(\) => \{/);
    assert.match(compiled.code, /export class Button extends Pointer \{/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });
});

describe("M14: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M14${Math.random()}.tsx`,
        text: `import { Entity, Pointer } from "@rge/runtime/jsx";\nfunction C() { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts a size, a placement and a press handler", () => {
    assert.deepEqual(check(`<Pointer width={10} height={10} />`), []);
    assert.deepEqual(check(`<Pointer width={10} height={10} transform={{ x: 1 }} onPress={() => {}} />`), []);
  });

  it("rejects a missing size, a wrong type and children", () => {
    assert.ok(check(`<Pointer height={10} />`).length > 0);
    assert.ok(check(`<Pointer width="wide" height={10} />`).length > 0);
    assert.ok(check(`<Pointer width={1} height={1}><Entity name="x" /></Pointer>`).length > 0);
  });
});

describe("M14: runtime behaviour", () => {
  it("calls the handler for a press inside, and renders the state it sets", () => {
    const world = new World();
    const menu = new Menu();
    world.mount(menu);
    // The first pointer is at x 110..150, y 0..20 in the world.
    assert.equal(world.reportPress(menu.pointer, 120, 10), true);
    world.flush();
    assert.equal(menu.s.open, true);
    assert.equal(world.reportPress(menu.pointer, 90, 10), false, "outside");
    world.flush();
    assert.equal(menu.s.open, true);
  });

  it("follows its parent and its own state-driven size", () => {
    const world = new World();
    const menu = new Menu();
    world.mount(menu);
    assert.equal(world.reportPress(menu.pointer2, 104, 5), true, "100..105 wide at first");
    world.flush();
    assert.equal(menu.s.taps, 1);
    assert.equal(world.reportPress(menu.pointer2, 105.5, 5), true, "it grew with the state");
  });

  it("is a Pointer when it is a component's root", () => {
    const world = new World();
    const button = new Button();
    world.mount(button);
    assert.ok(button instanceof Pointer);
    world.reportPress(button, 5, 5);
    world.flush();
    assert.equal(button.s.pressed, 1);
  });
});

describe("M14: diagnostics", () => {
  it("rejects a handler with parameters", () => {
    const codes = compileErrors(`function C() { return <Entity name="C"><Pointer width={1} height={1} onPress={(x) => {}} /></Entity>; }`).map((d) => d.code);
    assert.deepEqual(codes, [DiagnosticCode.InvalidHandler]);
  });

  it("must be imported, and keeps its fields apart from the state of a component rooted at it", () => {
    const result = getCompiler().compile("C.tsx", `import { Entity } from "@rge/runtime/jsx";\nfunction C() { return <Entity name="C"><Pointer width={1} height={1} /></Entity>; }`);
    assert.deepEqual(result.diagnostics.map((d) => d.code), [DiagnosticCode.MissingImport]);
    // Since REACT_FEEL_PLAN.md B7 a name the root built-in has is the author's to use: its field is `$name`.
    assert.ok(compile(`function C() { const width = useMutable({ n: 1 }); return <Pointer width={width.n} height={1} />; }`).code.includes("get $width()"));
    assert.ok(compile(`function C() { const contains = useMutable({ n: 1 }); return <Pointer width={1} height={1} />; }`).code.includes("get $contains()"));
  });

  it("is placed with transform and is a leaf", () => {
    assert.ok(runtimeManifest.transformIntrinsics.includes("Pointer"));
    assert.ok(!runtimeManifest.containerIntrinsics.includes("Pointer"));
  });
});
