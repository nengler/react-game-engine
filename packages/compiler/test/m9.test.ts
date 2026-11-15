import assert from "node:assert/strict";
/**
 * M9: `useMount` and `useUnmount`. A component runs `useMount` once when it
 * joins a World (children first) and `useUnmount` once when it leaves (parent
 * first). Unmount cannot set state: the component is going away.
 */
import { after, before, describe, it } from "node:test";

import { Entity, Sprite, World } from "@rge/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const BOARD = `
interface BadgeProps {
  id: string;
  onGone?: () => void;
}

function Badge({ id, onGone }: BadgeProps) {
  const s = useMutable({ ready: false, mounted: 0 });
  useMount(() => {
    s.ready = true;
    s.mounted += 1;
  });
  useUnmount(() => {
    onGone?.();
  });
  return (
    <Entity name={id}>
      <Sprite image={s.ready ? "ready.png" : "pending.png"} />
    </Entity>
  );
}

interface Item {
  id: string;
}

function Board() {
  const s = useMutable({ items: [] as Item[], gone: "", open: false });
  return (
    <Entity name="Board">
      {s.open && <Badge id="solo" onGone={() => { s.gone = "solo"; }} />}
      {s.items.map((it) => (
        <Badge key={it.id} id={it.id} onGone={() => { s.gone = "item:" + it.id; }} />
      ))}
    </Entity>
  );
}
`;

interface BadgeInstance extends Entity {
  readonly sprite: Sprite;
  s: { ready: boolean; mounted: number };
}
interface BoardInstance extends Entity {
  badge: BadgeInstance | null;
  readonly badge2Items: Map<string | number, BadgeInstance>;
  s: { gone: string; open: boolean; items: { id: string }[] };
}

let Board: new () => BoardInstance;

before(async () => {
  ({ Board } = await load<{ Board: typeof Board }>(compile(BOARD, "Board.tsx")));
});

function hooks(source: string, name: string) {
  const c = compile(source).ir.components.find((x) => x.name === name);
  assert.ok(c, name);
  return c.hooks;
}

describe("M9: IR and generated code", () => {
  it("lowers the hooks to handlers with no parameters", () => {
    const kinds = hooks(BOARD, "Badge").map((h) => h.kind);
    assert.deepEqual(kinds, ["UseState", "UseState", "OnMount", "OnUnmount"]);
    for (const h of hooks(BOARD, "Badge")) if (h.kind === "OnMount" || h.kind === "OnUnmount") assert.deepEqual(h.handler.params, []);
  });

  it("overrides onMount and onUnmount", () => {
    const { code } = compile(BOARD, "Board.tsx");
    assert.match(
      code,
      /override onMount\(\): void \{\n\s+this\.\$set_s_ready\(true\);\n\s+this\.\$set_s_mounted\(this\.#\$s_mountedNext \+ 1\);\n\s+\}/
    );
    assert.match(code, /override onUnmount\(\): void \{\n\s+this\.props\.onGone\?\.\(\);\n\s+\}/);
  });

  it("runs several of one kind in source order, so a return in one cannot skip the others", () => {
    const { code } = compile(`function C() {
  const s = useMutable({ r: 0 });
  useMount(() => { s.r = 1; });
  useMount(() => { if (s.r > 0) return; s.r = 2; });
  return <Entity name="C" />;
}`);
    assert.match(code, /override onMount\(\): void \{\n\s+this\.#onMount0\(\);\n\s+this\.#onMount1\(\);\n\s+\}/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(BOARD, "Board.tsx")), []);
  });

  it("type-checks authored source: a handler takes no arguments", () => {
    const check = (body: string) =>
      getCompiler().typeCheckSources([
        {
          fileName: `${process.cwd()}/.test-output/M9${Math.random()}.tsx`,
          text: `import { Entity, useMount, useUnmount } from "@rge/runtime/jsx";\nfunction C() { ${body} return <Entity name="C" />; }`,
        },
      ]);
    assert.deepEqual(check("useMount(() => {}); useUnmount(() => {});"), []);
    assert.ok(check("useMount((x: number) => {});").length > 0);
    assert.ok(check("useMount(5);").length > 0);
  });
});

describe("M9: runtime behaviour", () => {
  it("mounts a component when it joins the world, and renders what mount set in the same flush", () => {
    const world = new World();
    const board = new Board();
    world.mount(board);
    board.s.open = true;
    assert.equal(world.flush(), 2, "the board renders, then the mounted badge renders its new state");
    const solo = board.badge!;
    assert.equal(solo.s.mounted, 1);
    assert.equal(solo.s.ready, true);
    assert.equal(solo.sprite.image, "ready.png");
  });

  it("mounts list items as they are added", () => {
    const world = new World();
    const board = new Board();
    world.mount(board);
    board.s.items = [{ id: "a" }, { id: "b" }];
    world.flush();
    const [a, b] = [board.badge2Items.get("a")!, board.badge2Items.get("b")!];
    assert.deepEqual([a.s.mounted, a.s.ready, b.s.mounted, b.s.ready], [1, true, 1, true]);
    board.s.items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    world.flush();
    assert.equal(a.s.mounted, 1, "existing items do not mount again");
    assert.equal(board.badge2Items.get("c")!.s.mounted, 1);
  });

  it("unmounts a conditional component when its condition turns off, and tells the parent", () => {
    const world = new World();
    const board = new Board();
    world.mount(board);
    board.s.open = true;
    world.flush();
    board.s.open = false;
    world.flush();
    assert.equal(board.s.gone, "solo", "the callback reached the parent");
    assert.equal(board.badge, null);
  });

  it("unmounts a removed list item, whose callback can still read the item", () => {
    const world = new World();
    const board = new Board();
    world.mount(board);
    board.s.items = [{ id: "a" }, { id: "b" }];
    world.flush();
    board.s.items = [{ id: "b" }];
    world.flush();
    assert.equal(board.s.gone, "item:a", "the removed item's record was still readable when its unmount ran");
  });

  it("mounts children before their parent, so the parent sees them mounted", async () => {
    const { Parent } = await load<{ Parent: new () => Entity & { s: { log: string } } }>(
      compile(`interface LeafProps { id: string; onUp: (id: string) => void }
function Leaf({ id, onUp }: LeafProps) {
  useMount(() => onUp(id));
  return <Entity name={id} />;
}
function Parent() {
  const s = useMutable({ log: "" });
  useMount(() => { s.log += "P"; });
  return (
    <Entity name="Parent">
      <Leaf id="a" onUp={(id) => { s.log += id; }} />
      <Leaf id="b" onUp={(id) => { s.log += id; }} />
    </Entity>
  );
}`)
    );
    const world = new World();
    const parent = new Parent();
    world.mount(parent);
    world.flush();
    assert.equal(parent.s.log, "abP");
  });

  it("does nothing for a component that is never mounted", () => {
    const board = new Board();
    board.s.open = true;
    assert.equal(board.badge, null, "no world, no render, no mount");
  });
});

describe("M9: diagnostics", () => {
  const unmount = (body: string) => `function C() {
  const s = useMutable({ n: 0, r: 0 });
  useUnmount(() => { ${body} });
  return <Entity name="C" />;
}`;
  const codes = (source: string) => compileErrors(source).map((d) => d.code);

  it("rejects setting state in useUnmount, pointing at the alternatives", () => {
    const errors = compileErrors(unmount("s.n = 1;"));
    assert.deepEqual(
      errors.map((d) => d.code),
      [DiagnosticCode.UnsupportedStatement]
    );
    assert.match(errors[0]!.message, /useUnmount/);
    assert.match(errors[0]!.message, /callback prop/);
    assert.deepEqual(codes(unmount("if (s.r > 0) { s.n += 1; }")), [DiagnosticCode.UnsupportedStatement]);
  });

  it("allows reads and callback props in useUnmount, and state in useMount", () => {
    assert.doesNotThrow(() => compile(unmount("const n = s.n + 1;")));
    assert.doesNotThrow(() =>
      compile(`function C() { const s = useMutable({ n: 0 }); useMount(() => { s.n = 1; }); return <Entity name="C" />; }`)
    );
  });

  it("takes exactly one arrow function with no parameters", () => {
    for (const hook of ["useMount", "useUnmount"]) {
      assert.deepEqual(codes(`function C() { ${hook}(5); return <Entity name="C" />; }`), [DiagnosticCode.InvalidHandler], hook);
      assert.deepEqual(codes(`function C() { ${hook}(); return <Entity name="C" />; }`), [DiagnosticCode.InvalidHandler], hook);
      assert.deepEqual(codes(`function C() { ${hook}((x) => {}); return <Entity name="C" />; }`), [DiagnosticCode.InvalidHandler], hook);
    }
  });
});
