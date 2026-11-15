/**
 * Passed children: a component that renders `{children}` takes the elements written between its tags, owned and updated by the
 * parent, mounted at the slot among the receiver's own children. Also forwarding `{children}` through other components.
 * Words between the tags (`children: TextChild`) are in text-children.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Entity, Sprite, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck, elementOf, component } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const CARD = `
import { type Child, Entity, Sprite, Collider, useMutable } from "@tsengine/runtime/jsx";

interface PanelProps {
  title: string;
  children: Child;
}

function Panel({ title, children }: PanelProps) {
  return (
    <Entity name="Panel">
      <Sprite image={title + ".png"} />
      <Entity name="Body">
        <Collider width={1} height={1} />
        {children}
        <Collider width={2} height={2} />
      </Entity>
    </Entity>
  );
}

function Card() {
  const s = useMutable({ open: false, label: "a" });
  return (
    <Entity name="Card">
      <Panel title={s.label}>
        <Sprite image="first.png" />
        {s.open && <Sprite image={s.label + "-open.png"} />}
        <Sprite image="last.png" />
      </Panel>
      {s.open && (
        <Panel title="shown">
          <Sprite image="inner.png" />
          {s.label === "b" && <Sprite image="inner-b.png" />}
        </Panel>
      )}
    </Entity>
  );
}
`;

interface PanelInstance extends Entity {
  props: { title: string };
  readonly entity: Entity;
}
interface CardInstance extends Entity {
  readonly panel: PanelInstance;
  panel2: PanelInstance | null;
  s: { open: boolean; label: string };
}

let Card: new () => CardInstance;
let PanelClass: new (props: { title: string }) => PanelInstance;

before(async () => {
  ({ Card, Panel: PanelClass } = await load<{ Card: typeof Card; Panel: typeof PanelClass }>(compile(CARD, "Card.tsx")));
});

/** The names of a container's children: images for sprites, widths for colliders, names for entities. */
const kids = (e: Entity): string[] =>
  e.children.map((c) => (c instanceof Sprite ? c.image : c instanceof Entity ? c.name : `${(c as unknown as { width: number }).width}`));
const body = (p: PanelInstance): Entity => p.children[1] as Entity;

describe("passed children: IR shape", () => {
  it("marks a component that renders {children}, and keeps the slot among its siblings", () => {
    const c = component(CARD, "Panel");
    assert.equal(c.acceptsChildren, true);
    assert.deepEqual(
      c.props.map((p) => p.name),
      ["title"],
      "children is not a value prop"
    );
    const bodyEl = elementOf(c.root.children[1]!);
    assert.deepEqual(
      bodyEl.children.map((k) => k.kind),
      ["StaticChild", "ChildrenSlot", "StaticChild"]
    );
    assert.equal(component(CARD, "Card").acceptsChildren, false);
  });

  it("holds the children passed to a component on its element, owned by the parent", () => {
    const card = component(CARD, "Card");
    const panel = elementOf(card.root.children[0]!);
    assert.equal(panel.component.kind, "Local");
    assert.deepEqual(
      panel.children.map((k) => k.kind),
      ["StaticChild", "ConditionalChild", "StaticChild"]
    );
    const conditional = panel.children[1]!;
    assert.ok(conditional.kind === "ConditionalChild");
    assert.deepEqual(conditional.dependencies, [{ kind: "State", state: "Card.s.open" }]);
  });
});

describe("passed children: generated code", () => {
  it("extends the host with the props type minus children, and says where passed children mount", () => {
    const { code } = compile(CARD, "Card.tsx");
    assert.match(code, /export class Panel extends Entity<Omit<PanelProps, "children">> \{/);
    assert.match(code, /constructor\(props: Omit<PanelProps, "children">\) \{/);
    assert.match(code, /updateProps\(next: Partial<Omit<PanelProps, "children">>\): void \{/);
    assert.match(code, /this\.passedChildrenHost = this\.entity;\n\s+this\.passedChildrenSlot = 1;/, "the slot follows the first collider");
    assert.match(code, /import \{[^}]*type Child[^}]*\} from "@tsengine\/runtime";/);
  });

  it("gives the component's own children slots, so passed children land between them", () => {
    const { code } = compile(CARD, "Card.tsx");
    assert.match(code, /this\.entity\.addChild\(this\.collider, 0\);/);
    assert.match(code, /this\.entity\.addChild\(this\.collider2, 2\);/);
  });

  it("attaches passed children at their position in the block; a condition queues and detaches", () => {
    const { code } = compile(CARD, "Card.tsx");
    assert.match(code, /this\.panel\.attachPassedChild\(this\.sprite, 0\);/);
    assert.match(code, /this\.panel\.attachPassedChild\(this\.sprite3, 2\);/);
    assert.match(code, /this\.panel\.queueAttachPassedChild\(this\.sprite2, 1\);/);
    assert.match(code, /this\.panel\.queueDetachPassedChild\(this\.sprite2\);/);
  });

  it("mounts a passed block when its component mounts conditionally", () => {
    const { code } = compile(CARD, "Card.tsx");
    assert.match(code, /this\.panel2\.attachPassedChild\(this\.sprite4, 0\);/);
    assert.match(code, /this\.panel2\.queueAttachPassedChild\(this\.sprite5, 1\);/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(CARD, "Card.tsx")), []);
  });

  it("type-checks authored source: children are required where declared, and rejected where not", () => {
    const check = (source: string) =>
      getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/M8Source${Math.random()}.tsx`, text: source }]);
    const head = `import { Entity, Sprite, type Child } from "@tsengine/runtime/jsx";
interface BoxProps { children: Child }
function Box({ children }: BoxProps) { return <Entity name="Box">{children}</Entity>; }
interface LeafProps { n: number }
function Leaf({ n }: LeafProps) { return <Sprite image={"a" + n} />; }
`;
    assert.deepEqual(check(`${head}function Ok() { return <Entity name="Ok"><Box><Sprite image="a" /></Box></Entity>; }`), []);
    assert.ok(check(`${head}function Bad() { return <Entity name="Bad"><Box /></Entity>; }`).length > 0, "children are required");
    assert.ok(
      check(`${head}function Bad() { return <Entity name="Bad"><Leaf n={1}><Sprite image="a" /></Leaf></Entity>; }`).length > 0,
      "Leaf takes no children"
    );
  });
});

describe("passed children: runtime behaviour", () => {
  it("mounts the passed children at the slot, between the component's own children", () => {
    const card = new Card();
    assert.deepEqual(kids(body(card.panel)), ["1", "first.png", "last.png", "2"]);
  });

  it("mounts a passed child that appears later between its siblings, and removes it again", () => {
    const world = new World();
    const card = new Card();
    world.mount(card);
    card.s.open = true;
    world.flush();
    assert.deepEqual(kids(body(card.panel)), ["1", "first.png", "a-open.png", "last.png", "2"]);
    card.s.open = false;
    world.flush();
    assert.deepEqual(kids(body(card.panel)), ["1", "first.png", "last.png", "2"]);
  });

  it("updates a passed child from the parent's state, not the receiver's", () => {
    const world = new World();
    const card = new Card();
    world.mount(card);
    card.s.open = true;
    world.flush();
    const open = body(card.panel).children[2] as Sprite;
    card.s.label = "b";
    world.flush();
    assert.equal(open.image, "b-open.png", "same instance, the parent's prop followed its state");
    assert.equal(card.panel.props.title, "b");
  });

  it("builds a conditional component's passed children afresh each time it mounts", () => {
    const world = new World();
    const card = new Card();
    world.mount(card);
    card.s.open = true;
    card.s.label = "b";
    world.flush();
    const first = card.panel2!;
    assert.deepEqual(kids(body(first)), ["1", "inner.png", "inner-b.png", "2"]);
    card.s.open = false;
    world.flush();
    assert.equal(card.panel2, null);
    card.s.open = true;
    world.flush();
    assert.notEqual(card.panel2, first);
    assert.deepEqual(kids(body(card.panel2!)), ["1", "inner.png", "inner-b.png", "2"]);
  });

  it("throws a clear error when a component that does not render {children} is given some", () => {
    const leaf = new PanelClass({ title: "x" });
    const stray = new Sprite({ image: "z" });
    assert.doesNotThrow(() => leaf.attachPassedChild(stray, 0));
    assert.throws(() => new Entity().attachPassedChild(stray, 0), /does not render \{children\}/);
  });
});

describe("conditional passed children keep their place among static ones", () => {
  const SOURCE = `
import { type Child, Entity, Sprite, useMutable } from "@tsengine/runtime/jsx";
interface BoxProps { children: Child }
function Box({ children }: BoxProps) { return <Entity name="Box"><Entity name="Slot">{children}</Entity></Entity>; }
function Host() {
  const s = useMutable({ x: false, y: false });
  return (
    <Entity name="Host">
      <Box>
        {s.x && <Sprite image="A" />}
        <Sprite image="B" />
        {s.y && <Sprite image="C" />}
      </Box>
    </Entity>
  );
}`;
  interface HostInstance extends Entity {
    s: { x: boolean; y: boolean };
    readonly box: Entity;
  }
  let Host: new () => HostInstance;
  before(async () => {
    ({ Host } = await load<{ Host: typeof Host }>(compile(SOURCE, "Host.tsx")));
  });
  const images = (host: HostInstance): string[] => (host.box.children[0] as Entity).children.map((c) => (c as Sprite).image);

  it("puts a later one after the static sibling, and an earlier one before it, whichever turns on first", () => {
    for (const order of ["xy", "yx"]) {
      const world = new World();
      const host = new Host();
      world.mount(host);
      assert.deepEqual(images(host), ["B"]);
      for (const which of order) {
        if (which === "x") host.s.x = true;
        else host.s.y = true;
        world.flush();
      }
      assert.deepEqual(images(host), ["A", "B", "C"], `turned on in the order ${order}`);
    }
  });

  it("keeps the others in place as one turns off and on", () => {
    const world = new World();
    const host = new Host();
    world.mount(host);
    host.s.x = true;
    host.s.y = true;
    world.flush();
    host.s.x = false;
    world.flush();
    assert.deepEqual(images(host), ["B", "C"]);
    host.s.x = true;
    world.flush();
    assert.deepEqual(images(host), ["A", "B", "C"]);
  });
});

describe("a list as the children", () => {
  const LIST = `
import { type Child, Entity, Sprite, Collider, useMutable } from "@tsengine/runtime/jsx";
interface Row { id: string }
interface ColumnProps { children: Child }
function Column({ children }: ColumnProps) {
  return <Entity name="Column"><Sprite image="header" />{children}<Sprite image="footer" /></Entity>;
}
function Table() {
  const s = useMutable({ rows: [] as Row[] });
  return <Entity name="Table"><Column>{s.rows.map((r) => <Sprite key={r.id} image={r.id} />)}</Column></Entity>;
}
`;
  interface TableInstance extends Entity {
    s: { rows: { id: string }[] };
    readonly column: Entity;
  }
  let Table: new () => TableInstance;
  before(async () => {
    ({ Table } = await load<{ Table: typeof Table }>(compile(LIST, "Table.tsx")));
  });

  it("generates passed attaches", () => {
    const { code } = compile(LIST, "Table.tsx");
    assert.match(
      code,
      /\$parent\.queueAttachPassedChild\(\$item, \[0, \$n\]\);/,
      "an item's order among passed children is the list's position, then its index"
    );
    assert.match(code, /\$parent\.queueDetachPassedChild\(\$item\);/);
    assert.match(code, /\$parent\.queueReorderPassedChildren\(\$keys\.map\(.*\), \[0\]\);/);
    assert.deepEqual(typeCheck(compile(LIST, "Table.tsx")), []);
  });

  it("adds, reorders and removes items between the receiver's own children", () => {
    const world = new World();
    const t = new Table();
    world.mount(t);
    t.s.rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    world.flush();
    assert.deepEqual(kids(t.column), ["header", "a", "b", "c", "footer"]);
    t.s.rows = [{ id: "c" }, { id: "x" }, { id: "a" }];
    world.flush();
    assert.deepEqual(kids(t.column), ["header", "c", "x", "a", "footer"]);
  });
});

describe("passed children: diagnostics", () => {
  const IMPORT = `import { type Child, Entity, Sprite, Collider, useMutable } from "@tsengine/runtime/jsx";\n`;
  const box = (props: string, body: string) =>
    `${IMPORT}interface BoxProps { ${props} }\nfunction Box({ ${props.includes("children") ? "children" : ""} }: BoxProps) { return <Entity name="Box">${body}</Entity>; }`;
  const diag = (source: string) => compileErrors(source).map((d) => d.code);

  it("types children as Child", () => {
    assert.deepEqual(diag(box("children: string", "")), [DiagnosticCode.InvalidProps]);
    assert.deepEqual(diag(box("children: () => void", "")), [DiagnosticCode.InvalidProps]);
  });

  it("asks for a {children} slot when children is declared", () => {
    assert.deepEqual(diag(box("children: Child", "")), [DiagnosticCode.InvalidProps]);
  });

  it("allows one slot, in a container that is always there", () => {
    assert.deepEqual(diag(box("children: Child", "{children}{children}")), [DiagnosticCode.UnsupportedJsxChild]);
    assert.deepEqual(diag(box("children: Child", `<Entity name="a">{children}</Entity><Entity name="b">{children}</Entity>`)), [
      DiagnosticCode.UnsupportedJsxChild,
    ]);
    assert.deepEqual(diag(box("children: Child", `{true && <Entity name="a">{children}</Entity>}`)), [DiagnosticCode.UnsupportedJsxChild]);
    assert.deepEqual(diag(box("children: Child", `<Sprite image="a">{children}</Sprite>`)), [DiagnosticCode.UnsupportedJsxChild]);
  });

  it("does not read children as a value", () => {
    assert.deepEqual(diag(box("children: Child", `{children}<Sprite image={children} />`)), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(
      diag(box("children: Child", `{children}<Sprite image={String(children)} />`)).includes(DiagnosticCode.UnsupportedExpression),
      true
    );
  });

  it("rejects a default for children", () => {
    const source = `${IMPORT}interface BoxProps { children?: Child }\nfunction Box({ children = null }: BoxProps) { return <Entity name="Box">{children}</Entity>; }`;
    assert.ok(diag(source).includes(DiagnosticCode.InvalidProps));
  });

  it("takes nested children on a list item, and still rejects children as an attribute", () => {
    const source = `${box("children: Child", "{children}")}
interface Row { id: string }
function Table() {
  const s = useMutable({ rows: [] as Row[] });
  return <Entity name="Table">{s.rows.map((r) => <Box key={r.id}><Entity name="x"><Sprite image="x" /></Entity></Box>)}</Entity>;
}`;
    assert.doesNotThrow(() => compile(source));
    assert.ok(
      diag(`${box("children: Child", "{children}")}\nfunction A() { return <Entity name="A"><Box children={1} /></Entity>; }`).includes(
        DiagnosticCode.UnsupportedAttribute
      )
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Forwarding {children}
// ---------------------------------------------------------------------------------------------------------------------------

const FORWARD = `
interface BoxProps {
  title: string;
  children: Child;
}

function Box({ title, children }: BoxProps) {
  return (
    <Entity name={title}>
      <Entity name="body">{children}</Entity>
    </Entity>
  );
}

function Frame({ title, children }: BoxProps) {
  return (
    <Entity name="frame">
      <Box title={title}>{children}</Box>
    </Entity>
  );
}

function Outer({ title, children }: BoxProps) {
  return (
    <Entity name="outer">
      <Frame title={title}>{children}</Frame>
    </Entity>
  );
}

function Use() {
  const s = useMutable({ on: true, ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Outer title="t">
        <Entity name="static" />
        {s.on && <Entity name="maybe" />}
        <Entity name="last" />
      </Outer>
    </Entity>
  );
}

function UseList() {
  const s = useMutable({ ids: [1, 2] as number[] });
  return <Entity name="use"><Outer title="t">{s.ids.map((i) => <Entity key={i} name={"n" + i} />)}</Outer></Entity>;
}

function UseMixed() {
  const s = useMutable({ on: false, ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Outer title="t">
        <Entity name="head" />
        {s.ids.map((i) => <Entity key={i} name={"n" + i} />)}
        {s.on && <Entity name="maybe" />}
        <Entity name="foot" />
      </Outer>
    </Entity>
  );
}

function Card({ title, children }: BoxProps) {
  return (
    <Entity name="card">
      <Box title={title}>
        <Entity name="title" />
        {children}
        <Entity name="footer" />
      </Box>
    </Entity>
  );
}

function UseCard() {
  const s = useMutable({ ids: [1, 2] as number[] });
  return (
    <Entity name="use">
      <Card title="t">
        <Entity name="first" />
        {s.ids.map((i) => <Entity key={i} name={"n" + i} />)}
      </Card>
    </Entity>
  );
}
`;

interface UseInstance extends Entity {
  s: { [field: string]: unknown };
}
interface UseListInstance extends Entity {
  s: { [field: string]: unknown };
}
type UseMixedInstance = UseListInstance;

describe("forwarding {children}", () => {
  let Use: new () => UseInstance;
  let UseList: new () => UseListInstance;
  let UseMixed: new () => UseMixedInstance;
  let UseCard: new () => UseMixedInstance;
  before(async () => {
    ({ Use, UseList, UseMixed, UseCard } = await load<{
      Use: typeof Use;
      UseList: typeof UseList;
      UseMixed: typeof UseMixed;
      UseCard: typeof UseCard;
    }>(compile(FORWARD, "Forward.tsx")));
  });

  /** The names under the `body` entity of the innermost Box. */
  const bodyNames = (root: Entity): string[] => {
    let node: Entity = root;
    while (node.name !== "body") {
      const next = node.children.find((c) => (c as Entity).name !== undefined && (c as Entity).name !== "") as Entity | undefined;
      if (next === undefined) throw new Error("no body");
      node = next;
    }
    return node.children.map((c) => (c as Entity).name);
  };

  it("hands static, conditional and list children through two forwards into the innermost container", () => {
    const world = new World();
    const u = new Use();
    world.mount(u);
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "maybe", "last"]);
    u.s.on = false;
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "last"]);
    u.s.on = true;
    world.flush();
    assert.deepEqual(bodyNames(u), ["static", "maybe", "last"], "a child that comes back lands between its siblings");
  });

  it("forwards a list passed as the whole of the children, with its adds, removals and reorders", () => {
    const world = new World();
    const l = new UseList();
    world.mount(l);
    world.flush();
    assert.deepEqual(bodyNames(l), ["n1", "n2"]);
    l.s.ids = [3, 2, 1];
    world.flush();
    assert.deepEqual(bodyNames(l), ["n3", "n2", "n1"]);
    l.s.ids = [2];
    world.flush();
    assert.deepEqual(bodyNames(l), ["n2"]);
  });

  it("marks a forwarding component as one that accepts passed children", () => {
    const u = new UseList();
    assert.ok(u.children.length > 0);
    const outer = u.children[0]!;
    assert.equal(outer.acceptsPassedChildren, true);
  });

  const compiled = compile(FORWARD, "Forward.tsx");

  it("generates one line in the constructor: the forwarding target", () => {
    assert.match(compiled.code, /this\.passedChildrenForward = this\.box;/);
    assert.match(compiled.code, /this\.passedChildrenForward = this\.frame;/);
    assert.match(compiled.code, /this\.passedChildrenHost = this\.entity2;|this\.passedChildrenHost = this\.\w+;/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("passes a list beside other children, keeping its place through two forwards as it grows, shrinks and reorders", () => {
    const world = new World();
    const m = new UseMixed();
    world.mount(m);
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n1", "n2", "foot"]);
    m.s.ids = [3, 2, 1];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n3", "n2", "n1", "foot"]);
    m.s.on = true;
    m.s.ids = [2];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n2", "maybe", "foot"]);
    m.s.ids = [2, 4];
    world.flush();
    assert.deepEqual(bodyNames(m), ["head", "n2", "n4", "maybe", "foot"]);
  });

  it("forwards {children} between a component's own children: <Box><Title />{children}<Footer /></Box>", () => {
    const world = new World();
    const c = new UseCard();
    world.mount(c);
    world.flush();
    assert.deepEqual(bodyNames(c), ["title", "first", "n1", "n2", "footer"]);
    c.s.ids = [2, 1, 5];
    world.flush();
    assert.deepEqual(bodyNames(c), ["title", "first", "n2", "n1", "n5", "footer"]);
  });

  it("rejects a forwarded {children} inside a condition", () => {
    const head = `interface P { children: Child }\nfunction Box({ children }: P) { return <Entity name="b">{children}</Entity>; }\n`;
    const conditional = compileErrors(
      `${head}function Mod({ children }: P) { const s = useMutable({ on: true }); return <Entity name="m">{s.on && <Box>{children}</Box>}</Entity>; }`
    );
    assert.equal(conditional[0]?.code, DiagnosticCode.UnsupportedJsxChild);
    assert.match(conditional[0]!.message, /always present/);
  });
});
