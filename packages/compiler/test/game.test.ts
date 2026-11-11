/** `<Game>`: the optional root that carries the game's configuration and its state. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Entity, Game } from "@rge/runtime";
import { Compiler, DiagnosticCode, formatDiagnostic } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, load, withAuthoringImports, type CompiledModule } from "./helpers.ts";

const ROOT = join(OUTPUT_ROOT, String(process.pid), "game");
const STATE_FILE = join(ROOT, "GameState.ts");
const STATE = `import { createGameState } from "@rge/runtime";

interface State { coins: number }

export const useGame = createGameState<State>()((set) => ({ coins: 0 }));
`;

let compiler: Compiler;
let counter = 0;
before(() => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(STATE_FILE, STATE);
  compiler = new Compiler();
  const { schema, diagnostics } = compiler.parseGameState(STATE_FILE, STATE);
  assert.deepEqual(diagnostics, []);
  compiler.setGameState({ ...schema!, importFrom: "../../GameState.ts" });
});
after(() => {
  compiler.close();
  closeCompiler();
  cleanOutput();
});

const HEADER = `import { useGame } from "./GameState.ts";\n`;

function build(source: string, name = "Main.tsx", c: Compiler = compiler): CompiledModule {
  const result = c.compile(name, withAuthoringImports(`${HEADER}${source}`));
  if (!result.ok) throw new Error(`Compilation failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
  return { ir: result.ir, code: result.code, fileName: join(ROOT, "out", String(++counter), name.replace(/\.tsx$/, ".ts")) };
}

function errors(source: string, c: Compiler = compiler): { code: string; message: string }[] {
  const result = c.compile("Invalid.tsx", withAuthoringImports(`${HEADER}${source}`));
  if (result.ok) throw new Error(`Expected compilation to fail, got:\n${result.code}`);
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => ({ code: d.code, message: d.message }));
}

const MAIN = `export default function Main() {
  return (
    <Game name="Main" state={useGame} title="Test" width={320} height={200} background="#112233" assets="art" resizable={false} smooth>
      <Entity name="child" />
    </Game>
  );
}`;

describe("<Game> as a component's root", () => {
  it("makes a class that extends Game, passing its settings and the store to the runtime", async () => {
    const compiled = build(MAIN);
    assert.match(compiled.code, /import \{ Entity, Game, type PrefabDefinition \} from "@rge\/runtime";/);
    assert.match(compiled.code, /import \{ useGame \} from "\.\.\/\.\.\/GameState\.ts";/);
    assert.match(compiled.code, /export class Main extends Game \{/);
    assert.match(compiled.code, /super\(\{ name: "Main", state: useGame, title: "Test", width: 320, height: 200, background: "#112233", assets: "art", resizable: false, smooth: true \}\);/);
    const g = compiler.typeCheck([{ fileName: compiled.fileName, text: compiled.code }]);
    assert.deepEqual(g, []);
    const { Main } = await load<{ Main: new () => Game }>(compiled);
    const main = new Main();
    assert.deepEqual([main.title, main.width, main.height, main.background, main.assets, main.resizable, main.smooth, main.vsync], ["Test", 320, 200, "#112233", "art", false, true, undefined], "a setting not written stays undefined, so the player can fall back");
    assert.equal(main.state && typeof main.state.store.reset, "function");
    assert.equal(main.children.length, 1);
    assert.ok(main instanceof Entity, "it is still a container, named like any entity");
  });

  it("takes fixedStep, the rate of the fixed timestep, as a literal setting", async () => {
    const compiled = build(`function Main() { return <Game fixedStep={60} />; }`);
    assert.match(compiled.code, /super\(\{ fixedStep: 60 \}\);/);
    const { Main } = await load<{ Main: new () => Game }>(compiled);
    assert.equal(new Main().fixedStep, 60);
    assert.equal(new Game().fixedStep, undefined, "off unless written");
    assert.match(errors(`function A() { const [n] = useState(60); return <Game fixedStep={n} />; }`)[0]!.message, /<Game fixedStep> must be a literal/);
  });

  it("lowers state={useGame} to the store itself, and needs nothing else", () => {
    const compiled = build(`function Main() { return <Game state={useGame} />; }`);
    const root = compiled.ir.components[0]!.root;
    assert.deepEqual(root.props, [{ kind: "StaticProp", name: "state", value: { kind: "StoreRef" } }]);
    const bare = build(`function Main() { return <Game />; }`);
    assert.deepEqual(bare.ir.components[0]!.root.props, []);
    assert.doesNotMatch(bare.code, /GameState/);
  });

  it("is optional: an Entity or a fragment root still works, and so does a game with no state", () => {
    assert.doesNotThrow(() => build(`function A() { return <Entity name="A" />; }`));
    assert.doesNotThrow(() => build(`function A() { return <><Entity name="a" /></>; }`));
    assert.doesNotThrow(() => build(`function A() { return <Game title="x" />; }`));
  });

  it("is the root of a component, never a child", () => {
    const found = errors(`function A() { return <Entity name="A"><Game title="x" /></Entity>; }`);
    assert.deepEqual(found.map((d) => d.code), [DiagnosticCode.RootMustBeEntity]);
    assert.match(found[0]!.message, /<Game> is the root of a component, never a child/);
  });

  it("takes only literals for its settings: they are read before the tree exists", () => {
    for (const setting of [`title={t}`, `width={w}`, `width={1 + 2}`, `title={"a" + "b"}`, `background={\`a\${t}\`}`, `smooth={flag}`, `resizable={!flag}`, `title={props.c}`]) {
      const found = errors(`function A() { const [t] = useState("x"); const [w] = useState(1); const [flag] = useState(true); return <Game ${setting} />; }`);
      assert.ok(found.some((d) => d.code === DiagnosticCode.InvalidPropValue || d.code === DiagnosticCode.UnsupportedExpression || d.code === DiagnosticCode.UnknownIdentifier), `${setting}: ${JSON.stringify(found)}`);
    }
    assert.match(errors(`function A() { const [t] = useState("x"); return <Game title={t} />; }`)[0]!.message, /<Game title> must be a literal/);
    assert.match(errors(`function A() { const [w] = useState(1); return <Game width={w} />; }`)[0]!.message, /<Game width> must be a literal/);
    assert.doesNotThrow(() => build(`function A() { return <Game width={-5} title="x" resizable={true} vsync smooth={false} />; }`));
  });

  it("rejects a prop it does not have, and a transform, saying what its settings are", () => {
    const unknown = errors(`function A() { return <Game fps={30} />; }`);
    assert.equal(unknown[0]!.code, DiagnosticCode.UnsupportedAttribute);
    assert.match(unknown[0]!.message, /<Game> has no prop 'fps'\. Its settings: title, width, height, background, assets, resizable, vsync, smooth, fullscreenKey, fixedStep, gamepadDeadzone, upscale, showFps, fpsKey, state, controls\./);
    assert.deepEqual(errors(`function A() { return <Game transform={{ x: 1 }} />; }`).map((d) => d.code), [DiagnosticCode.InvalidTransformAttribute]);
  });

  it("takes only the game state as its state", () => {
    const notStore = errors(`function A() { const [s] = useState(0); return <Game state={s} />; }`);
    assert.equal(notStore[0]!.code, DiagnosticCode.InvalidGameState);
    assert.match(notStore[0]!.message, /`state=\{useGame\}`, imported from GameState\.ts/);
    assert.equal(errors(`function A() { return <Game state="x" />; }`)[0]!.code, DiagnosticCode.InvalidGameState);
    const none = errors(`function A() { return <Game state={useGame} />; }`, new Compiler());
    assert.ok(none.some((d) => d.code === DiagnosticCode.InvalidGameState));
  });

  it("does not let a component use the store as a value anywhere else", () => {
    assert.ok(errors(`function A() { const x = useGame; return <Entity />; }`).length > 0);
    assert.ok(errors(`function A() { return <Text size={useGame}>x</Text>; }`).length > 0);
  });

  it("keeps Game out of the names a component may take", () => {
    assert.deepEqual(errors(`function Game() { return <Entity />; }`).map((d) => d.code), [DiagnosticCode.DuplicateComponent]);
  });

  it("is checked in the authored source too: the store is the right type, a setting the right type", () => {
    const file = (text: string) => [{ fileName: join(ROOT, "Src.tsx"), text }];
    const good = `import { Game } from "@rge/runtime/jsx";\nimport { useGame } from "./GameState.ts";\nexport function Main() { return <Game state={useGame} title="t" width={320} />; }`;
    assert.deepEqual(compiler.typeCheckSources(file(good)).map((d) => d.message), []);
    assert.ok(compiler.typeCheckSources(file(good.replace('width={320}', 'width="320"'))).length > 0, "width is a number");
    assert.ok(compiler.typeCheckSources(file(good.replace('title="t"', 'title={5}'))).length > 0, "title is a string");
    assert.ok(compiler.typeCheckSources(file(good.replace('state={useGame}', 'state={5}'))).length > 0, "state is a game state");
  });
});
