/**
 * M5a: records and arrays in handler code. Array and object literals (with
 * spreads), member reads on values, the non-mutating array methods with inline
 * arrow callbacks, and array or record state (`useState<EnemyData[]>([])`).
 * Keyed lists in JSX (M5b) build on this.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, World, type InputState } from "@rge/runtime";
import { DiagnosticCode, type ComponentIR, type ExprIR, type StatementIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, stripSpans, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SWARM = `
interface EnemyData {
  id: string;
  hp: number;
}

interface TargetProps {
  id: string;
  onHit: (id: string) => void;
}

function Target({ id, onHit }: TargetProps) {
  useInput((input) => {
    if (input.pressed(id)) onHit(id);
  });
  return <Entity name={id} />;
}

function Swarm() {
  const [enemies, setEnemies] = useState<EnemyData[]>([]);
  const [spawned, setSpawned] = useState(0);
  const [weakest, setWeakest] = useState("");
  const full = enemies.length >= 3;

  useUpdate((dt) => {
    if (!full) {
      setEnemies((list) => [...list, { id: \`e\${spawned}\`, hp: 2 + spawned }]);
      setSpawned((n) => n + 1);
      return;
    }
    const next = enemies.map((e) => ({ ...e, hp: e.hp - dt })).filter((e) => e.hp > 0);
    if (next.some((e) => e.hp < 1)) setWeakest(next.find((e) => e.hp < 1)?.id ?? "");
    setEnemies(next);
  });

  return (
    <Entity name="Swarm">
      <Sprite image={full ? "full.png" : "spawning.png"} />
      <Target id="t" onHit={(id) => setEnemies(enemies.filter((e) => e.id !== id))} />
    </Entity>
  );
}
`;

interface EnemyData {
  id: string;
  hp: number;
}
interface SwarmInstance extends Entity {
  enemies: EnemyData[];
  spawned: number;
  weakest: string;
  setEnemies(value: EnemyData[] | ((previous: EnemyData[]) => EnemyData[])): void;
  readonly sprite: Sprite;
  readonly target: Entity & { onInput(input: InputState): void };
}

let Swarm: new () => SwarmInstance;

before(async () => {
  ({ Swarm } = await load<{ Swarm: typeof Swarm }>(compile(SWARM, "Swarm.tsx")));
});

function component(source: string, name: string): ComponentIR {
  const found = compile(source).ir.components.find((c) => c.name === name);
  assert.ok(found, name);
  return found;
}

/** A component with the given state lines and one `useUpdate` handler body. */
function withHandler(state: string, body: string, types = "interface Item { id: string; n: number }"): string {
  return `${types}
function C() {
  ${state}
  useUpdate((dt) => { ${body} });
  return <Entity name="C" />;
}`;
}

function codes(source: string): string[] {
  return compileErrors(source).map((d) => d.code);
}

const input = (pressed: string[]): InputState => ({ pressed: (a: string) => pressed.includes(a), down: () => false, released: () => false, pointerX: 0, pointerY: 0 }) as unknown as InputState;

describe("M5a: IR shape", () => {
  it("types array and record state from the type argument", () => {
    const c = component(
      `interface Item { id: string }
function C() {
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Item>({ id: "a" });
  const [grid, setGrid] = useState<number[][]>([]);
  const [mixed, setMixed] = useState<(Item | null)[]>([]);
  return <Entity name="C" />;
}`,
      "C",
    );
    assert.deepEqual(
      c.state.map((s) => s.type),
      [
        { kind: "Array", element: { kind: "SourceType", text: "Item" } },
        { kind: "SourceType", text: "Item" },
        { kind: "Array", element: { kind: "Array", element: { kind: "Primitive", name: "number" } } },
        { kind: "Array", element: { kind: "SourceType", text: "Item | null" } },
      ],
    );
    assert.deepEqual(c.state[0]!.initialValue, { kind: "ArrayLiteral", elements: [] });
    assert.deepEqual(c.state[1]!.initialValue, { kind: "ObjectLiteral", properties: [{ kind: "Property", name: "id", value: { kind: "StringLiteral", value: "a" } }] });
  });

  it("lowers literals with spreads, member reads and array methods with arrow callbacks", () => {
    const c = component(withHandler(`const [items, setItems] = useState<Item[]>([]);`, `setItems([...items.filter((e) => e.n > dt), { id: "x", n: items.length }]);`), "C");
    const handler = c.hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(handler?.kind === "OnUpdate");
    const set = handler.handler.body[0] as StatementIR & { kind: "SetState"; value: ExprIR };
    const items = { kind: "StateRead", state: "C.items" };
    const [arrow] = (stripSpans(set.value) as { elements: { value: { args: { params: { id: string }[] }[] } }[] }).elements[0]!.value.args;
    const e = { kind: "ParamRead", param: arrow!.params[0]!.id, name: "e" };
    assert.deepEqual(stripSpans(set.value), {
      kind: "ArrayLiteral",
      elements: [
        {
          spread: true,
          value: {
            kind: "Call",
            callee: { kind: "ArrayMethod", receiver: items, name: "filter" },
            args: [
              {
                kind: "Arrow",
                params: [{ id: arrow!.params[0]!.id, name: "e", type: { kind: "Contextual" } }],
                body: {
                  kind: "Binary",
                  operator: ">",
                  left: { kind: "MemberRead", object: e, name: "n", optional: false },
                  right: { kind: "ParamRead", param: handler.handler.params[0]!.id, name: "dt" },
                },
              },
            ],
          },
        },
        {
          spread: false,
          value: {
            kind: "ObjectLiteral",
            properties: [
              { kind: "Property", name: "id", value: { kind: "StringLiteral", value: "x" } },
              { kind: "Property", name: "n", value: { kind: "MemberRead", object: items, name: "length", optional: false } },
            ],
          },
        },
      ],
    });
  });

  it("makes a JSX value that reads an array through a callback depend on that state", () => {
    const c = component(
      `interface Item { n: number }
function C() {
  const [items, setItems] = useState<Item[]>([]);
  return <Entity name="C"><Sprite image={items.some((e) => e.n > 3) ? "a.png" : "b.png"} /></Entity>;
}`,
      "C",
    );
    const sprite = c.root.children[0]!.element;
    const image = sprite.props[0]!;
    assert.equal(image.kind, "DynamicProp");
    assert.deepEqual(image.kind === "DynamicProp" && image.dependencies, [{ kind: "State", state: "C.items" }]);
  });

  it("takes an array prop's type for state initialised from it", () => {
    const c = component(
      `interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  const [list, setList] = useState(items);
  return <Entity name="C" />;
}`,
      "C",
    );
    // The props type keeps an array of a source type as text, which generates the same code.
    assert.deepEqual(c.state[0]!.type, { kind: "SourceType", text: "Item[]" });
  });
});

describe("M5a: generated code", () => {
  it("types the state field, its pending value and its setter", () => {
    const { code } = compile(SWARM, "Swarm.tsx");
    assert.match(code, /^ {2}enemies: EnemyData\[\] = \[\];$/m);
    assert.match(code, /^ {2}#enemiesNext: EnemyData\[\] = this\.enemies;$/m);
    assert.match(code, /setEnemies\(value: EnemyData\[\] \| \(\(previous: EnemyData\[\]\) => EnemyData\[\]\)\): void/);
    assert.match(code, /^export interface EnemyData \{/m, "the record type is copied into the module");
  });

  it("emits literals, spreads, member reads and arrow callbacks; an object body is parenthesised", () => {
    const { code } = compile(SWARM, "Swarm.tsx");
    assert.match(code, /this\.setEnemies\(\(list: EnemyData\[\]\) => \[\.\.\.list, \{ id: `e\$\{this\.spawned\}`, hp: 2 \+ this\.spawned \}\]\);/);
    assert.match(code, /const next = this\.enemies\.map\(\(e\) => \(\{ \.\.\.e, hp: e\.hp - dt \}\)\)\.filter\(\(e\) => e\.hp > 0\);/);
    assert.match(code, /this\.setWeakest\(next\.find\(\(e\) => e\.hp < 1\)\?\.id \?\? ""\);/);
    assert.match(code, /onHit: \(id\) => \{ this\.setEnemies\(this\.enemies\.filter\(\(e\) => e\.id !== id\)\); \}/);
    assert.match(code, /this\.sprite\.image = \(this\.enemies\.length >= 3\) \? "full\.png" : "spawning\.png";/);
  });

  it("parenthesises an object returned by an updater, and an array type of a union", () => {
    const { code } = compile(`interface P2 { x: number }
function C() {
  const [p, setP] = useState<P2>({ x: 0 });
  const [xs, setXs] = useState<(number | string)[]>([]);
  useUpdate((dt) => { setP((p) => ({ ...p, x: p.x + dt })); });
  return <Entity name="C" />;
}`);
    assert.match(code, /this\.setP\(\(p: P2\) => \(\{ \.\.\.p, x: p\.x \+ dt \}\)\);/);
    assert.match(code, /xs: \(number \| string\)\[\] = \[\];/);
  });

  it("type-checks every allowlisted array method", () => {
    const compiled = compile(
      withHandler(
        `const [items, setItems] = useState<Item[]>([{ id: "a", n: 1 }]);
  const [count, setCount] = useState(0);
  const [found, setFound] = useState(false);`,
        `const ids = items.map((e, i) => e.id + i);
    const first = items.find((e) => e.n > 0);
    setFound(items.some((e) => e.n > dt) && items.every((e) => e.n >= 0) && ids.includes("a"));
    setCount(items.findIndex((e) => e.id === "a") + ids.indexOf("a") + (first?.n ?? 0));
    setItems(items.slice(1).concat([{ id: "b", n: 2 }], items.slice(0, 1)));`,
      ),
    );
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("leaves members of values to the type-check, which catches a wrong one", () => {
    const compiled = compile(withHandler(`const [items, setItems] = useState<Item[]>([]);`, `setItems(items.filter((e) => e.nope));`));
    const errors = typeCheck(compiled);
    assert.ok(errors.some((d) => d.code === DiagnosticCode.GeneratedTypeError && d.message.includes("nope")), JSON.stringify(errors));
  });

  it("type-checks the Swarm module", () => {
    assert.deepEqual(typeCheck(compile(SWARM, "Swarm.tsx")), []);
  });

  it("type-checks authored source with array and record state", () => {
    const source = `import { useState, useUpdate, Entity } from "@rge/runtime/jsx";
interface Item { id: string; n: number }
function C() {
  const [items, setItems] = useState<Item[]>([]);
  const [best, setBest] = useState<Item>({ id: "", n: 0 });
  useUpdate((dt) => {
    setItems([...items, { id: "x", n: dt }]);
    setBest(items.find((e) => e.n > best.n) ?? best);
  });
  return <Entity name="C" />;
}`;
    assert.ok(getCompiler().compile("C.tsx", source).ok);
    assert.deepEqual(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5Source.tsx`, text: source }]), []);
    const wrong = source.replace(`{ id: "x", n: dt }`, `{ id: "x" }`);
    assert.ok(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5Wrong.tsx`, text: wrong }]).some((d) => d.code === DiagnosticCode.SourceTypeError));
  });
});

describe("M5a: runtime behaviour", () => {
  it("fills array state from handlers, one render per frame", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    assert.deepEqual(swarm.enemies, []);
    assert.equal(swarm.sprite.image, "spawning.png");

    assert.equal(world.tick(0.5), 1, "one render for two setters");
    assert.deepEqual(swarm.enemies, [{ id: "e0", hp: 2 }]);
    world.tick(0.5);
    world.tick(0.5);
    assert.deepEqual(swarm.enemies, [{ id: "e0", hp: 2 }, { id: "e1", hp: 3 }, { id: "e2", hp: 4 }]);
    assert.equal(swarm.sprite.image, "full.png", "JSX that reads the array's length followed it");
  });

  it("updates records immutably and drops the ones a filter removes", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    for (let i = 0; i < 3; i++) world.tick(0);
    const before = swarm.enemies;
    world.tick(1.5);
    assert.deepEqual(swarm.enemies, [{ id: "e0", hp: 0.5 }, { id: "e1", hp: 1.5 }, { id: "e2", hp: 2.5 }]);
    assert.notEqual(swarm.enemies, before, "a new array");
    assert.deepEqual(before, [{ id: "e0", hp: 2 }, { id: "e1", hp: 3 }, { id: "e2", hp: 4 }], "the old array and records are untouched");
    assert.equal(swarm.weakest, "e0", "find and optional member read");
    world.tick(1);
    assert.deepEqual(swarm.enemies.map((e) => e.id), ["e1", "e2"]);
  });

  it("passes a callback that filters the parent's array to a child", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    for (let i = 0; i < 3; i++) world.tick(0);
    world.tick(0, input(["t"]));
    // The Target's callback ran in the input phase, before the Swarm's update, which then rebuilt from the snapshot.
    swarm.setEnemies([{ id: "t", hp: 9 }, { id: "u", hp: 9 }]);
    world.flush();
    swarm.target.onInput(input(["t"]));
    world.flush();
    assert.deepEqual(swarm.enemies, [{ id: "u", hp: 9 }]);
  });

  it("does not render when a setter gets the same array", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    world.flush();
    swarm.setEnemies(swarm.enemies);
    assert.equal(world.flush(), 0);
    swarm.setEnemies((list) => list);
    assert.equal(world.flush(), 0);
    swarm.setEnemies([...swarm.enemies]);
    assert.equal(world.flush(), 1, "a copy is a new value");
  });
});

describe("M5a: diagnostics", () => {
  it("asks for a type argument for an array or object initial value", () => {
    assert.deepEqual(codes(withHandler(`const [items, setItems] = useState([]);`, ``)), [DiagnosticCode.UnsupportedStateType]);
    assert.deepEqual(codes(withHandler(`const [item, setItem] = useState({ id: "a", n: 1 });`, ``)), [DiagnosticCode.UnsupportedStateType]);
    assert.match(compileErrors(withHandler(`const [items, setItems] = useState([]);`, ``))[0]!.message, /useState<EnemyData\[\]>/);
  });

  it("keeps refs to primitives", () => {
    assert.deepEqual(codes(withHandler(`const r = useRef<Item[]>([]);`, ``)), [DiagnosticCode.InvalidUseRef]);
  });

  it("rejects mutating array methods, naming the immutable alternative", () => {
    for (const method of ["push", "splice", "sort", "forEach"]) {
      const errors = compileErrors(withHandler(`const [items, setItems] = useState<Item[]>([]);`, `items.${method}((e) => e);`));
      assert.deepEqual(errors.map((d) => d.code), [DiagnosticCode.UnsupportedExpression], method);
      assert.match(errors[0]!.message, /in place/, method);
    }
    assert.match(compileErrors(withHandler(`const [items, setItems] = useState<Item[]>([]);`, `items.push({ id: "a", n: 1 });`))[0]!.message, /setItems\(\[\.\.\.items, item\]\)/);
  });

  it("rejects array methods outside the allowlist, wrong argument counts and optional calls", () => {
    const state = `const [items, setItems] = useState<Item[]>([]);`;
    assert.deepEqual(codes(withHandler(state, `setItems(items.reduce((a, e) => a, []));`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `setItems(items.filter());`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `setItems(items.slice(1, 2, 3));`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `setItems(items?.filter((e) => e.n > 0));`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("takes only inline expression-bodied arrows as array callbacks", () => {
    const state = `const [items, setItems] = useState<Item[]>([]);`;
    assert.deepEqual(codes(withHandler(state, `setItems(items.filter((e) => { return e.n > 0; }));`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `setItems(items.filter(dt));`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `setItems(items.map((e) => setItems([])));`)), [DiagnosticCode.UnsupportedExpression], "a setter is not an expression");
    assert.deepEqual(codes(withHandler(state, `setItems(items.filter(({ n }) => n > 0));`)), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects arrow functions anywhere else", () => {
    assert.deepEqual(codes(withHandler(`const [n, setN] = useState(0);`, `const f = () => 1;`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("rejects object methods, getters and computed names", () => {
    const state = `const [item, setItem] = useState<Item>({ id: "a", n: 1 });`;
    assert.deepEqual(codes(withHandler(state, `setItem({ id: "b", n() { return 1; } } as never);`)).includes(DiagnosticCode.UnsupportedExpression), true);
    assert.deepEqual(codes(withHandler(state, `setItem({ ["id"]: "b", n: 1 });`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("still rejects members of numbers and booleans", () => {
    assert.deepEqual(codes(withHandler(`const [n, setN] = useState(0);`, `setN(n.x);`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(`const [b, setB] = useState(false);`, `setB(b.x);`)), [DiagnosticCode.UnsupportedExpression]);
    assert.doesNotThrow(() => compile(withHandler(`const [s, setS] = useState("ab"); const [n, setN] = useState(0);`, `setN(s.length);`)), "a string's length is fine");
  });
});
