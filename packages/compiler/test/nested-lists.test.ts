import assert from "node:assert/strict";
/**
 * A list inside a list item (`{rows.map((row) => <Row key={row.id}>{row.cells.map((cell) => <Cell key={cell.id} … />)}</Row>)}`): each
 * item has a list of its own, kept in the item's record, which may read the item around it, its callbacks reading both items' current
 * values. A keyed element inside a list item is one too.
 */
import { after, describe, it } from "node:test";

import { Entity, Pointer, World } from "@rge/runtime";

import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const GRID = `
interface Cell { id: number; on: boolean }
interface Row { id: string; cells: Cell[]; open: boolean }
interface Tag { id: string }

function Grid() {
  const s = useMutable({
    rows: [
      { id: "a", open: true, cells: [{ id: 1, on: true }, { id: 2, on: false }] },
      { id: "b", open: true, cells: [{ id: 3, on: true }] },
    ] as Row[],
    tags: [{ id: "x" }, { id: "y" }] as Tag[],
    picked: "",
  });
  return (
    <Entity name="Grid">
      {s.rows.map((row, r) => (
        <Entity key={row.id} name={"row " + row.id}>
          <Entity name="cells">
            {row.cells.map((cell) => (
              <Entity key={cell.id} name={row.id + cell.id + (cell.on ? "+" : "-") + r}>
                <Pointer width={1} height={1} onPress={() => { s.picked = row.id + ":" + cell.id + ":" + cell.on; }} />
              </Entity>
            ))}
          </Entity>
          {row.open && <Entity name="lit">{row.cells.filter((c) => c.on).map((c) => <Entity key={c.id} name={"lit " + c.id} />)}</Entity>}
          {s.tags.map((t) => <Entity key={t.id} name={row.id + t.id} />)}
        </Entity>
      ))}
    </Entity>
  );
}

interface Leaf { id: number }
interface Branch { id: number; leaves: Leaf[] }
interface Tree { id: number; branches: Branch[] }

function Forest() {
  const s = useMutable({ trees: [{ id: 1, branches: [{ id: 10, leaves: [{ id: 100 }, { id: 101 }] }] }] as Tree[] });
  return (
    <Entity name="Forest">
      {s.trees.map((t) => (
        <Entity key={t.id} name={"t" + t.id}>
          {t.branches.map((b) => (
            <Entity key={b.id} name={"b" + b.id}>
              {b.leaves.map((l) => <Entity key={l.id} name={t.id + "/" + b.id + "/" + l.id} />)}
            </Entity>
          ))}
        </Entity>
      ))}
    </Entity>
  );
}

function Pages() {
  const s = useMutable({ books: [{ id: 1, page: 1 }] as { id: number; page: number }[] });
  return (
    <Entity name="Pages">
      {s.books.map((b) => (
        <Entity key={b.id} name={"book" + b.id}>
          <Entity key={b.page} name={"page" + b.page} />
        </Entity>
      ))}
    </Entity>
  );
}
`;

type Instance = Entity & { s: { [field: string]: unknown } };
const compiled = compile(GRID, "NestedLists.tsx");
const names = (e: Entity): string[] => e.children.map((c) => (c as Entity).name);
const child = (e: Entity, name: string): Entity => e.children.find((c) => (c as Entity).name === name) as Entity;

async function mounted(name: "Grid" | "Forest" | "Pages"): Promise<{ world: World; it: Instance }> {
  const module = await load<Record<string, new () => Instance>>(compiled);
  const world = new World();
  const it = new module[name]!();
  world.mount(it);
  world.flush();
  return { world, it };
}

/** Each row: its name, its cells, what is lit and its tags. */
function grid(g: Entity): [string, string[], string[] | null, string[]][] {
  return g.children.map((row) => {
    const r = row as Entity;
    const lit = child(r, "lit");
    return [r.name, names(child(r, "cells")), lit ? names(lit) : null, names(r).filter((n) => n !== "cells" && n !== "lit")];
  });
}

describe("a list inside a list item", () => {
  it("type-checks, and keeps the inner list's state in the item's record", () => {
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(
      compiled.code,
      /kids: \{ entity2: Entity \| null; entityItems: Map<string \| number, Entity>; entityOrder: \(string \| number\)\[\]; entityRecords: /
    );
    assert.match(compiled.code, /\$entityList\(row: Grid\["\$s_rows"\]\[number\]\) \{ return row\.cells; \}/);
  });

  it("builds each item's list from the item, beside lists that read the component", async () => {
    const { it: g } = await mounted("Grid");
    assert.deepEqual(grid(g), [
      ["row a", ["a1+0", "a2-0"], ["lit 1"], ["ax", "ay"]],
      ["row b", ["b3+1"], ["lit 3"], ["bx", "by"]],
    ]);
  });

  it("adds, removes and reorders inner items by key, and keeps their instances", async () => {
    const { world, it: g } = await mounted("Grid");
    const cells = child(g.children[0] as Entity, "cells");
    const two = cells.children[1];
    g.s.rows = [
      { id: "b", open: false, cells: [{ id: 3, on: false }] },
      {
        id: "a",
        open: true,
        cells: [
          { id: 2, on: true },
          { id: 4, on: true },
        ],
      },
    ];
    world.flush();
    assert.deepEqual(grid(g), [
      ["row b", ["b3-0"], null, ["bx", "by"]],
      ["row a", ["a2+1", "a4+1"], ["lit 2", "lit 4"], ["ax", "ay"]],
    ]);
    assert.equal(child(g.children[1] as Entity, "cells").children[0], two, "cell 2 kept its instance");
    g.s.rows = [{ id: "b", open: true, cells: [{ id: 3, on: true }] }];
    g.s.tags = [{ id: "y" }];
    world.flush();
    assert.deepEqual(grid(g), [["row b", ["b3+0"], ["lit 3"], ["by"]]], "the list under a condition starts again when it comes back");
  });

  it("gives a callback in an inner item both items' current values", async () => {
    const { world, it: g } = await mounted("Grid");
    const pointer = (child(g.children[0] as Entity, "cells").children[0] as Entity).children[0] as Pointer;
    g.s.rows = [{ id: "a", open: true, cells: [{ id: 1, on: false }] }];
    world.flush();
    world.reportPress(pointer, 1, 1);
    world.flush();
    assert.equal(g.s.picked, "a:1:false");
  });

  it("goes three deep", async () => {
    const { world, it: f } = await mounted("Forest");
    const leaves = (): string[] => f.children.flatMap((t) => (t as Entity).children.flatMap((b) => names(b as Entity)));
    assert.deepEqual(leaves(), ["1/10/100", "1/10/101"]);
    f.s.trees = [
      {
        id: 1,
        branches: [
          { id: 11, leaves: [{ id: 102 }] },
          { id: 10, leaves: [{ id: 101 }] },
        ],
      },
      { id: 2, branches: [{ id: 20, leaves: [] }] },
    ];
    world.flush();
    assert.deepEqual(leaves(), ["1/11/102", "1/10/101"]);
    assert.deepEqual(
      f.children.map((t) => names(t as Entity)),
      [["b11", "b10"], ["b20"]]
    );
  });

  it("takes a keyed element inside a list item, which starts over when its key changes", async () => {
    const { world, it: p } = await mounted("Pages");
    const first = (p.children[0] as Entity).children[0];
    assert.deepEqual(names(p.children[0] as Entity), ["page1"]);
    p.s.books = [{ id: 1, page: 2 }];
    world.flush();
    assert.deepEqual(names(p.children[0] as Entity), ["page2"]);
    assert.notEqual((p.children[0] as Entity).children[0], first);
  });
});
