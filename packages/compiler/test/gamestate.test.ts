/** The game state: `createGameState({ state, actions })` in GameState.ts, read with selectors, changed by actions. */
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Entity, Text, World, resetGameState, type GameStore } from "@rge/runtime";
import { Compiler, DiagnosticCode, formatDiagnostic } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, load, withAuthoringImports, type CompiledModule } from "./helpers.ts";

const ROOT = join(OUTPUT_ROOT, String(process.pid), "gs");
const STATE_FILE = join(ROOT, "GameState.ts");
const STATE = `import { createGameState } from "@rge/runtime";

export const useGame = createGameState({
  coins: 0,
  player: { hp: 10, name: "Ada" },
  muted: false,
});
`;

let compiler: Compiler;
let store: GameStore;
let counter = 0;

before(async () => {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(STATE_FILE, STATE);
  compiler = new Compiler();
  const { schema, diagnostics } = compiler.parseGameState(STATE_FILE, STATE);
  assert.deepEqual(diagnostics, []);
  compiler.setGameState({ ...schema!, importFrom: "../GameState.ts" });
  store = ((await import(pathToFileURL(STATE_FILE).href)) as { useGame: { store: GameStore } }).useGame.store;
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
  const [, setCoins] = useGame((s) => s.coins);
  useUpdate(() => setCoins((n) => n + 1));
  return <Entity name="Scorer" />;
}
`;

const HUD = `
export function Hud() {
  const [coins] = useGame((s) => s.coins);
  return <Text size={12} color="white">Coins: {coins}</Text>;
}
`;

const HP = `
export function HpBar() {
  const [hp] = useGame((s) => s.player.hp);
  return <Text size={12} color="white">HP {hp}</Text>;
}
`;

describe("GameState.ts", () => {
  const read = (text: string) => compiler.parseGameState("GameState.ts", `import { createGameState } from "@rge/runtime";\n${text}`);
  const wrap = (state: string) => `export const useGame = createGameState(${state});`;

  it("reads a nested state tree with typed leaves", () => {
    const { schema, diagnostics } = read(wrap(`{ coins: 0, player: { hp: -3, "name": "Ada", flags: { muted: false } } } as const`));
    assert.deepEqual(diagnostics, []);
    assert.equal(schema!.name, "useGame");
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
  });

  it("rejects what it cannot understand, saying why", () => {
    const codes = (text: string) => read(text).diagnostics.map((d) => d.code);
    for (const text of [
      wrap(`{ items: [] }`),
      wrap(`{ a: 1, a: 2 }`),
      wrap(`{ "a.b": 1 }`),
      wrap(`{ a }`),
      wrap(`{ a: 1 + 1 }`),
      wrap(`{ a: () => 1 }`),
      wrap(`makeState()`),
      `const useGame = createGameState({ a: 1 });`,
      `export const other = 5;`,
      `${wrap(`{}`)}\nexport const useOther = createGameState({});`,
    ]) {
      assert.deepEqual(codes(text), [DiagnosticCode.InvalidGameStateSchema], text);
    }
  });
});

describe("compiling a selector", () => {
  it("makes a state mirroring one leaf, with the schema's type, a snapshot read from the store and a setter that writes it", () => {
    const compiled = build(`export function HpBar() {
  const [hp, setHp] = useGame((s) => s.player.hp);
  useUpdate(() => { if (hp > 0) setHp((h) => h - 1); });
  return <Text size={12}>HP {hp}</Text>;
}`);
    const state = compiled.ir.components[0]!.state[0]!;
    assert.equal(state.globalKey, "player.hp");
    assert.deepEqual(state.type, { kind: "Primitive", name: "number" });
    assert.deepEqual(state.initialValue, { kind: "NumberLiteral", value: 10 });
    assert.match(compiled.code, /import \{ useGame \} from "\.\.\/GameState\.ts";/);
    assert.match(compiled.code, /hp: number = useGame\.store\.get<number>\("player\.hp"\);/);
    assert.match(compiled.code, /override readonly gameStateStore = useGame\.store;/);
    assert.match(compiled.code, /override readonly gameStateKeys: readonly string\[\] = \["player\.hp"\];/);
    assert.match(compiled.code, /setHp\(value: number \| \(\(previous: number\) => number\)\): void \{\s+useGame\.store\.set<number>\("player\.hp", value\);/);
    assert.match(compiled.code, /override commitState\(\): void \{\s+this\.hp = useGame\.store\.get<number>\("player\.hp"\);/);
    assert.match(compiled.code, /this\.setHp\(\(h: number\) => h - 1\)/);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("types string and boolean leaves, and a handler reads and sets them as it does useState", () => {
    const compiled = build(`
export function Settings() {
  const [who, setWho] = useGame((s) => s.player.name);
  const [muted, setMuted] = useGame((s) => s.muted);
  useUpdate(() => { if (!muted && who === "Ada") { setWho("Bo"); setMuted(true); } });
  return <Text size={12}>{who}</Text>;
}`);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("lets a component only set a leaf: no snapshot, no subscription, no re-render when it changes", () => {
    const compiled = build(SCORER);
    assert.equal(compiled.ir.components[0]!.state[0]!.writeOnly, true);
    assert.doesNotMatch(compiled.code, /gameStateKeys|commitState|store\.get/);
    assert.match(compiled.code, /useGame\.store\.set<number>\("coins", value\)/);
    assert.deepEqual(typeErrors(compiled), []);
    assert.deepEqual(errors(`function A() { const [,] = useGame((s) => s.coins); return <Entity />; }`).map((d) => d.code), [DiagnosticCode.InvalidUseState]);
  });

  it("does not touch a component that uses only useState", () => {
    const compiled = build(`function A() { const [n, setN] = useState(0); useUpdate(() => setN(n + 1)); return <Entity />; }`);
    assert.doesNotMatch(compiled.code, /GameState|useGame/);
  });

  it("reports a wrong path with the nearest key at the level it went wrong", () => {
    const [top] = errors(`function A() { const [c] = useGame((s) => s.coin); return <Entity />; }`);
    assert.equal(top!.code, DiagnosticCode.InvalidGameState);
    assert.match(top!.message, /'coin' is not in the game state \(did you mean "coins"\?\)\. State: coins, player, muted\./);
    const [nested] = errors(`function A() { const [c] = useGame((s) => s.player.hpp); return <Entity />; }`);
    assert.match(nested!.message, /'player\.hpp' is not in the game state \(did you mean "player\.hp"\?\)\. 'player' has: hp, name\./);
    const [through] = errors(`function A() { const [c] = useGame((s) => s.coins.total); return <Entity />; }`);
    assert.match(through!.message, /'coins' is a number, so it has no 'total'/);
  });

  it("asks for a leaf when the selector names an object", () => {
    const [d] = errors(`function A() { const [p] = useGame((s) => s.player); return <Entity />; }`);
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /'player' is an object: select one of its values \(player\.hp, player\.name\)/);
  });

  it("accepts only a plain path as the selector, destructured like useState, at the top level", () => {
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
      const found = errors(`function A() { const select = null; const [c] = ${call}; return <Entity />; }`);
      assert.ok(found.some((d) => d.code === DiagnosticCode.InvalidUseState), `${call}: ${JSON.stringify(found)}`);
    }
    for (const binding of [`let [c] =`, `const c =`, `const [a, b, d] =`, `const [...c] =`]) {
      assert.ok(errors(`function A() { ${binding} useGame((s) => s.coins); return <Entity />; }`).some((d) => d.code === DiagnosticCode.InvalidUseState), binding);
    }
    assert.ok(errors(`function A() { if (true) { const [c] = useGame((s) => s.coins); } return <Entity />; }`).some((d) => d.code === DiagnosticCode.HookNotAtTopLevel));
  });

  it("shares the setter rules of useState: not in an unmount handler, names may not collide", () => {
    assert.ok(errors(`function A() { const [c, setC] = useGame((s) => s.coins); useUnmount(() => setC(1)); return <Entity name="A" />; }`).some((d) => d.code === DiagnosticCode.UnsupportedStatement));
    assert.deepEqual(errors(`function A() { const [c, setC] = useGame((s) => s.coins); const [c2, setC2] = useState(0); const [c] = useGame((s) => s.muted); return <Entity />; }`).map((d) => d.code), [DiagnosticCode.InvalidUseState]);
  });

  it("imports only the game state from a .ts module, and needs one to exist", () => {
    assert.deepEqual(errors(`function A() { return <Entity />; }`, compiler, `import { other } from "./GameState.ts";\n`).map((d) => d.code), [DiagnosticCode.InvalidGameState]);
    const none = errors(`function A() { const [c] = useGame((s) => s.coins); return <Entity />; }`, new Compiler());
    assert.deepEqual(none.map((d) => d.code), [DiagnosticCode.InvalidGameState]);
    assert.match(none[0]!.message, /no game state to import/);
  });

  it("is checked in the authored source too: a wrong path or type is a type error, and the setter takes what useState's does", () => {
    const file = (text: string) => [{ fileName: join(ROOT, "Src.tsx"), text }];
    const good = `import { Entity, useUpdate } from "@rge/runtime/jsx";\nimport { useGame } from "./GameState.ts";\nexport function A() {\n  const [coins, setCoins] = useGame((s) => s.coins);\n  const n: number = coins;\n  useUpdate(() => { setCoins(n + 1); setCoins((c) => c + 1); });\n  return <Entity />;\n}`;
    assert.deepEqual(compiler.typeCheckSources(file(good)).map((d) => d.message), []);
    assert.ok(compiler.typeCheckSources(file(good.replace("s.coins", "s.coin"))).length > 0, "unknown path");
    assert.ok(compiler.typeCheckSources(file(good.replace("const n: number = coins", "const n: string = coins"))).length > 0, "coins is a number");
    assert.ok(compiler.typeCheckSources(file(good.replace("setCoins(n + 1)", 'setCoins("x")'))).length > 0, "coins is set to a number");
    assert.ok(compiler.typeCheckSources(file(good.replace("s.coins", "s.player"))).length > 0, "an object is not a leaf");
  });
});

describe("running a game state", () => {
  interface Scorer extends Entity {
    setCoins(value: number | ((n: number) => number)): void;
  }
  interface Reader extends Text {
    renders: number;
  }

  /** A component's generated module, loaded; its `../GameState.ts` import resolved to the real file. */
  async function make<T>(source: string, name: string): Promise<T> {
    return load<T>(generated(build(source, name)));
  }

  async function game() {
    const { Scorer } = await make<{ Scorer: new () => Scorer }>(SCORER, "Scorer.tsx");
    const { Hud } = await make<{ Hud: new () => Reader }>(HUD, "Hud.tsx");
    const { HpBar } = await make<{ HpBar: new () => Reader }>(HP, "HpBar.tsx");
    const world = new World();
    const root = new Entity({ name: "root" });
    const scorer = new Scorer();
    const hud = new Hud();
    const hpBar = new HpBar();
    root.addChild(scorer);
    root.addChild(hud);
    root.addChild(hpBar);
    world.mount(root);
    world.flush();
    return { world, scorer, hud, hpBar };
  }

  it("shares a value: a setter in one component shows in another on the same frame", async () => {
    const { world, hud } = await game();
    assert.equal(hud.text, "Coins: 0");
    world.tick(0.1); // the scorer's handler adds one
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
    store.set("player.hp", 9);
    assert.equal(hpBar.isDirty, true);
    world.flush();
    assert.equal(hpBar.text, "HP 9");
  });

  it("gives every handler in a frame the same snapshot, as useState does", async () => {
    const { world, scorer, hud } = await game();
    scorer.setCoins(10);
    assert.equal(store.get("coins"), 10, "the store has it at once");
    assert.equal(hud.text, "Coins: 0", "a component's own snapshot waits for its render");
    world.flush();
    assert.equal(hud.text, "Coins: 10");
  });

  it("chains updaters on the latest value and ignores a write that changes nothing", async () => {
    const { world, scorer, hud } = await game();
    scorer.setCoins((n) => n + 1);
    scorer.setCoins((n) => n + 1);
    scorer.setCoins((n) => n * 10);
    world.flush();
    assert.equal(hud.text, "Coins: 20");
    scorer.setCoins(20);
    assert.equal(world.flush(), 0, "nothing changed, so nothing rendered");
  });

  it("starts a component built later from the current value, and catches up one built before a change it missed", async () => {
    const { Hud } = await make<{ Hud: new () => Reader }>(HUD, "Hud.tsx");
    store.set("coins", 7);
    const early = new Hud();
    assert.equal(early.text, "Coins: 7", "built after the write: starts from it");
    store.set("coins", 9);
    const world = new World();
    world.mount(early);
    world.flush();
    assert.equal(early.text, "Coins: 9", "mounted after a write it missed: caught up on mounting");
  });

  it("does not render a write-only component for what it sets, and stops telling one that left the world", async () => {
    const { world, scorer, hud } = await game();
    scorer.setCoins(4);
    assert.equal(scorer.isDirty, false, "the scorer reads nothing, so there is nothing to render");
    world.flush();
    hud.parent!.removeChild(hud);
    world.flush();
    scorer.setCoins(5);
    assert.equal(hud.isDirty, false, "a detached component is not marked");
    resetGameState();
    assert.equal(store.get("coins"), 0);
  });
});
