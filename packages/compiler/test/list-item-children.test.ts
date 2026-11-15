/** Children on list items, and conditions and nested children inside them. A list inside a list item is in nested-lists.test.ts. */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, Pointer, Shape, Text, World } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

// ---------------------------------------------------------------------------------------------------------------------------
// Children on list items
// ---------------------------------------------------------------------------------------------------------------------------

const ITEM_CHILDREN = `
interface Opt {
  id: number;
  label: string;
  ok: boolean;
}

interface BtnProps {
  on: boolean;
  onPress: () => void;
  children: Child;
}

function Btn({ on, onPress, children }: BtnProps) {
  return (
    <Entity name={on ? "on" : "off"}>
      <Pointer width={4} height={4} onPress={() => onPress()} />
      <Entity name="content">{children}</Entity>
    </Entity>
  );
}

interface TagProps {
  text: string;
}

function Tag({ text }: TagProps) {
  return <Entity name={text} />;
}

function Menu() {
  const s = useMutable({
    opts: [{ id: 1, label: "a", ok: true }, { id: 2, label: "b", ok: false }] as Opt[],
    picked: 0,
  });
  return (
    <Entity name="Menu">
      {s.opts.map((o) => (
        <Btn key={o.id} on={o.ok} onPress={() => { s.picked = o.id; }}>
          <Tag text={o.label} />
          <Tag text={"#" + o.id} />
        </Btn>
      ))}
    </Entity>
  );
}

function Rows() {
  const s = useMutable({ opts: [{ id: 1, label: "a", ok: true }] as Opt[] });
  return (
    <Entity name="Rows">
      {s.opts.map((o) => (
        <Entity key={o.id} name={o.label}>
          <Shape kind="rect" width={o.id} height={1} />
        </Entity>
      ))}
    </Entity>
  );
}
`;

interface MenuInstance extends Entity {
  readonly picked: number;
  s: { [field: string]: unknown };
}

describe("children on list items", () => {
  let Menu: new () => MenuInstance;
  let Rows: new () => MenuInstance;
  before(async () => {
    ({ Menu, Rows } = await load<{ Menu: typeof Menu; Rows: typeof Rows }>(compile(ITEM_CHILDREN, "Items.tsx")));
  });

  /** For each item: its button's name and the names inside its `content` entity. */
  const summary = (menu: Entity): [string, string[]][] =>
    menu.children.map((btn) => {
      const content = btn.children.find((c) => (c as Entity).name === "content") as Entity;
      return [(btn as Entity).name, content.children.map((c) => (c as Entity).name)];
    });

  it("builds each item's children with it, reading the item", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    assert.deepEqual(summary(m), [
      ["on", ["a", "#1"]],
      ["off", ["b", "#2"]],
    ]);
  });

  it("applies the item's new value to its children, and to a new item", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    m.s.opts = [
      { id: 1, label: "A", ok: false },
      { id: 2, label: "b", ok: false },
      { id: 3, label: "c", ok: true },
    ];
    world.flush();
    assert.deepEqual(summary(m), [
      ["off", ["A", "#1"]],
      ["off", ["b", "#2"]],
      ["on", ["c", "#3"]],
    ]);
  });

  it("removes an item's children with it, and a callback reads the item's current value", () => {
    const world = new World();
    const m = new Menu();
    world.mount(m);
    world.flush();
    m.s.opts = [{ id: 2, label: "b", ok: false }];
    world.flush();
    assert.deepEqual(summary(m), [["off", ["b", "#2"]]]);
    const pointer = (m.children[0] as Entity).children[0] as Pointer;
    world.reportPress(pointer, 1, 1);
    world.flush();
    assert.equal(m.s.picked, 2);
  });

  it("takes children on a built-in item too", () => {
    const world = new World();
    const r = new Rows();
    world.mount(r);
    world.flush();
    assert.equal(r.children.length, 1);
    assert.equal(r.children[0]!.children.length, 1);
    assert.equal((r.children[0]!.children[0] as Shape).width, 1);
  });

  const compiled = compile(ITEM_CHILDREN, "Items.tsx");
  it("type-checks the generated module and keeps the children in the item's record", () => {
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /kids: \{ tag: Tag \| null; tag2: Tag \| null \}/);
    assert.match(compiled.code, /\$item\.attachPassedChild\(\$rec\.kids\.tag, 0\)/);
  });

  it("takes a list inside an item's children (nested-lists.test.ts)", () => {
    const nested = compile(
      `${ITEM_CHILDREN}\nfunction Nested() { const s = useMutable({ opts: [] as Opt[] }); return <Entity name="B">{s.opts.map((o) => <Btn key={o.id} on onPress={() => {}}>{s.opts.map((p) => <Tag key={p.id} text="x" />)}</Btn>)}</Entity>; }`,
      "NestedItems.tsx"
    );
    assert.deepEqual(typeCheck(nested), []);
  });
});

const ITEM_CONDITIONS = `
interface Slot {
  id: number;
  label: string;
  count: number;
  locked: boolean;
}

interface Grid {
  slots: Slot[];
}

function Inventory() {
  const st = useMutable({
    grid: { slots: [{ id: 1, label: "key", count: 1, locked: false }, { id: 2, label: "", count: 0, locked: true }] } as Grid,
    picked: "",
  });
  return (
    <Entity name="Inventory">
      {st.grid.slots.map((s) => (
        <Entity key={s.id} name={"slot" + s.id}>
          <Shape kind="rect" width={10} height={10} />
          {s.count > 0 && (
            <Entity name="filled">
              <Text>{s.label}</Text>
              {s.count > 1 && <Text>{"x" + s.count}</Text>}
              <Pointer width={4} height={4} onPress={() => { st.picked = s.label; }} />
            </Entity>
          )}
          {s.locked ? <Entity name="lock" /> : null}
        </Entity>
      ))}
    </Entity>
  );
}
`;

interface InventoryInstance extends Entity {
  readonly picked: string;
  st: { [field: string]: unknown };
}

describe("conditions and nested children inside list items", () => {
  let Inventory: new () => InventoryInstance;
  before(async () => {
    ({ Inventory } = await load<{ Inventory: typeof Inventory }>(compile(ITEM_CONDITIONS, "Inventory.tsx")));
  });

  /** For each slot: the names of its children, and the texts inside its `filled` entity. */
  const summary = (inv: Entity): [string, string[], string[]][] =>
    inv.children.map((slot) => {
      const filled = slot.children.find((c) => (c as Entity).name === "filled");
      const texts = filled ? filled.children.filter((c): c is Text => c instanceof Text).map((t) => t.text) : [];
      return [(slot as Entity).name, slot.children.map((c) => (c instanceof Entity ? c.name : c.constructor.name)), texts];
    });

  it("builds only the children whose conditions hold, in their written places", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "filled"], ["key"]],
      ["slot2", ["Shape", "lock"], []],
    ]);
  });

  it("adds and removes them as the item changes, keeping the item's instance", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    const first = inv.children[0];
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 3, locked: false },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    assert.equal(inv.children[0], first);
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "filled"], ["key", "x3"]],
      ["slot2", ["Shape", "filled"], ["bell"]],
    ]);
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 0, locked: true },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    assert.deepEqual(summary(inv), [
      ["slot1", ["Shape", "lock"], []],
      ["slot2", ["Shape", "filled"], ["bell"]],
    ]);
  });

  it("gives a child made later a callback that reads the item's current value", () => {
    const world = new World();
    const inv = new Inventory();
    world.mount(inv);
    world.flush();
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 1, locked: false },
        { id: 2, label: "bell", count: 1, locked: false },
      ],
    };
    world.flush();
    inv.st.grid = {
      slots: [
        { id: 1, label: "key", count: 1, locked: false },
        { id: 2, label: "shears", count: 1, locked: false },
      ],
    };
    world.flush();
    const filled = inv.children[1]!.children.find((c) => (c as Entity).name === "filled")!;
    world.reportPress(filled.children.find((c) => c instanceof Pointer) as Pointer, 1, 1);
    world.flush();
    assert.equal(inv.st.picked, "shears");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(ITEM_CONDITIONS, "Inventory.tsx")), []);
  });
});
