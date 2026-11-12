/**
 * Two answers to "why is there no useEffect" (DESIGN.md): a cleanup returned from `useMount`, run when the component leaves,
 * with a handler able to hand an arrow to a function (`settings.subscribe(() => …)`); and `key` on any element, which starts
 * it over when the key changes.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const codes = (source: string) => compileErrors(source).map((d) => d.code);

/** A source of numbers a component listens to: what `settings.subscribe` is to a game. */
class Channel {
  listeners: ((n: number) => void)[] = [];
  log: string[] = [];
  listen = (fn: (n: number) => void): (() => void) => {
    this.listeners.push(fn);
    this.log.push("listen");
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
      this.log.push("stop");
    };
  };
  send(n: number): void {
    for (const l of this.listeners) l(n);
  }
}

const WATCHERS = `
interface WatchProps {
  listen: (fn: (n: number) => void) => () => void;
  onLog: (line: string) => void;
}

/** The expression form: what the call returns is the cleanup. */
function Watch({ listen, onLog }: WatchProps) {
  const [last, setLast] = useState(0);
  useMount(() => listen((n) => setLast(n)));
  useUnmount(() => onLog("unmount"));
  return <Entity name={\`watch:\${last}\`} />;
}

/** The block form: a returned arrow, a local function called in it, and an early \`return;\` with no cleanup. */
function Counted({ listen, onLog }: WatchProps) {
  const [total, setTotal] = useState(0);
  const skip = useRef(false);
  useMount(() => {
    if (skip.current) return;
    const stop = listen((n) => {
      setTotal((t) => t + n);
    });
    return () => {
      stop();
      onLog("cleanup");
    };
  });
  useMount(() => onLog("mounted"));
  return <Entity name={\`counted:\${total}\`} />;
}

interface HostProps {
  listen: (fn: (n: number) => void) => () => void;
  onLog: (line: string) => void;
}

function Host({ listen, onLog }: HostProps) {
  const [open, setOpen] = useState(true);
  return (
    <Entity name="Host">
      {open && <Watch listen={listen} onLog={onLog} />}
      {open && <Counted listen={listen} onLog={onLog} />}
    </Entity>
  );
}
`;

describe("useMount returning a cleanup", () => {
  it("keeps what a mount handler returns and inlines one that returns nothing", () => {
    const { code } = compile(WATCHERS, "Watchers.tsx");
    assert.match(code, /override onMount\(\): void \{\n\s+this\.keepCleanup\(this\.#onMount0\(\)\);\n\s+\}/, "Watch keeps its one cleanup");
    assert.match(code, /#onMount0\(\): \(\(\) => void\) \| void \{\n\s+return this\.props\.listen\(\(n\) => \{ this\.setLast\(n\); \}\);/);
    assert.match(code, /this\.keepCleanup\(this\.#onMount0\(\)\);\n\s+this\.keepCleanup\(this\.#onMount1\(\)\);/, "Counted keeps both: an expression body's call is returned, as in React");
    assert.match(code, /const stop = this\.props\.listen\(/);
    assert.match(code, /return \(\) => \{\n\s+stop\(\);/);
    const plain = compile(`function C() { const r = useRef(0); useMount(() => { r.current = 1; }); return <Entity name="C" />; }`).code;
    assert.match(plain, /override onMount\(\): void \{\n\s+this\.r = 1;/);
    assert.doesNotMatch(plain, /keepCleanup/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(WATCHERS, "Watchers.tsx")), []);
  });

  it("subscribes on mount, sets state from the callback, and runs the cleanup once when the component leaves, after useUnmount", async () => {
    const { Host } = await load<{ Host: new (props: object) => any }>(compile(WATCHERS, "Watchers.tsx"));
    const channel = new Channel();
    const host = new Host({ listen: channel.listen, onLog: (line: string) => channel.log.push(line) });
    const world = new World();
    world.mount(host);
    world.flush();
    assert.deepEqual(channel.log, ["listen", "listen", "mounted"]);
    channel.send(3);
    channel.send(4);
    world.flush();
    assert.deepEqual(host.children.map((c: { name: string }) => c.name), ["watch:4", "counted:7"]);
    host.setOpen(false);
    world.flush();
    assert.deepEqual(channel.log, ["listen", "listen", "mounted", "unmount", "stop", "stop", "cleanup"], "useUnmount first, then each cleanup, once");
    assert.equal(channel.listeners.length, 0);
    host.setOpen(true);
    world.flush();
    host.setOpen(false);
    world.flush();
    assert.equal(channel.listeners.length, 0, "a second stay keeps and runs its own cleanups");
    assert.equal(channel.log.filter((l) => l === "stop").length, 4);
  });

  it("keeps only a function, runs each once, and a component's cleanups before its children's (GameObject.keepCleanup)", () => {
    const log: string[] = [];
    class Node extends Entity {
      readonly label: string;
      constructor(label: string) {
        super({ name: label });
        this.label = label;
      }
      override onMount(): void {
        this.keepCleanup(5);
        this.keepCleanup(() => log.push(`${this.label} first`));
        this.keepCleanup(() => log.push(`${this.label} second`));
      }
    }
    const parent = new Node("parent");
    parent.addChild(new Node("child"));
    const holder = new Entity({ name: "holder" });
    const world = new World();
    world.mount(holder);
    holder.addChild(parent);
    holder.removeChild(parent);
    holder.addChild(parent);
    holder.removeChild(parent);
    assert.deepEqual(log, ["parent first", "parent second", "child first", "child second", "parent first", "parent second", "child first", "child second"]);
  });

  it("allows an arrow handed to a function only in a handler, and a returned value only from useMount", () => {
    const fn = `interface P { listen: (fn: () => void) => () => void }`;
    assert.deepEqual(codes(`${fn} function A({ listen }: P) { const [n, setN] = useState(0); useUpdate(() => { setN((x) => { listen(() => {}); return x; }); }); return <Entity name="A" />; }`), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(`${fn} function A({ listen }: P) { const s = listen(() => {}); return <Entity name="A" />; }`), [DiagnosticCode.UnsupportedExpression]);
    assert.deepEqual(codes(`${fn} function A({ listen }: P) { useUpdate(() => { return listen(() => {}); }); return <Entity name="A" />; }`), [DiagnosticCode.InvalidHandler]);
    assert.deepEqual(codes(`${fn} function A({ listen }: P) { useUnmount(() => { return () => {}; }); return <Entity name="A" />; }`), [DiagnosticCode.InvalidHandler]);
    assert.doesNotThrow(() => compile(`${fn} function A({ listen }: P) { useUpdate(() => { listen(() => {}); }); return <Entity name="A" />; }`), "a handler may subscribe (the cleanup is the caller's)");
  });
});

const BOOK = `
interface PageProps {
  label: string;
  onLog: (line: string) => void;
}

function Page({ label, onLog }: PageProps) {
  const [turns, setTurns] = useState(0);
  useMount(() => onLog(\`mount \${label}\`));
  useUnmount(() => onLog(\`unmount \${label}\`));
  useUpdate(() => setTurns((t) => t + 1));
  return <Entity name={\`\${label}:\${turns}\`} />;
}

interface BookProps {
  onLog: (line: string) => void;
}

function Book({ onLog }: BookProps) {
  const [page, setPage] = useState("a");
  const [title, setTitle] = useState("T");
  const [open, setOpen] = useState(true);
  const [left, setLeft] = useState(true);
  return (
    <Entity name="Book">
      <Page key={page} label={\`\${title}\${page}\`} onLog={onLog} />
      {open && <Page key={page} label={\`open\${page}\`} onLog={onLog} />}
      {left ? <Sprite key={page} image="left.png" /> : <Sprite key={page} image="right.png" />}
    </Entity>
  );
}
`;

describe("key on any element", () => {
  it("compiles to a list of one, the key itself", () => {
    const { code } = compile(BOOK, "Book.tsx");
    assert.match(code, /\$page\d*List\(\) \{ return \[this\.page\]; \}/);
    assert.match(code, /\.filter\(\(\$keyed\) => this\.open\)/, "a condition filters the list of one");
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(BOOK, "Book.tsx")), []);
  });

  it("keeps the instance while the key stays, and starts it over (unmount, then a fresh mount) when the key changes", async () => {
    const { Book } = await load<{ Book: new (props: object) => any }>(compile(BOOK, "Book.tsx"));
    const log: string[] = [];
    const book = new Book({ onLog: (line: string) => log.push(line) });
    const world = new World();
    world.mount(book);
    world.flush();
    const names = (): string[] => book.children.map((c: { name: string }) => c.name);
    world.tick(0.016);
    world.tick(0.016);
    book.setTitle("U");
    world.flush();
    assert.deepEqual(names().slice(0, 2), ["Ua:2", "opena:2"], "same key: the props change, the state stays");
    assert.deepEqual(log, ["mount Ta", "mount opena"]);
    book.setPage("b");
    world.flush();
    assert.deepEqual(names().slice(0, 2), ["Ub:0", "openb:0"], "new key: fresh state");
    // As with list items, the new instance is added before the old one is removed.
    assert.deepEqual(log.slice(2), ["mount Ub", "unmount Ua", "mount openb", "unmount opena"]);
    book.setOpen(false);
    world.flush();
    assert.deepEqual(names().slice(0, 1), ["Ub:0"]);
    assert.equal(log.at(-1), "unmount openb");
  });

  it("switches the branches of a keyed condition, and keeps the drawing order", async () => {
    const { Book } = await load<{ Book: new (props: object) => any }>(compile(BOOK, "Book.tsx"));
    const book = new Book({ onLog: () => {} });
    const world = new World();
    world.mount(book);
    world.flush();
    const images = (): string[] => book.children.filter((c: { image?: string }) => c.image !== undefined).map((c: { image: string }) => c.image);
    assert.deepEqual(images(), ["left.png"]);
    book.setLeft(false);
    world.flush();
    assert.deepEqual(images(), ["right.png"]);
    book.setOpen(false);
    book.setOpen(true);
    book.setPage("c");
    world.flush();
    assert.deepEqual(book.children.map((c: { name: string; image?: string }) => c.image ?? c.name.split(":")[0]), ["Tc", "openc", "right.png"]);
  });

  it("refuses key on a component's root, a keyed element beside other passed children, and one inside a list item", () => {
    const root = compileErrors(`function A() { return <Entity name="A" key="x" />; }`);
    assert.deepEqual(root.map((d) => d.code), [DiagnosticCode.UnsupportedAttribute]);
    assert.match(root[0]!.message, /where the component is used, not on its root/);
    const passed = compileErrors(`import { type Child, Entity, Sprite, useState } from "@rge/runtime/jsx";
interface PanelProps { children: Child }
function Panel({ children }: PanelProps) { return <Entity name="P">{children}</Entity>; }
function A() { const [k, setK] = useState(1); return <Panel><Sprite key={k} image="a.png" /><Sprite image="b.png" /></Panel>; }`);
    assert.deepEqual(passed.map((d) => d.code), [DiagnosticCode.InvalidList]);
    assert.match(passed[0]!.message, /A keyed element passed to <Panel> must be its only child/);
    const nested = compileErrors(`interface Item { id: string }
function A() { const [items, setItems] = useState<Item[]>([]); const [k, setK] = useState(1);
  return <Entity name="A">{items.map((i) => <Entity key={i.id}><Sprite key={k} image="a.png" /></Entity>)}</Entity>; }`);
    assert.deepEqual(nested.map((d) => d.code), [DiagnosticCode.InvalidList]);
    assert.match(nested[0]!.message, /A list item cannot hold a keyed element among its children yet/);
  });
});
