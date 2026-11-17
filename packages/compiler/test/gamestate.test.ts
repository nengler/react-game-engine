import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** The game state: `createGameState(data, actions)` in GameState.ts, read with selectors, changed by actions. */
import { after, before, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { Entity, Flex, Text, World, resetGameState, type GameState, type GameStore } from "@tsengine/runtime";

import { Compiler, DiagnosticCode, formatDiagnostic } from "../src/index.ts";
import { OUTPUT_ROOT, cleanOutput, closeCompiler, load, withAuthoringImports, type CompiledModule } from "./helpers.ts";

const ROOT = join(OUTPUT_ROOT, String(process.pid), "gs");
const STATE_FILE = join(ROOT, "GameState.ts");
const STATE = `import { createGameState } from "@tsengine/runtime";

type MapId = "meadow" | "glowmire";
type Level = 1 | 2 | 3;

export const useGame = createGameState(
  {
    coins: 0,
    player: { hp: 10, name: "Ada" },
    muted: false,
    enemies: [] as { id: number; hp: number }[],
    map: "meadow" as MapId,
    level: 1 as Level,
  },
  {
    collect(s, n: number) { s.coins += n; },
    spawn(s, id: number) { s.enemies.push({ id, hp: 3 }); },
    hurt(s) { s.player.hp -= 1; },
    rename(s, name: string) { s.player.name = name; },
    noop() {},
  },
);
`;

let compiler: Compiler;
let store: GameStore;
let useGame: GameState<{ coins: number; player: { hp: number; name: string } }>;
/** Call an action of the game state, as a handler would. */
const act = (name: string, ...args: unknown[]): void =>
  (useGame.getState() as unknown as Record<string, (...a: unknown[]) => void>)[name]!(...args);
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

function errors(
  source: string,
  c: Compiler = compiler,
  header = `import { useGame } from "./GameState.ts";\n`
): { code: string; message: string }[] {
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
  const read = (text: string) => compiler.parseGameState("GameState.ts", `import { createGameState } from "@tsengine/runtime";\n${text}`);
  const wrap = (body: string) => `export const useGame = createGameState(${body}, {});`;

  it("reads a nested state tree with typed leaves", () => {
    const { schema, diagnostics } = read(wrap(`{ coins: 0, player: { hp: -3, "name": "Ada", flags: { muted: false } } }`));
    assert.deepEqual(diagnostics, []);
    assert.equal(schema!.name, "useGame");
    assert.deepEqual(schema!.actions, []);
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

  it("refuses the removed `(set) => ({ … })` form, and data with no actions, saying what to write", () => {
    const messages = (text: string) => read(text).diagnostics.map((d) => `${d.code} ${d.message}`);
    for (const text of [
      `export const useGame = createGameState((set) => ({ coins: 0 }));`,
      `export const useGame = createGameState<State>()((set, get) => ({ coins: 0 }));`,
    ]) {
      const found = messages(text);
      assert.equal(found.length, 1, text);
      assert.match(found[0]!, /form of createGameState was removed: pass the data and the actions/, text);
    }
    assert.match(messages(`export const useGame = createGameState({ coins: 0 });`)[0]!, /actions as its second argument/);
  });

  it("reads `createGameState(data, actions)`: the data's tree, and each action by name", () => {
    const { schema, diagnostics } = read(`export const useGame = createGameState(
  { coins: 0, player: { hp: -3, name: "Ada" }, run: newRun(), items: [] as number[] },
  { collect(s, n: number) { s.coins += n; }, hurt: (s) => { s.player.hp -= 1; }, heal: function (s) { s.player.hp = 10; } },
);`);
    assert.deepEqual(diagnostics, []);
    assert.equal(schema!.name, "useGame");
    assert.deepEqual(schema!.actions, ["collect", "hurt", "heal"]);
    assert.deepEqual(schema!.tree, {
      kind: "node",
      children: {
        coins: { kind: "leaf", type: "number", initial: 0 },
        player: {
          kind: "node",
          children: { hp: { kind: "leaf", type: "number", initial: -3 }, name: { kind: "leaf", type: "string", initial: "Ada" } },
        },
        run: { kind: "value" },
        items: { kind: "value" },
      },
    });
  });

  it("rejects a `createGameState(data, actions)` it cannot read, saying why", () => {
    const messages = (text: string) => read(text).diagnostics.map((d) => `${d.code} ${d.message}`);
    const cases: [string, RegExp][] = [
      [`export const useGame = createGameState(makeData(), { a(s) {} });`, /data is an object literal/],
      [`export const useGame = createGameState({ a: 1 }, actions);`, /actions are an object literal/],
      [
        `export const useGame = createGameState({ a: 1, act: () => 1 }, {});`,
        /function in the game state's data: actions go in the second argument/,
      ],
      [`export const useGame = createGameState({ a: 1 }, { a(s) {} });`, /'a' is declared twice/],
      [`export const useGame = createGameState({ a: 1 }, { b: 5 });`, /Each action is/],
      [`export const useGame = createGameState({ a: 1 }, { ...more });`, /Each action is/],
    ];
    for (const [text, pattern] of cases) {
      const found = messages(text);
      assert.equal(found.length, 1, `${text}\n${found.join("\n")}`);
      assert.match(found[0]!, new RegExp(`^${DiagnosticCode.InvalidGameStateSchema} `), text);
      assert.match(found[0]!, pattern, text);
    }
  });

  it("keeps an array or a value made by code as a value whose type TypeScript knows", () => {
    const { schema, diagnostics } = read(wrap(`{ items: [], run: newRun(), total: 1 + 1, base, nested: { list: [1, 2] } }`));
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(schema!.tree, {
      kind: "node",
      children: {
        items: { kind: "value" },
        run: { kind: "value" },
        total: { kind: "value" },
        base: { kind: "value" },
        nested: { kind: "node", children: { list: { kind: "value" } } },
      },
    });
  });

  it("rejects what it cannot understand, saying why", () => {
    const codes = (text: string) => read(text).diagnostics.map((d) => d.code);
    for (const text of [
      wrap(`{ a: 1, a: 2 }`),
      wrap(`{ a: 1, a() {} }`),
      `export const useGame = createGameState({ a: 1 }, { a(s) {} });`,
      wrap(`{ "a.b": 1 }`),
      wrap(`{ ...base }`),
      wrap(`{ [key]: 1 }`),
      wrap(`{ nested: { act: () => 1 } }`),
      wrap(`makeState()`),
      `export const useGame = createGameState(makeCreator);`,
      `export const useGame = createGameState((set) => { const x = 1; return { x }; });`,
      `const useGame = createGameState({ a: 1 }, {});`,
      `export const other = 5;`,
      `${wrap(`{}`)}\nexport const useOther = createGameState({}, {});`,
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

  it('keeps the type a leaf is written with (`"meadow" as MapId`): a literal union is not widened to string', () => {
    const compiled = build(`
const MAPS = { meadow: "Meadow", glowmire: "Glowmire" };
export function MapName() {
  const map = useGame((s) => s.map);
  const level = useGame((s) => s.level);
  const next: 1 | 2 | 3 = level;
  return <Text size={12}>{MAPS[map]} {next}</Text>;
}`);
    const [map, level] = compiled.ir.components[0]!.state;
    assert.deepEqual(map!.type, { kind: "SourceType", text: 'ReturnType<typeof useGame.getState>["map"]' });
    assert.deepEqual(map!.initialValue, { kind: "StringLiteral", value: "meadow" });
    assert.deepEqual(level!.type, { kind: "SourceType", text: 'ReturnType<typeof useGame.getState>["level"]' });
    assert.deepEqual(typeErrors(compiled), []);
    const { schema } = compiler.parseGameState(STATE_FILE, STATE);
    assert.deepEqual(schema!.tree.children["map"], { kind: "leaf", type: "string", initial: "meadow", typed: true });
    const plain = compiler.parseGameState("GameState.ts", `export const useGame = createGameState({ a: 0 as number, b: "x" }, {});`);
    assert.deepEqual(plain.schema!.tree.children, {
      a: { kind: "leaf", type: "number", initial: 0 },
      b: { kind: "leaf", type: "string", initial: "x" },
    });
  });

  it("reads a value named like a member of the root (`name` in an <Entity>) into a field of its own", async () => {
    const compiled = build(`
export function Badge() {
  const name = useGame((s) => s.player.name);
  const rename = useGame((s) => s.rename);
  useUpdate(() => { if (name === "Ada") rename("Bo"); });
  return <Entity name="Badge"><Text>{name}</Text></Entity>;
}`);
    assert.match(compiled.code, /\$name: string = useGame\.store\.get<string>\("player\.name"\);/);
    assert.deepEqual(typeErrors(compiled), []);
    const g = generated(compiled);
    const { Badge } = await load<{ Badge: new () => Entity }>(g);
    const world = new World();
    const badge = new Badge();
    world.mount(badge);
    world.flush();
    assert.equal(badge.name, "Badge", "the entity keeps its own name");
    assert.equal((badge.children[0] as Text).text, "Ada");
    world.tick(1 / 60);
    world.flush();
    assert.equal((badge.children[0] as Text).text, "Bo");
  });

  it("starts a useMutable field from the game state as it is when the component is made", async () => {
    const compiled = build(`
export function Counter() {
  const coins = useGame((s) => s.coins);
  const st = useMutable({ start: coins * 10 });
  return <Text size={12}>{\`\${st.start}\`}</Text>;
}`);
    assert.deepEqual(typeErrors(compiled), []);
    const { Counter } = await load<{ Counter: new () => Text }>(generated(compiled));
    act("collect", 3);
    const world = new World();
    const counter = new Counter();
    world.mount(counter);
    world.flush();
    assert.equal(counter.text, "30");
    act("collect", 1);
    world.flush();
    assert.equal(counter.text, "30", "only the first value: it is the component's own state from then on");
    // The component's own state declared above may give the first value too (its value when the component is made).
    const own = build(
      `export function A() { const s = useMutable({ a: 7 }); const t = useMutable({ b: s.a * 2 }); return <Text>{t.b}</Text>; }`
    );
    const { A } = await load<{ A: new () => Text }>(generated(own));
    assert.equal(new A().text, "14");
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
    const compiled = build(`function A() { const s = useMutable({ n: 0 }); useUpdate(() => { s.n += 1; }); return <Entity />; }`);
    assert.doesNotMatch(compiled.code, /GameState|useGame/);
  });

  it("reports a wrong path with the nearest key at the level it went wrong", () => {
    const [top] = errors(`function A() { const c = useGame((s) => s.coin); return <Entity />; }`);
    assert.equal(top!.code, DiagnosticCode.InvalidGameState);
    assert.match(
      top!.message,
      /'coin' is not in the game state \(did you mean "coins"\?\)\. State: coins, player, muted, enemies, map, level, collect, spawn, hurt, rename, noop\./
    );
    const [nested] = errors(`function A() { const c = useGame((s) => s.player.hpp); return <Entity />; }`);
    assert.match(nested!.message, /'player\.hpp' is not in the game state \(did you mean "player\.hp"\?\)\. 'player' has: hp, name\./);
    const [through] = errors(`function A() { const c = useGame((s) => s.coins.total); return <Entity />; }`);
    assert.match(through!.message, /'coins' is a number, so it has no 'total'/);
  });

  it("selects an object, typed by TypeScript from the store, and reads its members", () => {
    const compiled = build(`
export function Badge() {
  const player = useGame((s) => s.player);
  return <Text size={12}>{player.name} {player.hp}</Text>;
}`);
    const state = compiled.ir.components[0]!.state[0]!;
    assert.equal(state.globalKey, "player");
    assert.deepEqual(state.type, { kind: "SourceType", text: 'ReturnType<typeof useGame.getState>["player"]' });
    assert.match(
      compiled.code,
      /player: ReturnType<typeof useGame\.getState>\["player"\] = useGame\.store\.get<ReturnType<typeof useGame\.getState>\["player"\]>\("player"\);/
    );
    assert.deepEqual(typeErrors(compiled), []);
    const typo = build(`function A() { const p = useGame((s) => s.player); return <Text size={12}>{p.hpp}</Text>; }`);
    assert.match(
      typeErrors(typo)
        .map((d) => d.message)
        .join("\n"),
      /hpp/,
      "a member the object does not have is a type error"
    );
  });

  it("picks several values at once, each its own selector: from a path, an object literal or an array literal", async () => {
    const compiled = build(`
export function Card() {
  const { hp, name: who } = useGame((s) => s.player);
  const { c, quiet: m } = useGame((s) => ({ c: s.coins, quiet: s.muted }));
  const [total, health] = useGame((s) => [s.coins, s.player.hp]);
  return <Text size={12}>{who} {hp} {c} {m ? "m" : "-"} {total} {health}</Text>;
}`);
    const keys = compiled.ir.components[0]!.state.map((st) => st.globalKey);
    assert.deepEqual(keys, ["player.hp", "player.name", "coins", "muted", "coins", "player.hp"], "one leaf subscription each");
    assert.deepEqual(typeErrors(compiled), []);
    const { Card } = await load<{ Card: new () => Text }>(generated(compiled));
    const world = new World();
    const card = new Card();
    world.mount(card);
    world.flush();
    assert.equal(card.text, "Ada 10 0 - 0 10");
    act("collect", 3);
    act("hurt");
    world.flush();
    assert.equal(card.text, "Ada 9 3 - 3 9");
  });

  it("selects an array and renders it as a keyed list", () => {
    const compiled = build(`
export function Swarm() {
  const enemies = useGame((s) => s.enemies);
  return <Entity name="Swarm">{enemies.map((e) => <Text key={e.id} size={8}>{e.hp}</Text>)}</Entity>;
}`);
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("accepts one expression-bodied selector, bound with const, at the top level", () => {
    assert.ok(
      errors(`function A() { const c = useGame((s) => other.coins); return <Entity />; }`).some(
        (d) => d.code === DiagnosticCode.UnknownIdentifier
      )
    );
    for (const call of [
      `useGame((s) => { return s.coins; })`,
      `useGame((s, t) => s.coins)`,
      `useGame(select)`,
      `useGame()`,
      `useGame((s) => s)`,
      `useGame<number>((s) => s.coins)`,
    ]) {
      const found = errors(`function A() { const select = null; const c = ${call}; return <Entity />; }`);
      assert.ok(
        found.some((d) => d.code === DiagnosticCode.InvalidUseMutable),
        `${call}: ${JSON.stringify(found)}`
      );
    }
    assert.ok(
      errors(`function A() { let c = useGame((s) => s.coins); return <Entity />; }`).some(
        (d) => d.code === DiagnosticCode.InvalidUseMutable
      )
    );
    assert.ok(
      errors(`function A() { if (true) { const c = useGame((s) => s.coins); } return <Entity />; }`).some(
        (d) => d.code === DiagnosticCode.HookNotAtTopLevel
      )
    );
  });

  it("keeps an action out of values: it is only called, as a statement", () => {
    const run = (body: string) =>
      errors(
        `function A() { const st = useMutable({ n: 0 }); const hurt = useGame((s) => s.hurt); ${body} return <Entity name="A" />; }`
      ).map((d) => d.code);
    assert.deepEqual(run(`useUpdate(() => { const x = hurt; });`), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(run(`useUpdate(() => { st.n = hurt(); });`), [DiagnosticCode.UnsupportedExpression]);
    assert.ok(errors(`function A() { const hurt = useGame((s) => s.hurt); return <Text size={hurt}>x</Text>; }`).length > 0);
  });

  it("refuses a write to a selected value, naming the action to add", () => {
    const write = (body: string) =>
      errors(
        `function A() { const player = useGame((s) => s.player); const { hp } = useGame((s) => s.player); const list = useGame((s) => s.enemies); ${body} return <Entity name="A" />; }`
      );
    const field = write(`useInput(() => { player.hp = 0; });`);
    assert.deepEqual(
      field.map((d) => d.code),
      [DiagnosticCode.UnsupportedStatement]
    );
    assert.match(
      field[0]!.message,
      /'player' is read from the game state, which only its actions change.*`name\(s\) \{ s\.player\.hp = …; \}`/
    );
    assert.match(write(`useInput(() => { hp += 1; });`)[0]!.message, /`name\(s\) \{ s\.player\.hp = …; \}`/);
    const push = write(`useInput(() => { list.push({ id: 1, hp: 3 }); });`);
    assert.match(push[0]!.message, /'list' is read from the game state.*`name\(s\) \{ s\.enemies\.push\(…\); \}`/);
  });

  it("types what a selector returns as read-only, so a helper cannot change it in place", () => {
    const file = (text: string) => [{ fileName: join(ROOT, "Ro.tsx"), text }];
    const source = (body: string) =>
      `import { Entity, useInput } from "@tsengine/runtime/jsx";\nimport { useGame } from "./GameState.ts";\nfunction grow(list: { id: number; hp: number }[]): void { list.push({ id: 0, hp: 1 }); }\nexport function A() {\n  const list = useGame((s) => s.enemies);\n  const player = useGame((s) => s.player);\n  useInput(() => { ${body} });\n  return <Entity />;\n}`;
    assert.deepEqual(compiler.typeCheckSources(file(source(`const n: number = list.length + player.hp;`))), []);
    assert.ok(compiler.typeCheckSources(file(source(`grow(list);`))).length > 0, "a readonly list is not a mutable one");
  });

  it("imports only the game state from a .ts module, and needs one to exist", () => {
    assert.deepEqual(
      errors(`function A() { return <Entity />; }`, compiler, `import { useOther } from "./GameState.ts";\n`).map((d) => d.code),
      [DiagnosticCode.InvalidGameState]
    );
    const none = errors(`function A() { const c = useGame((s) => s.coins); return <Entity />; }`, new Compiler());
    assert.deepEqual(
      none.map((d) => d.code),
      [DiagnosticCode.InvalidGameState]
    );
    assert.match(none[0]!.message, /no game state to import/);
  });

  it("is checked in the authored source too: a wrong path, a wrong type, a wrong argument is a type error", () => {
    const file = (text: string) => [{ fileName: join(ROOT, "Src.tsx"), text }];
    const good = `import { Entity, useUpdate } from "@tsengine/runtime/jsx";\nimport { useGame } from "./GameState.ts";\nexport function A() {\n  const coins = useGame((s) => s.coins);\n  const collect = useGame((s) => s.collect);\n  const n: number = coins;\n  useUpdate(() => collect(n));\n  return <Entity />;\n}`;
    assert.deepEqual(
      compiler.typeCheckSources(file(good)).map((d) => d.message),
      []
    );
    assert.ok(compiler.typeCheckSources(file(good.replace("s.coins", "s.coin"))).length > 0, "unknown path");
    assert.ok(
      compiler.typeCheckSources(file(good.replace("const n: number = coins", "const n: string = coins"))).length > 0,
      "coins is a number"
    );
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

  it("changes only what an action wrote, and setState still merges shallowly, as Zustand does", async () => {
    const { world, hpBar } = await game();
    act("rename", "Bo");
    assert.equal(store.get("player.name"), "Bo");
    assert.equal(store.get("player.hp"), 10, "the action wrote the name only, so hp survived");
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

  it("re-renders a reader of an object or an array when a value under it changes, and only then", async () => {
    const { Badge } = await make<{ Badge: new () => Reader }>(
      `
export function Badge() {
  const player = useGame((s) => s.player);
  return <Text size={12}>{player.name} {player.hp}</Text>;
}`,
      "Badge.tsx"
    );
    const { Count } = await make<{ Count: new () => Reader }>(
      `
export function Count() {
  const enemies = useGame((s) => s.enemies);
  return <Text size={12}>{enemies.length} {enemies.filter((e) => e.hp === 3).length}</Text>;
}`,
      "Count.tsx"
    );
    const world = new World();
    const root = new Entity({ name: "root" });
    const badge = new Badge();
    const count = new Count();
    root.addChild(badge);
    root.addChild(count);
    world.mount(root);
    world.flush();
    assert.equal(badge.text, "Ada 10");
    assert.equal(count.text, "0 0");
    act("collect", 1);
    assert.equal(badge.isDirty, false, "coins is not under player");
    act("hurt");
    assert.equal(badge.isDirty, true, "player.hp is");
    assert.equal(count.isDirty, false);
    act("spawn", 1);
    act("spawn", 2);
    assert.equal(count.isDirty, true);
    world.flush();
    assert.equal(badge.text, "Ada 9");
    assert.equal(count.text, "2 2");
    useGame.setState((s) => ({ player: { ...s.player } }));
    assert.equal(badge.isDirty, false, "an equal copy changes no value");
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

describe("a computed selector", () => {
  it("subscribes to each path it reads and works the value out again when one changes", async () => {
    const compiled = build(`
interface RowProps { id: number; }
export function Row({ id }: RowProps) {
  const rich = useGame((s) => s.coins >= id * 2);
  const label = useGame((s) => \`\${s.player.name}:\${s.coins + s.player.hp}\`);
  const count = useGame((s) => s.enemies.length);
  return <Text size={12}>{rich ? "rich" : "poor"} {label} {count}</Text>;
}`);
    const component = compiled.ir.components[0]!;
    assert.deepEqual(
      component.state.map((st) => [st.name, st.globalKey]),
      [
        ["$coins", "coins"],
        ["$playerName", "player.name"],
        ["$playerHp", "player.hp"],
        ["$enemies", "enemies"],
      ],
      "one snapshot per path, shared"
    );
    assert.deepEqual(typeErrors(compiled), []);
    const { Row } = await load<{ Row: new (props: { id: number }) => Text }>(generated(compiled));
    const world = new World();
    const row = new Row({ id: 2 });
    world.mount(row);
    world.flush();
    assert.equal(row.text, "poor Ada:10 0");
    act("collect", 4);
    act("spawn", 1);
    world.flush();
    assert.equal(row.text, "rich Ada:14 1");
  });

  it("reuses a path the component already selected by name", () => {
    const compiled = build(`
export function A() {
  const coins = useGame((s) => s.coins);
  const doubled = useGame((s) => s.coins * 2);
  return <Text size={12}>{coins} {doubled}</Text>;
}`);
    assert.deepEqual(
      compiled.ir.components[0]!.state.map((st) => st.name),
      ["coins"]
    );
    assert.deepEqual(typeErrors(compiled), []);
  });

  it("may call a function from a .ts file and read props, and its names are checked against the schema", () => {
    const found = errors(`function A() { const c = useGame((s) => s.coinz > 1); return <Entity />; }`);
    assert.deepEqual(
      found.map((d) => d.code),
      [DiagnosticCode.InvalidGameState]
    );
    assert.match(found[0]!.message, /did you mean "coins"/);
    const action = errors(`function A() { const c = useGame((s) => s.hurt === null); return <Entity />; }`);
    assert.deepEqual(
      action.map((d) => d.code),
      [DiagnosticCode.UnsupportedExpression]
    );
    assert.match(action[0]!.message, /select it by itself/);
  });
});

describe("an action passed as a value", () => {
  it("is a press handler on a built-in and a callback prop of a component, as `onPress={() => collect(1)}` would be", async () => {
    const compiled = build(`
interface ButtonProps { onPress: () => void; }
export function Button({ onPress }: ButtonProps) {
  return <Flex onPress={onPress} />;
}
export function Bar() {
  const hurt = useGame((s) => s.hurt);
  const noop = useGame((s) => s.noop);
  return (
    <Flex onPress={hurt}>
      <Button onPress={hurt} />
      <Pointer width={4} height={4} onPress={noop} />
    </Flex>
  );
}`);
    assert.deepEqual(typeErrors(compiled), []);
    assert.match(compiled.code, /onPress: useGame\.getState\(\)\.hurt/);
    const { Bar } = await load<{ Bar: new () => Flex & { children: (Flex & { children: Flex[] })[] } }>(generated(compiled));
    const world = new World();
    const bar = new Bar();
    world.mount(bar);
    world.flush();
    bar.onPress!();
    const button = bar.children[0]!;
    button.onPress!();
    assert.equal(useGame.getState().player.hp, 8);
  });
});

describe("useGame.actions()", () => {
  it("takes the actions a component calls, and subscribes to nothing", async () => {
    const compiled = build(`
export function Shop() {
  const { collect, hurt: ouch } = useGame.actions();
  useUpdate(() => { collect(2); ouch(); });
  return <Entity />;
}`);
    assert.doesNotMatch(compiled.code, /gameStateKeys/, "actions never change, so nothing is subscribed to");
    assert.deepEqual(typeErrors(compiled), []);
    const { Shop } = await load<{ Shop: new () => Entity }>(generated(compiled));
    const world = new World();
    world.mount(new Shop());
    world.flush();
    world.tick(1 / 60);
    world.flush();
    const state = useGame.getState();
    assert.equal(state.coins, 2);
    assert.equal(state.player.hp, 9);
  });

  it("says when a name is a value or is not in the state, and that it must be destructured", () => {
    const value = errors(`function A() { const { coins } = useGame.actions(); return <Entity />; }`);
    assert.deepEqual(
      value.map((d) => d.code),
      [DiagnosticCode.InvalidGameState]
    );
    assert.match(
      value[0]!.message,
      /'coins' is a value of the game state, not an action: read it with `const coins = useGame\(\(s\) => s\.coins\)`/
    );
    const typo = errors(`function A() { const { colect } = useGame.actions(); return <Entity />; }`);
    assert.match(typo[0]!.message, /'colect' is not an action of the game state \(did you mean "collect"\?\)/);
    const whole = errors(`function A() { const all = useGame.actions(); return <Entity />; }`);
    assert.match(whole[0]!.message, /Destructure the actions you call from useGame\.actions\(\)/);
  });

  it("warns when an action is taken from the whole state", () => {
    const result = compiler.compile(
      "Warn.tsx",
      withAuthoringImports(`import { useGame } from "./GameState.ts";
export function A() {
  const { coins, collect } = useGame((s) => s);
  useUpdate(() => collect(coins));
  return <Entity />;
}`)
    );
    assert.ok(result.ok);
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");
    assert.equal(warnings.length, 1, "only the action, not the value");
    assert.match(warnings[0]!.message, /Take actions with `const \{ collect \} = useGame\.actions\(\)`/);
  });
});
