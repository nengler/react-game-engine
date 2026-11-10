/** The game state: `createGameState({ state, actions })` in GameState.ts, read with selectors, changed by actions. */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Entity, Text, World, resetGameState, type GameState, type GameStore } from "@rge/runtime";
import { Compiler, DiagnosticCode, formatDiagnostic } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, load, withAuthoringImports, type CompiledModule } from "./helpers.ts";

const ROOT = join(OUTPUT_ROOT, String(process.pid), "gs");
const STATE_FILE = join(ROOT, "GameState.ts");
const STATE = `import { createGameState } from "@rge/runtime";

interface State {
  coins: number;
  player: { hp: number; name: string };
  muted: boolean;
  collect: (n: number) => void;
  hurt: () => void;
  rename: (name: string) => void;
  noop: () => void;
}

export const useGame = createGameState<State>()((set) => ({
  coins: 0,
  player: { hp: 10, name: "Ada" },
  muted: false,
  collect: (n) => set((s) => ({ coins: s.coins + n })),
  hurt: () => set((s) => ({ player: { ...s.player, hp: s.player.hp - 1 } })),
  rename: (name) => set((s) => ({ player: { ...s.player, name } })),
  noop: () => set({}),
}));
`;

let compiler: Compiler;
let store: GameStore;
let useGame: GameState<{ coins: number; player: { hp: number; name: string } }>;
/** Call an action of the game state, as a handler would. */
const act = (name: string, ...args: unknown[]): void => (useGame.getState() as unknown as Record<string, (...a: unknown[]) => void>)[name]!(...args);
let counter = 0;

before(async () => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(STATE_FILE, STATE);
  compiler = new Compiler();
  const { schema, diagnostics } = compiler.parseGameState(STATE_FILE, STATE);
  assert.deepEqual(diagnostics, []);
  compiler.setGameState({ ...schema!, importFrom: "../GameState.ts" });
  useGame = ((await import(pathToFileURL(STATE_FILE).href)) as { useGame: typeof useGame }).useGame;
  store = useGame.store;
});
after(() => {
  compiler.close();
  closeCompiler();
  cleanOutput();
});
beforeEach(() => resetGameState());

function build(source: string, name = "Test.tsx"): CompiledModule {
  const result = compiler.compile(name, withAuthoringImports(`import { useGame } from "./GameState.ts";\n${source}`));
  if (!result.ok) throw new Error(`Compilation failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
  return { ir: result.ir, code: result.code, fileName: join(ROOT, "out", String(++counter), name.replace(/\.tsx$/, ".ts")) };
}

/** Where a generated file's `../GameState.ts` resolves: one directory up from `out/`, so the file sits in `out/<n>/` and the import is fixed up. */
function generated(compiled: CompiledModule): CompiledModule {
  return { ...compiled, code: compiled.code.replace('"../GameState.ts"', '"../../GameState.ts"') };
}

function typeErrors(compiled: CompiledModule) {
  const g = generated(compiled);
  return compiler.typeCheck([{ fileName: g.fileName, text: g.code }]);
}

function errors(source: string, c: Compiler = compiler, header = `import { useGame } from "./GameState.ts";\n`): { code: string; message: string }[] {
  const result = c.compile("Invalid.tsx", withAuthoringImports(`${header}${source}`));
  if (result.ok) throw new Error(`Expected compilation to fail, got:\n${result.code}`);
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => ({ code: d.code, message: d.message }));
}

const SCORER = `
export function Scorer() {
  const collect = useGame((s) => s.collect);
  useUpdate(() => collect(1));
  return <Entity name="Scorer" />;
}
`;

const HUD = `
export function Scoreboard() {
  const coins = useGame((s) => s.coins);
  return <Text size={12} color="white">Coins: {coins}</Text>;
}
`;

const HP = `
export function HpBar() {
  const hp = useGame((s) => s.player.hp);
  return <Text size={12} color="white">HP {hp}</Text>;
}
`;

describe("GameState.ts", () => {
  const read = (text: string) => compiler.parseGameState("GameState.ts", `import { createGameState } from "@rge/runtime";\n${text}`);
  const wrap = (body: string) => `export const useGame = createGameState((set) => (${body}));`;

  it("reads a nested state tree with typed leaves, and the actions, in both creator forms", () => {
    const body = `{ coins: 0, player: { hp: -3, "name": "Ada", flags: { muted: false } }, collect() { set({}); }, hurt: () => set({}), heal: function () { set({}); } }`;
    for (const text of [wrap(body), `export const useGame = createGameState<State>()((set, get) => (${body}));`, `export const useGame = createGameState((set) => { return ${body}; });`]) {
      const { schema, diagnostics } = read(text);
      assert.deepEqual(diagnostics, [], text);
      assert.equal(schema!.name, "useGame");
      assert.deepEqual(schema!.actions, ["collect", "hurt", "heal"]);
      assert.deepEqual(schema!.tree, {
        kind: "node",
        children: {
          coins: { kind: "leaf", type: "number", initial: 0 },
          player: {
            kind: "node",
            children: {
              hp: { kind: "leaf", type: "number", initial: -3 },
              name: { kind: "leaf", type: "string", initial: "Ada" },
              flags: { kind: "node", children: { muted: { kind: "leaf", type: "boolean", initial: false } } },
            },
          },
        },
      });
    }
  });

  it("rejects what it cannot understand, saying why", () => {
    const codes = (text: string) => read(text).diagnostics.map((d) => d.code);
    for (const text of [
      wrap(`{ items: [] }`),
      wrap(`{ a: 1, a: 2 }`),
      wrap(`{ a: 1, a() {} }`),
      wrap(`{ "a.b": 1 }`),
      wrap(`{ a }`),
      wrap(`{ a: 1 + 1 }`),
      wrap(`{ nested: { act: () => 1 } }`),
      wrap(`makeState()`),
      `export const useGame = createGameState(makeCreator);`,
      `export const useGame = createGameState((set) => { const x = 1; return { x }; });`,
      `const useGame = createGameState((set) => ({ a: 1 }));`,
      `export const other = 5;`,
      `${wrap(`{}`)}\nexport const useOther = createGameState((set) => ({}));`,
    ]) {
      assert.deepEqual(codes(text), [DiagnosticCode.InvalidGameStateSchema], text);
    }
  });
});

describe("compiling a selector", () => {
  it("makes a state mirroring one leaf, with the schema's type, and reads it from the store", () => {
    const compiled = build(HP);
    const state = compiled.ir.components[0]!.state[0]!;
    assert.equal(state.globalKey, "player.hp");
    assert.deepEqual(state.type, { kind: "Primitive", name: "number" });
    assert.deepEqual(state.initialValue, { kind: "NumberLiteral", value: 10 });
    assert.match(compiled.code, /import \{ useGame \} from "\.\.\/GameState\.ts";/);
    assert.match(compiled.code, /hp: number = useGame\.store\.get<number>\("player\.hp"\);/);
    assert.match(compiled.code, /override readonly gameStateStore = useGame\.store;/);
    assert.match(compiled.code, /override readonly gameStateKeys: readonly string\[\] = \["player\.hp"\];/);
    assert.match(compiled.code, /override commitState\(\): void \{\s+this\.hp = useGame\.store\.get<number>\("player\.hp"\);/);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("types string and boolean leaves, and a handler reads them as it reads state", () => {
    const compiled = build(`
export function Settings() {
  const who = useGame((s) => s.player.name);
  const muted = useGame((s) => s.muted);
  const rename = useGame((s) => s.rename);
  useUpdate(() => { if (!muted && who === "Ada") rename("Bo"); });
  return <Text size={12}>{who}</Text>;
}`);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("binds an action: called as a statement in a handler, with arguments, reading nothing", () => {
    const compiled = build(SCORER);
    const [component] = compiled.ir.components;
    assert.deepEqual(component!.state, [], "an action is not state");
    assert.doesNotMatch(compiled.code, /gameStateKeys|commitState/);
    assert.match(compiled.code, /useGame\.getState\(\)\.collect\(1\);/);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("does not touch a component that uses only useState", () => {
    const compiled = build(`function A() { const [n, setN] = useState(0); useUpdate(() => setN(n + 1)); return <Entity />; }`);
    assert.doesNotMatch(compiled.code, /GameState|useGame/);
  });

  it("reports a wrong path with the nearest key at the level it went wrong", () => {
    const [top] = errors(`function A() { const c = useGame((s) => s.coin); return <Entity />; }`);
    assert.equal(top!.code, DiagnosticCode.InvalidGameState);
    assert.match(top!.message, /'coin' is not in the game state \(did you mean "coins"\?\)\. State: coins, player, muted, collect, hurt, rename, noop\./);
    const [nested] = errors(`function A() { const c = useGame((s) => s.player.hpp); return <Entity />; }`);
    assert.match(nested!.message, /'player\.hpp' is not in the game state \(did you mean "player\.hp"\?\)\. 'player' has: hp, name\./);
    const [through] = errors(`function A() { const c = useGame((s) => s.coins.total); return <Entity />; }`);
    assert.match(through!.message, /'coins' is a number, so it has no 'total'/);
  });

  it("asks for a leaf when the selector names an object", () => {
    const [d] = errors(`function A() { const p = useGame((s) => s.player); return <Entity />; }`);
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /'player' is an object: select one of its values \(player\.hp, player\.name\)/);
  });

  it("accepts only a plain path as the selector, bound with const, at the top level", () => {
    for (const call of [
      `useGame((s) => s.coins + 1)`,
      `useGame((s) => { return s.coins; })`,
      `useGame((s, t) => s.coins)`,
      `useGame(select)`,
      `useGame()`,
      `useGame((s) => s)`,
      `useGame((s) => other.coins)`,
      `useGame<number>((s) => s.coins)`,
    ]) {
      const found = errors(`function A() { const select = null; const c = ${call}; return <Entity />; }`);
      assert.ok(found.some((d) => d.code === DiagnosticCode.InvalidUseState), `${call}: ${JSON.stringify(found)}`);
    }
    assert.ok(errors(`function A() { let c = useGame((s) => s.coins); return <Entity />; }`).some((d) => d.code === DiagnosticCode.InvalidUseState));
    assert.ok(errors(`function A() { if (true) { const c = useGame((s) => s.coins); } return <Entity />; }`).some((d) => d.code === DiagnosticCode.HookNotAtTopLevel));
  });

  it("keeps an action out of values: it is only called, as a statement, and not in an updater", () => {
    const run = (body: string) => errors(`function A() { const [n, setN] = useState(0); const hurt = useGame((s) => s.hurt); ${body} return <Entity name="A" />; }`).map((d) => d.code);
    assert.deepEqual(run(`useUpdate(() => { const x = hurt; });`), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(run(`useUpdate(() => { setN(hurt()); });`), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(run(`useUpdate(() => { setN((n) => { hurt(); return n; }); });`), [DiagnosticCode.SoundOutsideHandler]);
    assert.ok(errors(`function A() { const hurt = useGame((s) => s.hurt); return <Text size={hurt}>x</Text>; }`).length > 0);
  });

  it("imports only the game state from a .ts module, and needs one to exist", () => {
    assert.deepEqual(errors(`function A() { return <Entity />; }`, compiler, `import { useOther } from "./GameState.ts";\n`).map((d) => d.code), [DiagnosticCode.InvalidGameState]);
    const none = errors(`function A() { const c = useGame((s) => s.coins); return <Entity />; }`, new Compiler());
    assert.deepEqual(none.map((d) => d.code), [DiagnosticCode.InvalidGameState]);
    assert.match(none[0]!.message, /no game state to import/);
  });

  it("is checked in the authored source too: a wrong path, a wrong type, a wrong argument is a type error", () => {
    const file = (text: string) => [{ fileName: join(ROOT, "Src.tsx"), text }];
    const good = `import { Entity, useUpdate } from "@rge/runtime/jsx";\nimport { useGame } from "./GameState.ts";\nexport function A() {\n  const coins = useGame((s) => s.coins);\n  const collect = useGame((s) => s.collect);\n  const n: number = coins;\n  useUpdate(() => collect(n));\n  return <Entity />;\n}`;
    assert.deepEqual(compiler.typeCheckSources(file(good)).map((d) => d.message), []);
    assert.ok(compiler.typeCheckSources(file(good.replace("s.coins", "s.coin"))).length > 0, "unknown path");
    assert.ok(compiler.typeCheckSources(file(good.replace("const n: number = coins", "const n: string = coins"))).length > 0, "coins is a number");
    assert.ok(compiler.typeCheckSources(file(good.replace("collect(n)", 'collect("x")'))).length > 0, "collect takes a number");
    assert.ok(compiler.typeCheckSources(file(good.replace("collect(n)", "collect()"))).length > 0, "collect needs its argument");
  });
});

describe("running a game state", () => {
  interface Scorer extends Entity {}
  interface Reader extends Text {
    coins?: number;
    hp?: number;
    renders: number;
  }

  /** A component's generated module, loaded; its `../GameState.ts` import resolved to the real file. */
  async function make<T>(source: string, name: string): Promise<T> {
    return load<T>(generated(build(source, name)));
  }

  async function game() {
    const { Scorer } = await make<{ Scorer: new () => Scorer }>(SCORER, "Scorer.tsx");
    const { Scoreboard } = await make<{ Scoreboard: new () => Reader }>(HUD, "Scoreboard.tsx");
    const { HpBar } = await make<{ HpBar: new () => Reader }>(HP, "HpBar.tsx");
    const world = new World();
    const root = new Entity({ name: "root" });
    const scorer = new Scorer();
    const hud = new Scoreboard();
    const hpBar = new HpBar();
    root.addChild(scorer);
    root.addChild(hud);
    root.addChild(hpBar);
    world.mount(root);
    world.flush();
    return { world, scorer, hud, hpBar };
  }

  it("shares a value: an action called by one component shows in another on the same frame", async () => {
    const { world, hud } = await game();
    assert.equal(hud.text, "Coins: 0");
    world.tick(0.1); // the scorer's handler collects 1
    assert.equal(hud.text, "Coins: 1", "the HUD, which only reads, was told and rendered");
    world.tick(0.1);
    world.tick(0.1);
    assert.equal(hud.text, "Coins: 3");
  });

  it("re-renders a component only when the leaf it reads changes", async () => {
    const { world, hpBar } = await game();
    assert.equal(hpBar.text, "HP 10");
    world.tick(0.1);
    world.tick(0.1);
    assert.equal(store.get("coins"), 2);
    assert.equal(hpBar.isDirty, false, "coins changed, hp did not");
    act("hurt");
    assert.equal(hpBar.isDirty, true);
    world.flush();
    assert.equal(hpBar.text, "HP 9");
  });

  it("gives every handler in a frame the same snapshot, whatever an action changes meanwhile", async () => {
    const { world, hud } = await game();
    act("collect", 10);
    assert.equal(store.get("coins"), 10, "the store has it at once");
    assert.equal(hud.text, "Coins: 0", "a component's own snapshot waits for its render");
    world.flush();
    assert.equal(hud.text, "Coins: 10");
  });

  it("applies actions in order against the latest state, and an action that changes nothing renders nothing", async () => {
    const { world, hud } = await game();
    act("collect", 1);
    act("collect", 2);
    act("collect", 3);
    world.flush();
    assert.equal(hud.text, "Coins: 6");
    act("noop");
    assert.equal(world.flush(), 0);
    act("rename", "Ada");
    assert.equal(world.flush(), 0, "writing the value it already has changes nothing");
  });

  it("merges what set is given shallowly, as Zustand does: a nested object is replaced as a whole", async () => {
    const { world, hpBar } = await game();
    act("rename", "Bo");
    assert.equal(store.get("player.name"), "Bo");
    assert.equal(store.get("player.hp"), 10, "the action spread the rest of the object, so hp survived");
    assert.equal(hpBar.isDirty, false, "hp is the same value, so its reader is not told");
    useGame.setState({ player: { hp: 3, name: "Cy" } });
    assert.deepEqual(useGame.getState().player, { hp: 3, name: "Cy" });
    useGame.setState((s) => ({ coins: s.coins + 5 }));
    assert.equal(store.get("coins"), 5);
    world.flush();
    assert.equal(hpBar.text, "HP 3");
  });

  it("starts a component built later from the current value, and catches up one built before a change it missed", async () => {
    const { Scoreboard } = await make<{ Scoreboard: new () => Reader }>(HUD, "Scoreboard.tsx");
    act("collect", 7);
    const early = new Scoreboard();
    assert.equal(early.text, "Coins: 7", "built after the change: starts from it");
    act("collect", 2);
    const world = new World();
    world.mount(early);
    world.flush();
    assert.equal(early.text, "Coins: 9", "mounted after a change it missed: caught up on mounting");
  });

  it("stops telling a component that left the world, and resetGameState puts everything back", async () => {
    const { world, hud, scorer } = await game();
    hud.parent!.removeChild(hud);
    world.flush();
    act("collect", 5);
    assert.equal(hud.isDirty, false, "a detached component is not marked");
    resetGameState();
    assert.equal(store.get("coins"), 0);
    void scorer;
  });
});
