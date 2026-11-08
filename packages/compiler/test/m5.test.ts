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
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, stripSpans, typeCheck, withAuthoringImports as withAuthoring } from "./helpers.ts";

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

// ---------------------------------------------------------------------------
// M5b: keyed lists
// ---------------------------------------------------------------------------

const PACK = `
interface EnemyData {
  id: string;
  speed: number;
}

interface EnemyProps {
  speed: number;
  onDefeated?: () => void;
}

function Enemy({ speed, onDefeated }: EnemyProps) {
  return <Entity name="Enemy" transform={{ x: speed }} />;
}

function Pack() {
  const [enemies, setEnemies] = useState<EnemyData[]>([]);
  const [defeated, setDefeated] = useState("");
  const [showBoss, setShowBoss] = useState(false);
  return (
    <Entity name="Pack">
      <Sprite image="bg.png" />
      {enemies.map((e) => (
        <Enemy
          key={e.id}
          speed={e.speed}
          onDefeated={() => {
            setDefeated(\`\${e.id}@\${e.speed}\`);
            setEnemies(enemies.filter((x) => x.id !== e.id));
          }}
        />
      ))}
      <Sprite image="fg.png" />
      {showBoss && (
        <Entity name="Boss">
          {enemies.filter((e) => e.speed > 5).map((e, i) => <Sprite key={e.id} image={e.id + ".png"} transform={{ x: i * 10 }} />)}
        </Entity>
      )}
    </Entity>
  );
}
`;

interface EnemyBInstance extends Entity {
  props: { speed: number; onDefeated?: () => void };
}
interface PackInstance extends Entity {
  enemies: EnemyData2[];
  defeated: string;
  setEnemies(value: EnemyData2[]): void;
  setShowBoss(value: boolean): void;
  readonly enemyItems: Map<string | number, EnemyBInstance>;
  readonly sprite: Sprite;
  readonly sprite2: Sprite;
  entity: Entity | null;
  readonly sprite3Items: Map<string | number, Sprite>;
}
interface EnemyData2 {
  id: string;
  speed: number;
}

let Pack: new () => PackInstance;

before(async () => {
  ({ Pack } = await load<{ Pack: typeof Pack }>(compile(PACK, "Pack.tsx")));
});

/** A mounted Pack holding `enemies`. */
function pack(enemies: EnemyData2[] = []): { world: World; pack: PackInstance } {
  const world = new World();
  const p = new Pack();
  world.mount(p);
  p.setEnemies(enemies);
  world.flush();
  return { world, pack: p };
}

const ids = (p: PackInstance): string[] => p.children.map((c) => (c instanceof Sprite ? c.image : `${(c as EnemyBInstance).props.speed}`));

describe("M5b: IR shape", () => {
  it("lowers a map over state to a KeyedListChild", () => {
    const c = component(PACK, "Pack");
    const list = c.root.children[1]!;
    assert.equal(list.kind, "KeyedListChild");
    if (list.kind !== "KeyedListChild") return;
    assert.deepEqual(list.source, { kind: "StateRead", state: "Pack.enemies" });
    assert.deepEqual(list.dependencies, [{ kind: "State", state: "Pack.enemies" }]);
    assert.equal(list.item.name, "e");
    assert.equal(list.index, null);
    assert.deepEqual(list.key, { kind: "MemberRead", object: { kind: "ParamRead", param: list.item.id, name: "e" }, name: "id", optional: false });
    assert.equal(list.element.fieldName, "enemy");
    const speed = list.element.props.find((p) => p.name === "speed");
    assert.deepEqual(speed && speed.kind === "DynamicProp" && speed.dependencies, [{ kind: "Item" }], "a prop that reads the item is re-applied per item");
    assert.equal(list.element.props.find((p) => p.name === "onDefeated")?.kind, "CallbackProp");
  });

  it("takes a filtered source and an index", () => {
    const c = component(PACK, "Pack");
    const boss = c.root.children[3]!.element;
    const list = boss.children[0]!;
    assert.ok(list.kind === "KeyedListChild");
    assert.equal(list.source.kind, "Call");
    assert.equal(list.index?.name, "i");
    const x = list.element.transform.find((p) => p.name === "x");
    assert.deepEqual(x?.kind === "DynamicProp" && x.dependencies, [{ kind: "Item" }]);
  });

  it("takes a prop as the source", () => {
    const c = component(
      `interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  return <Entity name="C">{items.map((it) => <Sprite key={it.id} image={it.id} />)}</Entity>;
}`,
      "C",
    );
    const list = c.root.children[0]!;
    assert.ok(list.kind === "KeyedListChild");
    assert.deepEqual(list.dependencies, [{ kind: "Prop", name: "items" }]);
  });
});

describe("M5b: generated code", () => {
  it("keeps the instances in a map and the key order in a private field", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /readonly enemyItems: Map<string \| number, Enemy> = new Map\(\);/);
    assert.match(code, /#enemyOrder: \(string \| number\)\[\] = \[\];/);
    assert.match(code, /#enemyRecords: Map<string \| number, Pack\["enemies"\]\[number\]> = new Map\(\);/, "a callback reads the item");
    assert.doesNotMatch(code, /#sprite3Records/, "no callback reads the item: no records");
  });

  it("checks keys first, then updates, adds at (slot, position), removes and reorders", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /const \$keys = \$list\.map\(\(e\) => e\.id\);/);
    assert.match(code, /throw new Error\("Duplicate key " \+ JSON\.stringify\(\$key\) \+ " in the <Enemy> list of Pack\."\)/);
    assert.match(code, /\$parent\.queueAddChild\(\$item, 1, \$n\);/);
    assert.match(code, /\$item\.updateProps\(\{ speed: e\.speed \}\);/);
    assert.match(code, /\$parent\.queueRemoveChild\(\$item\);/);
    assert.match(code, /\$parent\.queueReorder\(1, \$keys\.map\(\(\$k\) => this\.enemyItems\.get\(\$k\)!\)\);/);
    assert.match(code, /this\.addChild\(this\.sprite2, 2\);/, "static siblings get slots");
  });

  it("reads the current item inside a callback, by key", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /this\.setDefeated\(`\$\{this\.#enemyRecords\.get\(\$key\)!\.id\}@\$\{this\.#enemyRecords\.get\(\$key\)!\.speed\}`\);/);
    assert.match(code, /this\.enemies\.filter\(\(x\) => x\.id !== this\.#enemyRecords\.get\(\$key\)!\.id\)/);
  });

  it("empties a list when its conditional subtree unmounts", () => {
    const { code } = compile(PACK, "Pack.tsx");
    assert.match(code, /this\.entity = null;\n\s+this\.sprite3Items\.clear\(\);\n\s+this\.#sprite3Order = \[\];/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(PACK, "Pack.tsx")), []);
  });

  it("type-checks authored source with a list", () => {
    const source = `import { useState, Entity, Sprite } from "@rge/runtime/jsx";
interface Item { id: string; n: number }
function C() {
  const [items, setItems] = useState<Item[]>([]);
  return <Entity name="C">{items.map((e, i) => <Sprite key={e.id} image={e.id} transform={{ x: i * e.n }} />)}</Entity>;
}`;
    assert.ok(getCompiler().compile("C.tsx", source).ok);
    assert.deepEqual(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5bSource.tsx`, text: source }]), []);
  });
});

describe("M5b: runtime behaviour", () => {
  it("adds items by key between the static siblings", () => {
    const { pack: p } = pack([{ id: "a", speed: 1 }, { id: "b", speed: 2 }]);
    assert.deepEqual(ids(p), ["bg.png", "1", "2", "fg.png"]);
    assert.deepEqual([...p.enemyItems.keys()], ["a", "b"]);
  });

  it("updates an item in place; an unchanged item keeps its identity and is not re-rendered", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }, { id: "b", speed: 2 }]);
    const [a, b] = [p.enemyItems.get("a")!, p.enemyItems.get("b")!];
    const renders = { a: 0, b: 0 };
    for (const [name, item] of [["a", a], ["b", b]] as const) {
      const render = item.render.bind(item);
      item.render = () => { renders[name]++; render(); };
    }
    p.setEnemies([{ id: "a", speed: 1 }, { id: "b", speed: 5 }]);
    assert.equal(world.flush(), 2, "the pack and the changed item render once each");
    assert.deepEqual(renders, { a: 0, b: 1 });
    assert.equal(p.enemyItems.get("a"), a);
    assert.equal(p.enemyItems.get("b"), b);
    assert.equal(b.props.speed, 5);
    assert.equal(b.transform.x, 5, "the item's own JSX followed its prop");
  });

  it("removes items whose key is gone", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }, { id: "b", speed: 2 }, { id: "c", speed: 3 }]);
    const b = p.enemyItems.get("b")!;
    p.setEnemies([{ id: "a", speed: 1 }, { id: "c", speed: 3 }]);
    world.flush();
    assert.deepEqual(ids(p), ["bg.png", "1", "3", "fg.png"]);
    assert.equal(b.parent, null);
    assert.equal(b.world, null);
    assert.equal(p.enemyItems.has("b"), false);
  });

  it("reorders by key, keeping instances, with static siblings in place", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }, { id: "b", speed: 2 }, { id: "c", speed: 3 }]);
    const before = [...p.enemyItems.values()];
    p.setEnemies([{ id: "c", speed: 3 }, { id: "x", speed: 9 }, { id: "a", speed: 1 }, { id: "b", speed: 2 }]);
    world.flush();
    assert.deepEqual(ids(p), ["bg.png", "3", "9", "1", "2", "fg.png"]);
    assert.ok(before.every((item) => [...p.enemyItems.values()].includes(item)), "same instances");
    assert.equal(p.children[0], p.sprite);
    assert.equal(p.children.at(-1), p.sprite2);
  });

  it("throws on a duplicate key without changing the list", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }]);
    const a = p.enemyItems.get("a");
    p.setEnemies([{ id: "a", speed: 1 }, { id: "a", speed: 2 }]);
    assert.throws(() => world.flush(), /Duplicate key "a" in the <Enemy> list of Pack/);
    assert.deepEqual([...p.enemyItems.keys()], ["a"]);
    assert.equal(p.enemyItems.get("a"), a);
  });

  it("gives a callback the item's current value, not the one it was created with", () => {
    const { world, pack: p } = pack([{ id: "a", speed: 1 }, { id: "b", speed: 2 }]);
    p.setEnemies([{ id: "a", speed: 7 }, { id: "b", speed: 2 }]);
    world.flush();
    p.enemyItems.get("a")!.props.onDefeated!();
    world.flush();
    assert.equal(p.defeated, "a@7");
    assert.deepEqual(p.enemies, [{ id: "b", speed: 2 }]);
    assert.deepEqual(ids(p), ["bg.png", "2", "fg.png"]);
  });

  it("renders a filtered list inside a conditional, and starts it afresh when it remounts", () => {
    const { world, pack: p } = pack([{ id: "slow", speed: 1 }, { id: "fast", speed: 8 }, { id: "faster", speed: 9 }]);
    p.setShowBoss(true);
    world.flush();
    const boss = p.entity!;
    assert.deepEqual(boss.children.map((c) => [(c as Sprite).image, c.transform.x]), [["fast.png", 0], ["faster.png", 10]]);
    p.setEnemies([{ id: "faster", speed: 9 }, { id: "fast", speed: 8 }]);
    world.flush();
    assert.deepEqual(boss.children.map((c) => [(c as Sprite).image, c.transform.x]), [["faster.png", 0], ["fast.png", 10]], "the index follows the order");
    p.setShowBoss(false);
    world.flush();
    assert.equal(p.entity, null);
    assert.equal(p.sprite3Items.size, 0);
    p.setShowBoss(true);
    world.flush();
    assert.notEqual(p.entity, boss);
    assert.deepEqual(p.entity!.children.map((c) => (c as Sprite).image), ["faster.png", "fast.png"]);
  });

  it("builds the list in the constructor from a prop", async () => {
    const { C } = await load<{ C: new (props: { items: { id: string }[] }) => Entity }>(
      compile(`interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  return <Entity name="C">{items.map((it) => <Sprite key={it.id} image={it.id} />)}</Entity>;
}`),
    );
    const c = new C({ items: [{ id: "a" }, { id: "b" }] });
    assert.deepEqual(c.children.map((s) => (s as Sprite).image), ["a", "b"]);
  });
});

describe("M5b: diagnostics", () => {
  const list = (item: string, state = `const [items, setItems] = useState<Item[]>([]);`) => `interface Item { id: string; n: number }
function C() {
  ${state}
  return <Entity name="C">{${item}}</Entity>;
}`;
  const listCodes = (item: string, state?: string) => codes(list(item, state));

  it("requires a key that reads the item", () => {
    assert.deepEqual(listCodes(`items.map((e) => <Sprite image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <Sprite key="k" image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <Sprite key={1} image={e.id} />)`), [DiagnosticCode.InvalidList]);
  });

  it("warns about an index key, but compiles it", () => {
    const result = getCompiler().compile("C.tsx", withAuthoring(list(`items.map((e, i) => <Sprite key={i} image={e.id} />)`)));
    assert.ok(result.ok);
    assert.deepEqual(result.diagnostics.map((d) => [d.code, d.severity]), [[DiagnosticCode.InvalidList, "warning"]]);
  });

  it("takes one element with no children from an inline arrow", () => {
    assert.deepEqual(listCodes(`items.map((e) => e.n > 0 && <Sprite key={e.id} image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <><Sprite key={e.id} image={e.id} /></>)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => { const x = 1; return <Sprite key={e.id} image={e.id} />; })`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map((e) => <Entity key={e.id}><Sprite image={e.id} /></Entity>)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map()`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.map(({ id }) => <Sprite key={id} image={id} />)`), [DiagnosticCode.InvalidList]);
    assert.doesNotThrow(() => compile(list(`items.map((e) => { return <Sprite key={e.id} image={e.id} />; })`)), "a block with one return is fine");
  });

  it("takes a state or prop array, optionally filtered", () => {
    assert.deepEqual(listCodes(`[1, 2].map((e) => <Sprite key={e} image="a" />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items.slice(1).map((e) => <Sprite key={e.id} image={e.id} />)`), [DiagnosticCode.InvalidList]);
    assert.deepEqual(listCodes(`items?.map((e) => <Sprite key={e.id} image={e.id} />)`), [DiagnosticCode.InvalidList]);
  });

  it("does not let a callback read the index", () => {
    const P = `interface Item { id: string; n: number }
interface RowProps { onPick: () => void }
function Row({ onPick }: RowProps) { return <Entity name="r" />; }
function C() {
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState(0);
  return <Entity name="C">{items.map((e, i) => <Row key={e.id} onPick={() => setPicked(i)} />)}</Entity>;
}`;
    assert.deepEqual(codes(P), [DiagnosticCode.InvalidList]);
  });

  it("reserves $ names for generated code", () => {
    assert.deepEqual(listCodes(`items.map(($e) => <Sprite key={$e.id} image={$e.id} />)`), [DiagnosticCode.InvalidHandler]);
  });

  it("still rejects key outside a list", () => {
    assert.deepEqual(codes(`function A() { return <Entity name="A"><Sprite key="x" image="a" /></Entity>; }`), [DiagnosticCode.UnsupportedAttribute]);
  });
});
