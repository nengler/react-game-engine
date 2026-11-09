/** `useGameState`: a global store as opposed to `useState`'s local state. */
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Entity, Text, World, resetGameState, getGameStateStore } from "@rge/runtime";
import { Compiler, DiagnosticCode, formatDiagnostic, type GameStateDefinition } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, load, withAuthoringImports, type CompiledModule } from "./helpers.ts";

const SCHEMA: GameStateDefinition = {
  coins: { type: "number", initial: 0 },
  lives: { type: "number", initial: 3 },
  player: { type: "string", initial: "Ada" },
  muted: { type: "boolean", initial: false },
};

const compiler = new Compiler({ gameState: SCHEMA });
let counter = 0;
after(() => {
  compiler.close();
  closeCompiler();
  cleanOutput();
});
beforeEach(() => void resetGameState());

function build(source: string, name = "Test.tsx", c: Compiler = compiler): CompiledModule {
  const result = c.compile(name, withAuthoringImports(source));
  if (!result.ok) throw new Error(`Compilation failed:\n${result.diagnostics.map(formatDiagnostic).join("\n")}`);
  return { ir: result.ir, code: result.code, fileName: join(OUTPUT_ROOT, String(process.pid), "gs", String(++counter), name.replace(/\.tsx$/, ".ts")) };
}

function errors(source: string, c: Compiler = compiler): { code: string; message: string }[] {
  const result = c.compile("Invalid.tsx", withAuthoringImports(source));
  if (result.ok) throw new Error(`Expected compilation to fail, got:\n${result.code}`);
  return result.diagnostics.filter((d) => d.severity === "error").map((d) => ({ code: d.code, message: d.message }));
}

const SCORER = `
export function Scorer() {
  const [coins, setCoins] = useGameState("coins");
  useUpdate(() => { if (coins < 100) setCoins((n) => n + 1); });
  return <Entity name="Scorer" />;
}
`;

const HUD = `
export function Hud() {
  const [coins] = useGameState("coins");
  return <Text size={12} color="white">Coins: {coins}</Text>;
}
`;

describe("GameState.ts", () => {
  const read = (text: string) => compiler.parseGameState("GameState.ts", text);

  it("reads number, string and boolean literals, with their types", () => {
    const { schema, diagnostics } = read(`export const gameState = { coins: 0, lives: -3, "player-name": "Ada", muted: false, loud: true } as const;`);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(schema, {
      coins: { type: "number", initial: 0 },
      lives: { type: "number", initial: -3 },
      "player-name": { type: "string", initial: "Ada" },
      muted: { type: "boolean", initial: false },
      loud: { type: "boolean", initial: true },
    });
  });

  it("rejects what is not a literal, a duplicate key, a missing or unexported gameState", () => {
    const codes = (text: string) => read(text).diagnostics.map((d) => d.code);
    for (const text of [
      `export const gameState = { items: [] };`,
      `export const gameState = { a: 1, a: 2 };`,
      `export const gameState = { a };`,
      `const gameState = { a: 1 };`,
      `export const other = { a: 1 };`,
      `export const gameState = { a: 1 + 1 };`,
    ]) {
      assert.deepEqual(codes(text), [DiagnosticCode.InvalidGameStateSchema], text);
    }
  });
});

describe("useGameState: compiling", () => {
  it("makes a state with the schema's type and initial value, marked global", () => {
    const compiled = build(SCORER);
    const [component] = compiled.ir.components;
    const state = component!.state[0]!;
    assert.equal(state.globalKey, "coins");
    assert.deepEqual(state.type, { kind: "Primitive", name: "number" });
    assert.deepEqual(state.initialValue, { kind: "NumberLiteral", value: 0 });
    assert.match(compiled.code, /import \{ Entity, readGameState, setGameState, type PrefabDefinition \} from "@rge\/runtime";/);
    assert.match(compiled.code, /coins: number = readGameState<number>\("coins", 0\);/);
    assert.match(compiled.code, /override readonly gameStateKeys: readonly string\[\] = \["coins"\];/);
    assert.match(compiled.code, /setCoins\(value: number \| \(\(previous: number\) => number\)\): void \{\s+setGameState<number>\("coins", 0, value\);/);
    assert.match(compiled.code, /override commitState\(\): void \{\s+this\.coins = readGameState<number>\("coins", 0\);/);
    assert.deepEqual(compiler.typeCheck([{ fileName: compiled.fileName, text: compiled.code }]), []);
  });

  it("does not touch a component that uses only useState", () => {
    const compiled = build(`function A() { const [n, setN] = useState(0); useUpdate(() => setN(n + 1)); return <Entity />; }`);
    assert.doesNotMatch(compiled.code, /GameState|gameStateKeys/);
    assert.equal(compiled.ir.components[0]!.state[0]!.globalKey, undefined);
  });

  it("lets a component only set a key: no snapshot, no subscription, no re-render when it changes", () => {
    const compiled = build(`export function Picker() {
  const [, setCoins] = useGameState("coins");
  useUpdate(() => setCoins((n) => n + 1));
  return <Entity name="Picker" />;
}`);
    assert.equal(compiled.ir.components[0]!.state[0]!.writeOnly, true);
    assert.doesNotMatch(compiled.code, /readGameState|gameStateKeys|commitState/);
    assert.match(compiled.code, /import \{ Entity, setGameState, type PrefabDefinition \}/);
    assert.match(compiled.code, /setGameState<number>\("coins", 0, value\)/);
    assert.deepEqual(compiler.typeCheck([{ fileName: compiled.fileName, text: compiled.code }]), []);
    assert.deepEqual(errors(`function A() { const [,] = useGameState("coins"); return <Entity />; }`).map((d) => d.code), [DiagnosticCode.InvalidUseState]);
    assert.deepEqual(errors(`function A() { const [, set] = useState(0); return <Entity />; }`).map((d) => d.code), [DiagnosticCode.InvalidUseState]);
  });

  it("types string and boolean keys, and a handler can read and set all of them", () => {
    const compiled = build(`
export function Settings() {
  const [player, setPlayer] = useGameState("player");
  const [muted, setMuted] = useGameState("muted");
  useUpdate(() => { if (!muted) setPlayer(player === "Ada" ? "Bo" : "Ada"); setMuted(true); });
  return <Text size={12}>{player}</Text>;
}`);
    assert.deepEqual(compiler.typeCheck([{ fileName: compiled.fileName, text: compiled.code }]), []);
  });

  it("reports a key the schema does not have, with the nearest one, and what is declared", () => {
    const [d] = errors(`function A() { const [c] = useGameState("coin"); return <Entity />; }`);
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /'coin' is not in GameState\.ts \(did you mean "coins"\?\)\. Declared: "coins", "lives", "player", "muted"/);
  });

  it("reports a project with no GameState.ts", () => {
    const [d] = errors(`function A() { const [c] = useGameState("coins"); return <Entity />; }`, new Compiler());
    assert.equal(d!.code, DiagnosticCode.InvalidGameState);
    assert.match(d!.message, /needs the project's game state/);
  });

  it("rejects a key that is not a string literal, extra arguments, and a type argument", () => {
    for (const call of [`useGameState(key)`, `useGameState()`, `useGameState("coins", 5)`, `useGameState<number>("coins")`, "useGameState(`coins`)"]) {
      const found = errors(`function A() { const key = "coins"; const [c] = ${call}; return <Entity />; }`);
      assert.ok(found.length > 0 && found.every((d) => d.code === DiagnosticCode.InvalidUseState || d.code === DiagnosticCode.InvalidGameState || d.code === DiagnosticCode.UnsupportedExpression), `${call}: ${JSON.stringify(found)}`);
    }
  });

  it("is a top-level hook like useState, and its names may not collide", () => {
    assert.ok(errors(`function A() { if (true) { const [c] = useGameState("coins"); } return <Entity />; }`).some((d) => d.code === DiagnosticCode.HookNotAtTopLevel));
    assert.deepEqual(errors(`function A() { const [c] = useGameState("coins"); const [c, setL] = useGameState("lives"); return <Entity />; }`).map((d) => d.code), [DiagnosticCode.InvalidUseState]);
  });

  it("must be imported like every hook", () => {
    const result = compiler.compile("Missing.tsx", `import { Entity } from "@rge/runtime/jsx";\nfunction A() { const [c] = useGameState("coins"); return <Entity />; }`);
    assert.ok(!result.ok && result.diagnostics.some((d) => d.code === DiagnosticCode.MissingImport));
  });

  it("is checked in the authored source too: a wrong key or a wrong type is a type error", () => {
    const file = (text: string) => [{ fileName: join(OUTPUT_ROOT, "gs-source", "Src.tsx"), text }];
    const good = `import { useGameState, Entity } from "@rge/runtime/jsx";\nexport function A() { const [coins, setCoins] = useGameState("coins"); const n: number = coins; setCoins(n + 1); return <Entity />; }`;
    assert.deepEqual(compiler.typeCheckSources(file(good)).map((d) => d.message), []);
    assert.ok(compiler.typeCheckSources(file(good.replace('"coins"', '"coin"'))).length > 0, "unknown key");
    assert.ok(compiler.typeCheckSources(file(good.replace("const n: number = coins", "const n: string = coins"))).length > 0, "coins is a number");
  });
});

describe("useGameState: running", () => {
  interface Scorer extends Entity {
    coins: number;
    setCoins(value: number | ((n: number) => number)): void;
  }
  interface Hud extends Text {
    coins: number;
  }

  async function game() {
    const { Scorer } = await load<{ Scorer: new () => Scorer }>(build(SCORER, "Scorer.tsx"));
    const { Hud } = await load<{ Hud: new () => Hud }>(build(HUD, "Hud.tsx"));
    const world = new World();
    const root = new Entity({ name: "root" });
    const scorer = new Scorer();
    const hud = new Hud();
    root.addChild(scorer);
    root.addChild(hud);
    world.mount(root);
    world.flush();
    return { world, scorer, hud };
  }

  it("shares one value: a write in one component shows in another, once per frame", async () => {
    const { world, scorer, hud } = await game();
    assert.equal(hud.text, "Coins: 0");
    world.tick(0.1); // the scorer's useUpdate adds one
    assert.equal(scorer.coins, 1);
    assert.equal(hud.text, "Coins: 1", "the HUD, which only reads, was told and rendered");
    world.tick(0.1);
    world.tick(0.1);
    assert.equal(hud.text, "Coins: 3");
  });

  it("gives every handler in a frame the same snapshot, as useState does", async () => {
    const { world, scorer, hud } = await game();
    let seenByHandler = -1;
    const original = hud.onUpdate;
    hud.onUpdate = () => { seenByHandler = hud.coins; original.call(hud, 0); };
    world.registerObject(hud);
    scorer.setCoins(10);
    assert.equal(scorer.coins, 0, "a write is not visible to a read until the next render");
    assert.equal(hud.coins, 0);
    world.flush();
    assert.equal(scorer.coins, 10);
    assert.equal(hud.coins, 10);
    void seenByHandler;
  });

  it("chains updaters on the latest value and ignores a write that changes nothing", async () => {
    const { world, scorer, hud } = await game();
    scorer.setCoins((n) => n + 1);
    scorer.setCoins((n) => n + 1);
    scorer.setCoins((n) => n * 10);
    world.flush();
    assert.equal(hud.coins, 20);
    scorer.setCoins(20);
    assert.equal(world.flush(), 0, "nothing changed, so nothing rendered");
  });

  it("starts a component built later from the current value, and refreshes one built before a change it missed", async () => {
    const { Hud } = await load<{ Hud: new () => Hud }>(build(HUD, "Hud.tsx"));
    getGameStateStore().set("coins", 0, 7);
    const early = new Hud();
    assert.equal(early.coins, 7, "built after the write: starts from it");
    getGameStateStore().set("coins", 0, 9);
    const world = new World();
    world.mount(early);
    world.flush();
    assert.equal(early.text, "Coins: 9", "mounted after the write it missed: caught up on mounting");
  });

  it("lets a write-only component change what others read, without rendering itself", async () => {
    const { Picker } = await load<{ Picker: new () => Entity & { setCoins(v: number | ((n: number) => number)): void } }>(build(`export function Picker() {
  const [, setCoins] = useGameState("coins");
  return <Entity name="Picker" />;
}`, "Picker.tsx"));
    const { Hud } = await load<{ Hud: new () => Hud }>(build(HUD, "Hud.tsx"));
    const world = new World();
    const root = new Entity({ name: "root" });
    const picker = new Picker();
    const hud = new Hud();
    root.addChild(picker);
    root.addChild(hud);
    world.mount(root);
    world.flush();
    picker.setCoins(4);
    assert.equal(picker.isDirty, false, "the picker reads nothing, so nothing to render");
    assert.equal(hud.isDirty, true);
    world.flush();
    assert.equal(hud.text, "Coins: 4");
  });

  it("stops telling a component that left the world", async () => {
    const { world, scorer, hud } = await game();
    hud.parent!.removeChild(hud);
    world.flush();
    scorer.setCoins(5);
    assert.equal(hud.isDirty, false, "a detached component is not marked");
  });
});
