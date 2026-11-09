/**
 * `<Screen>`: the game's fixed resolution, as the root of the game (C1 in docs/UI_PLAN.md), and the layout offset
 * every object carries (U1). The compiler learns both from the runtime manifest; these tests check it does.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Screen, Shape, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const GAME = `
function Arena() {
  const [wide, setWide] = useState(false);
  return (
    <Screen width={wide ? 640 : 320} height={180} fit="contain" border="navy">
      <Shape kind="rect" width={8} height={8} transform={{ x: 4, y: 4 }} />
    </Screen>
  );
}

function Plain() {
  return (
    <Screen width={320} height={180}>
      <Shape kind="rect" width={8} height={8} />
    </Screen>
  );
}
`;

interface GameInstance extends Screen {
  setWide(value: boolean): void;
  readonly shape: Shape;
}

let Arena: new () => GameInstance;
let Plain: new () => Screen;

before(async () => {
  ({ Arena, Plain } = await load<{ Arena: typeof Arena; Plain: typeof Plain }>(compile(GAME, "Game.tsx")));
});

describe("Screen: a component rooted at one", () => {
  it("is a Screen, with its props and its children", () => {
    const world = new World();
    const game = new Arena();
    world.mount(game);
    assert.ok(game instanceof Screen);
    assert.deepEqual([game.width, game.height, game.fit, game.pixelPerfect, game.border], [320, 180, "contain", true, "navy"]);
    assert.equal(game.shape.parent, game);
    assert.deepEqual(game.shape.worldTransform(), { x: 4, y: 4, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("changes resolution from state", () => {
    const world = new World();
    const game = new Arena();
    world.mount(game);
    game.setWide(true);
    world.flush();
    assert.equal(game.width, 640);
  });

  it("takes the defaults it is not given", () => {
    const plain = new Plain();
    assert.deepEqual([plain.fit, plain.pixelPerfect, plain.border], ["integer", true, "black"]);
  });
});

describe("Screen: diagnostics", () => {
  it("checks fit against its choices, with a suggestion", () => {
    const errors = compileErrors(`function C() { return <Screen width={320} height={180} fit="integr" />; }`);
    assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.InvalidPropValue]);
    assert.match(errors[0]!.message, /<Screen fit> must be one of "integer", "contain", "stretch", not 'integr' \(did you mean "integer"\?\)/);
  });

  it("cannot be placed with transform", () => {
    const errors = compileErrors(`function C() { return <Screen width={320} height={180} transform={{ x: 4 }} />; }`);
    assert.ok(errors.some((d) => /<Screen> cannot be placed with `transform`/.test(d.message)), errors.map((d) => d.message).join("\n"));
  });

  it("type-checks in authored source: a width and a height are required, fit is one of its choices", () => {
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        { fileName: `${process.cwd()}/.test-output/Screen${Math.random()}.tsx`, text: `import { Screen, Shape } from "@rge/runtime/jsx";\nfunction C({ big }: { big: boolean }) { return ${element}; }` },
      ]);
    assert.deepEqual(check(`<Screen width={320} height={180} fit={big ? "stretch" : "contain"} pixelPerfect={false}><Shape kind="rect" width={1} height={1} /></Screen>`), []);
    assert.ok(check(`<Screen width={320} />`).length > 0, "no height");
    assert.ok(check(`<Screen width={320} height={180} fit={big ? "cover" : "contain"} />`).length > 0, "a bad fit inside an expression");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(GAME, "Game.tsx")), []);
  });

  it("keeps its own names reserved for a component rooted at one", () => {
    for (const name of ["fit", "pixelPerfect", "border"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Screen width={1} height={1} />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });
});

describe("the layout offset", () => {
  it("cannot be taken as a state name, since layout writes it into every object", () => {
    for (const name of ["layoutX", "layoutY"]) {
      const codes = compileErrors(`function C() { const [${name}, set] = useState(1); return <Entity name="C" />; }`).map((d) => d.code);
      assert.ok(codes.includes(DiagnosticCode.InvalidUseState), name);
    }
  });
});
