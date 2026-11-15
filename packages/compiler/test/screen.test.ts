import assert from "node:assert/strict";
/**
 * `<Screen>`: the game's fixed resolution, as the root of the game (C1 in docs/UI_PLAN.md), and the layout offset
 * every object carries (U1). The compiler learns both from the runtime manifest; these tests check it does.
 */
import { after, before, describe, it } from "node:test";

import { Hud, Screen, Shape, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const GAME = `
function Arena() {
  const s = useMutable({ wide: false });
  return (
    <Screen width={s.wide ? 640 : 320} height={180} fit="contain" border="navy">
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
  readonly shape: Shape;
  s: { [field: string]: unknown };
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
    game.s.wide = true;
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
    assert.deepEqual(
      errors.map((d) => d.code),
      [DiagnosticCode.InvalidPropValue]
    );
    assert.match(
      errors[0]!.message,
      /<Screen fit> must be one of "integer", "contain", "stretch", "expand", not 'integr' \(did you mean "integer"\?\)/
    );
  });

  it("cannot be placed with transform", () => {
    const errors = compileErrors(`function C() { return <Screen width={320} height={180} transform={{ x: 4 }} />; }`);
    assert.ok(
      errors.some((d) => /<Screen> cannot be placed with `transform`/.test(d.message)),
      errors.map((d) => d.message).join("\n")
    );
  });

  it("type-checks in authored source: a width and a height are required, fit is one of its choices", () => {
    const check = (element: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/Screen${Math.random()}.tsx`,
          text: `import { Screen, Shape } from "@tsengine/runtime/jsx";\nfunction C({ big }: { big: boolean }) { return ${element}; }`,
        },
      ]);
    assert.deepEqual(
      check(
        `<Screen width={320} height={180} fit={big ? "stretch" : "contain"} pixelPerfect={false}><Shape kind="rect" width={1} height={1} /></Screen>`
      ),
      []
    );
    assert.ok(check(`<Screen width={320} />`).length > 0, "no height");
    assert.ok(check(`<Screen width={320} height={180} fit={big ? "cover" : "contain"} />`).length > 0, "a bad fit inside an expression");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(GAME, "Game.tsx")), []);
  });

  it("lets state take its own names, kept in `$name` fields", () => {
    for (const name of ["fit", "pixelPerfect", "border"]) {
      assert.ok(
        compile(`function C() { const ${name} = useMutable({ n: 1 }); return <Screen width={1} height={1} />; }`).code.includes(
          `get $${name}()`
        ),
        name
      );
    }
  });
});

describe("Hud", () => {
  const HUD_GAME = `
interface PanelProps {
  coins: number;
}
function Panel({ coins }: PanelProps) {
  return (
    <Hud transform={{ x: 8, y: 4 }}>
      <Text size={8}>Coins: {coins}</Text>
    </Hud>
  );
}
function Level() {
  return (
    <Entity name="Level">
      <Panel coins={3} />
    </Entity>
  );
}
`;

  it("is a container that can be placed, and a component can be rooted at one", async () => {
    const { Panel } = await load<{ Panel: new (props: { coins: number }) => Hud & { setCoins?: never } }>(compile(HUD_GAME, "HudGame.tsx"));
    const panel = new Panel({ coins: 3 });
    new World().mount(panel);
    assert.ok(panel instanceof Hud);
    assert.equal(panel.children.length, 1);
    assert.deepEqual(panel.children[0]!.worldTransform(), { x: 8, y: 4, rotation: 0, scaleX: 1, scaleY: 1 });
  });

  it("type-checks in authored source and in the generated module", () => {
    assert.deepEqual(typeCheck(compile(HUD_GAME, "HudGame.tsx")), []);
    const check = getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/Hud${Math.random()}.tsx`,
        text: `import { Hud, Text } from "@tsengine/runtime/jsx";\nfunction C() { return <Hud transform={{ x: 1 }}><Text size={8}>x</Text></Hud>; }`,
      },
    ]);
    assert.deepEqual(check, []);
  });

  it("lets a component called Hud shadow the built-in, but not in a file that imports <Hud>", () => {
    assert.match(compile(`function Hud() { return <Entity name="Hud" />; }`).code, /class Hud extends Entity/);
    const clash = compileErrors(`import { Entity, Hud } from "@tsengine/runtime/jsx"; function Hud() { return <Entity name="Hud" />; }`);
    assert.ok(
      clash.some((d) => /conflicts with the built-in <Hud> this file imports/.test(d.message)),
      clash.map((d) => d.message).join("\n")
    );
  });
});

describe("the layout offset", () => {
  it("can be a state name, kept apart from the field layout writes into every object", () => {
    for (const name of ["layoutX", "layoutY"]) {
      assert.ok(
        compile(`function C() { const ${name} = useMutable({ n: 1 }); return <Entity name="C" />; }`).code.includes(`get $${name}()`),
        name
      );
    }
  });
});
