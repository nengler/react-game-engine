/**
 * Records and arrays in handler code. Array and object literals (with spreads), member reads on values, the non-mutating
 * array methods with inline arrow callbacks, and array or record state (`enemies: [] as EnemyData[]`). Keyed lists in JSX
 * (lists.test.ts) build on this.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, Sprite, World, type InputState } from "@tsengine/runtime";

import { DiagnosticCode, type ExprIR, type StatementIR } from "../src/index.ts";
import {
  cleanOutput,
  closeCompiler,
  compile,
  compileErrors,
  getCompiler,
  load,
  stripSpans,
  typeCheck,
  elementOf,
  component,
  codes,
} from "./helpers.ts";

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
  const s = useMutable({ enemies: [] as EnemyData[], spawned: 0, weakest: "" });
  const full = s.enemies.length >= 3;

  useUpdate((dt) => {
    if (!full) {
      s.enemies = [...s.enemies, { id: \`e\${s.spawned}\`, hp: 2 + s.spawned }];
      s.spawned += 1;
      return;
    }
    const next = s.enemies.map((e) => ({ ...e, hp: e.hp - dt })).filter((e) => e.hp > 0);
    if (next.some((e) => e.hp < 1)) s.weakest = next.find((e) => e.hp < 1)?.id ?? "";
    s.enemies = next;
  });

  return (
    <Entity name="Swarm">
      <Sprite image={full ? "full.png" : "spawning.png"} />
      <Target id="t" onHit={(id) => { s.enemies = s.enemies.filter((e) => e.id !== id); }} />
    </Entity>
  );
}
`;

interface EnemyData {
  id: string;
  hp: number;
}
interface SwarmInstance extends Entity {
  s: { enemies: EnemyData[]; spawned: number; weakest: string };
  readonly sprite: Sprite;
  readonly target: Entity & { onInput(input: InputState): void };
}

let Swarm: new () => SwarmInstance;

before(async () => {
  ({ Swarm } = await load<{ Swarm: typeof Swarm }>(compile(SWARM, "Swarm.tsx")));
});

/** A component with the given state lines and one `useUpdate` handler body. */
function withHandler(state: string, body: string, types = "interface Item { id: string; n: number }"): string {
  return `${types}
function C() {
  ${state}
  useUpdate((dt) => { ${body} });
  return <Entity name="C" />;
}`;
}

const input = (pressed: string[]): InputState =>
  ({
    pressed: (a: string) => pressed.includes(a),
    down: () => false,
    released: () => false,
    pointerX: 0,
    pointerY: 0,
  }) as unknown as InputState;

describe("array and record state: IR shape", () => {
  it("types array and record state from the type argument", () => {
    const c = component(
      `interface Item { id: string }
function C() {
  const s = useMutable({
    items: [] as Item[],
    current: { id: "a" } as Item,
    grid: [] as number[][],
    mixed: [] as (Item | null)[],
  });
  return <Entity name="C" />;
}`,
      "C"
    );
    assert.deepEqual(
      c.state.map((s) => s.type),
      [
        { kind: "Array", element: { kind: "SourceType", text: "Item" } },
        { kind: "SourceType", text: "Item" },
        { kind: "Array", element: { kind: "Array", element: { kind: "Primitive", name: "number" } } },
        { kind: "Array", element: { kind: "SourceType", text: "Item | null" } },
      ]
    );
    assert.deepEqual(c.state[0]!.initialValue, { kind: "ArrayLiteral", elements: [] });
    assert.deepEqual(c.state[1]!.initialValue, {
      kind: "ObjectLiteral",
      properties: [{ kind: "Property", name: "id", value: { kind: "StringLiteral", value: "a" } }],
    });
  });

  it("lowers literals with spreads, member reads and array methods with arrow callbacks", () => {
    const c = component(
      withHandler(
        `const s = useMutable({ items: [] as Item[] });`,
        `s.items = [...s.items.filter((e) => e.n > dt), { id: "x", n: s.items.length }];`
      ),
      "C"
    );
    const handler = c.hooks.find((h) => h.kind === "OnUpdate");
    assert.ok(handler?.kind === "OnUpdate");
    const set = handler.handler.body[0] as StatementIR & { kind: "SetState"; value: ExprIR };
    // A handler reads the field as it is now (its pending value).
    const items = { kind: "StateRead", state: "C.s.items", live: true };
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
  const s = useMutable({ items: [] as Item[] });
  return <Entity name="C"><Sprite image={s.items.some((e) => e.n > 3) ? "a.png" : "b.png"} /></Entity>;
}`,
      "C"
    );
    const sprite = elementOf(c.root.children[0]!);
    const image = sprite.props[0]!;
    assert.equal(image.kind, "DynamicProp");
    assert.deepEqual(image.kind === "DynamicProp" && image.dependencies, [{ kind: "State", state: "C.s.items" }]);
  });

  it("takes an array prop's type for state initialised from it", () => {
    const c = component(
      `interface Item { id: string }
interface P { items: Item[] }
function C({ items }: P) {
  const s = useMutable({ list: items });
  return <Entity name="C" />;
}`,
      "C"
    );
    // The props type keeps an array of a source type as text, which generates the same code.
    assert.deepEqual(c.state[0]!.type, { kind: "SourceType", text: "Item[]" });
  });
});

describe("array and record state: generated code", () => {
  it("types the state field, its pending value and its setter", () => {
    const { code } = compile(SWARM, "Swarm.tsx");
    assert.match(code, /^ {2}\$s_enemies: EnemyData\[\] = \[\];$/m);
    assert.match(code, /^ {2}#\$s_enemiesNext: EnemyData\[\] = this\.\$s_enemies;$/m);
    assert.match(code, /\$set_s_enemies\(value: EnemyData\[\]\): void/);
    assert.match(code, /^export interface EnemyData \{/m, "the record type is copied into the module");
  });

  it("emits literals, spreads, member reads and arrow callbacks; an object body is parenthesised", () => {
    const { code } = compile(SWARM, "Swarm.tsx");
    // A write is a call of the field's setter; a handler reads a field as it is now (its pending value), render as committed.
    assert.match(
      code,
      /this\.\$set_s_enemies\(\[\.\.\.this\.#\$s_enemiesNext, \{ id: `e\$\{this\.#\$s_spawnedNext\}`, hp: 2 \+ this\.#\$s_spawnedNext \}\]\);/
    );
    assert.match(
      code,
      /const next = this\.#\$s_enemiesNext\.map\(\(e\) => \(\{ \.\.\.e, hp: e\.hp - dt \}\)\)\.filter\(\(e\) => e\.hp > 0\);/
    );
    assert.match(code, /this\.\$set_s_weakest\(next\.find\(\(e\) => e\.hp < 1\)\?\.id \?\? ""\);/);
    assert.match(code, /onHit: \(id\) => \{ this\.\$set_s_enemies\(this\.#\$s_enemiesNext\.filter\(\(e\) => e\.id !== id\)\); \}/);
    assert.match(
      code,
      /const (\$\d+)(?:: [^=]+)? = \(this\.\$s_enemies\.length >= 3\) \? "full\.png" : "spawning\.png";[^]*?this\.sprite\.image = \1;/
    );
  });

  it("writes an object to a field in a callback and in a hook, and types an array of a union", () => {
    const { code } = compile(`interface P2 { x: number }
function C() {
  const s = useMutable({ p: { x: 0 } as P2, xs: [] as (number | string)[] });
  useUpdate((dt) => { s.p = ({ ...s.p, x: s.p.x + dt }); });
  return <Entity name="C"><Pointer width={1} height={1} onPress={() => { s.p = ({ ...s.p, x: 0 }); }} /></Entity>;
}`);
    assert.match(code, /onPress: \(\) => \{ this\.\$set_s_p\(\{ \.\.\.this\.#\$s_pNext, x: 0 \}\); \}/);
    assert.match(code, /this\.\$set_s_p\(\{ \.\.\.this\.#\$s_pNext, x: this\.#\$s_pNext\.x \+ dt \}\);/);
    assert.match(code, /\$s_xs: \(number \| string\)\[\] = \[\];/);
  });

  it("type-checks every allowlisted array method", () => {
    const compiled = compile(
      withHandler(
        `const s = useMutable({ items: [{ id: "a", n: 1 }] as Item[], count: 0, found: false });`,
        `const ids = s.items.map((e, i) => e.id + i);
    const first = s.items.find((e) => e.n > 0);
    s.found = s.items.some((e) => e.n > dt) && s.items.every((e) => e.n >= 0) && ids.includes("a");
    s.count = s.items.findIndex((e) => e.id === "a") + ids.indexOf("a") + (first?.n ?? 0);
    s.items = s.items.slice(1).concat([{ id: "b", n: 2 }], s.items.slice(0, 1));`
      )
    );
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("leaves members of values to the type-check, which catches a wrong one", () => {
    const compiled = compile(withHandler(`const s = useMutable({ items: [] as Item[] });`, `s.items = s.items.filter((e) => e.nope);`));
    const errors = typeCheck(compiled);
    assert.ok(
      errors.some((d) => d.code === DiagnosticCode.GeneratedTypeError && d.message.includes("nope")),
      JSON.stringify(errors)
    );
  });

  it("type-checks the Swarm module", () => {
    assert.deepEqual(typeCheck(compile(SWARM, "Swarm.tsx")), []);
  });

  it("type-checks authored source with array and record state", () => {
    const source = `import { useMutable, useUpdate, Entity } from "@tsengine/runtime/jsx";
interface Item { id: string; n: number }
function C() {
  const s = useMutable({ items: [] as Item[], best: { id: "", n: 0 } as Item });
  useUpdate((dt) => {
    s.items = [...s.items, { id: "x", n: dt }];
    s.best = s.items.find((e) => e.n > s.best.n) ?? s.best;
  });
  return <Entity name="C" />;
}`;
    assert.ok(getCompiler().compile("C.tsx", source).ok);
    assert.deepEqual(getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5Source.tsx`, text: source }]), []);
    const wrong = source.replace(`{ id: "x", n: dt }`, `{ id: "x" }`);
    assert.ok(
      getCompiler()
        .typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M5Wrong.tsx`, text: wrong }])
        .some((d) => d.code === DiagnosticCode.SourceTypeError)
    );
  });
});

describe("array and record state: runtime behaviour", () => {
  it("fills array state from handlers, one render per frame", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    assert.deepEqual(swarm.s.enemies, []);
    assert.equal(swarm.sprite.image, "spawning.png");

    assert.equal(world.tick(0.5), 1, "one render for two setters");
    assert.deepEqual(swarm.s.enemies, [{ id: "e0", hp: 2 }]);
    world.tick(0.5);
    world.tick(0.5);
    assert.deepEqual(swarm.s.enemies, [
      { id: "e0", hp: 2 },
      { id: "e1", hp: 3 },
      { id: "e2", hp: 4 },
    ]);
    assert.equal(swarm.sprite.image, "full.png", "JSX that reads the array's length followed it");
  });

  it("updates records immutably and drops the ones a filter removes", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    for (let i = 0; i < 3; i++) world.tick(0);
    const before = swarm.s.enemies;
    world.tick(1.5);
    assert.deepEqual(swarm.s.enemies, [
      { id: "e0", hp: 0.5 },
      { id: "e1", hp: 1.5 },
      { id: "e2", hp: 2.5 },
    ]);
    assert.notEqual(swarm.s.enemies, before, "a new array");
    assert.deepEqual(
      before,
      [
        { id: "e0", hp: 2 },
        { id: "e1", hp: 3 },
        { id: "e2", hp: 4 },
      ],
      "the old array and records are untouched"
    );
    assert.equal(swarm.s.weakest, "e0", "find and optional member read");
    world.tick(1);
    assert.deepEqual(
      swarm.s.enemies.map((e) => e.id),
      ["e1", "e2"]
    );
  });

  it("passes a callback that filters the parent's array to a child", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    for (let i = 0; i < 3; i++) world.tick(0);
    world.tick(0, input(["t"]));
    // The Target's callback ran in the input phase, before the Swarm's update.
    swarm.s.enemies = [
      { id: "t", hp: 9 },
      { id: "u", hp: 9 },
    ];
    world.flush();
    swarm.target.onInput(input(["t"]));
    world.flush();
    assert.deepEqual(swarm.s.enemies, [{ id: "u", hp: 9 }]);
  });

  it("does not render when a field is given the same array", () => {
    const world = new World();
    const swarm = new Swarm();
    world.mount(swarm);
    world.flush();
    // oxlint-disable-next-line no-self-assign -- the write itself is what the test exercises
    swarm.s.enemies = swarm.s.enemies;
    assert.equal(world.flush(), 0);
    swarm.s.enemies = [...swarm.s.enemies];
    assert.equal(world.flush(), 1, "a copy is a new value");
  });
});

describe("array and record state: diagnostics", () => {
  it("asks for a type argument for an empty array, and infers an object of plain values as TypeScript does", () => {
    assert.deepEqual(codes(withHandler(`const s = useMutable({ items: [] });`, ``)), [DiagnosticCode.UnsupportedStateType]);
    assert.match(compileErrors(withHandler(`const s = useMutable({ items: [] });`, ``))[0]!.message, /enemies: \[\] as EnemyData\[\]/);
    // Since 2026-11-14: `{ id: "a", n: 1 }` is `{ id: string; n: number }`, as TypeScript infers it.
    assert.match(
      compile(withHandler(`const s = useMutable({ item: { id: "a", n: 1 } });`, ``)).code,
      /\$s_item: \{ id: string; n: number \} = /
    );
  });

  it("rejects mutating array methods used as values, naming the statement and the immutable alternative", () => {
    for (const method of ["push", "splice", "sort"]) {
      const errors = compileErrors(withHandler(`const s = useMutable({ items: [] as Item[] });`, `const r = s.items.${method}((e) => e);`));
      assert.deepEqual(
        errors.map((d) => d.code),
        [DiagnosticCode.UnsupportedExpression],
        method
      );
      assert.match(errors[0]!.message, /in place/, method);
    }
    // `forEach` changes nothing itself: it is refused for a loop, not as a change in place.
    const forEach = compileErrors(withHandler(`const s = useMutable({ items: [] as Item[] });`, `s.items.forEach((e) => e);`));
    assert.deepEqual(
      forEach.map((d) => d.code),
      [DiagnosticCode.UnsupportedExpression]
    );
    assert.match(forEach[0]!.message, /^`forEach` is not supported: write a `for \(const item of items\)/);
    // As a statement, `push` is written for the author: a new array with the item added.
    assert.match(
      compile(withHandler(`const s = useMutable({ items: [] as Item[] });`, `s.items.push({ id: "a", n: 1 });`)).code,
      /\$set_s_items\(\[\.\.\.this\.#\$s_itemsNext, \{ id: "a", n: 1 \}\]\)/
    );
  });

  it("rejects array methods outside the allowlist, wrong argument counts and optional calls", () => {
    const state = `const s = useMutable({ items: [] as Item[] });`;
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.copyWithin(0, 1);`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.filter();`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.slice(1, 2, 3);`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(state, `s.items = s.items?.filter((e) => e.n > 0);`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("takes only inline expression-bodied arrows as array callbacks", () => {
    const state = `const s = useMutable({ items: [] as Item[] });`;
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.filter((e) => { return e.n > 0; });`)), [
      DiagnosticCode.UnsupportedExpression,
    ]);
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.filter(dt);`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(
      codes(withHandler(state, `s.items = s.items.map((e) => (s.items = []));`)),
      [DiagnosticCode.UnsupportedExpression],
      "a write is not an expression"
    );
    assert.deepEqual(codes(withHandler(state, `s.items = s.items.filter(({ n }) => n > 0);`)), [DiagnosticCode.InvalidHandler]);
  });

  it("rejects arrow functions anywhere else", () => {
    assert.deepEqual(codes(withHandler(`const s = useMutable({ n: 0 });`, `const f = () => 1;`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("rejects object methods, getters and computed names", () => {
    const state = `const s = useMutable({ item: { id: "a", n: 1 } as Item });`;
    assert.deepEqual(
      codes(withHandler(state, `s.item = { id: "b", n() { return 1; } } as never;`)).includes(DiagnosticCode.UnsupportedExpression),
      true
    );
    assert.deepEqual(codes(withHandler(state, `s.item = { ["id"]: "b", n: 1 };`)), [DiagnosticCode.UnsupportedExpression]);
  });

  it("still rejects members of numbers and booleans", () => {
    assert.deepEqual(codes(withHandler(`const s = useMutable({ n: 0 });`, `s.n = s.n.x;`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(withHandler(`const s = useMutable({ b: false });`, `s.b = s.b.x;`)), [DiagnosticCode.UnsupportedExpression]);
    assert.doesNotThrow(
      () => compile(withHandler(`const s = useMutable({ str: "ab", n: 0 });`, `s.n = s.str.length;`)),
      "a string's length is fine"
    );
  });
});
