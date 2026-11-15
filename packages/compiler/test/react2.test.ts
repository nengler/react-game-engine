import assert from "node:assert/strict";
/**
 * Writing components the way a React author does (found by the second game, Hearth): constants and helpers beside the
 * components, index reads, `Math.PI`, a component whose root is another component, an action or callback passed as a value,
 * and a component that renders nothing (`return null`, `cond ? <X/> : null`).
 */
import { after, describe, it } from "node:test";

import { createInputState, Entity, Flex, Pointer, Shape, Sprite, Text, World } from "@rge/runtime";

import { checkAssets, DiagnosticCode } from "../src/index.ts";
import {
  cleanOutput,
  closeCompiler,
  compile,
  compileErrors,
  compileProject,
  load,
  loadProject,
  typeCheck,
  typeCheckProject,
} from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

describe("constants and helpers at the top of a component file", () => {
  it("are copied into the generated module and read like plain imports, in JSX, lists and handlers", async () => {
    const compiled = compile(`
const COLORS = { text: "#fff1d6", dim: "#8e9ac2" } as const;
const SIZES = [8, 12, 16];
const KINDS = ["bolt", "frost"] as const;
function labelOf(kind: string, n: number): string {
  return \`\${kind.toUpperCase()} \${n}\`;
}

interface LabelsProps { dim: boolean; }
export function Labels({ dim }: LabelsProps) {
  return (
    <Entity name="Labels">
      {KINDS.map((k, i) => <Text key={k} size={SIZES[i]!} color={dim ? COLORS.dim : COLORS.text}>{labelOf(k, i)}</Text>)}
    </Entity>
  );
}`);
    assert.match(compiled.code, /const COLORS = \{ text: "#fff1d6", dim: "#8e9ac2" \} as const;/);
    assert.match(compiled.code, /function labelOf\(kind: string, n: number\): string \{/);
    assert.deepEqual(typeCheck(compiled), []);
    const { Labels } = await load<{ Labels: new (p: { dim: boolean }) => Entity }>(compiled);
    const world = new World();
    const labels = new Labels({ dim: true });
    world.mount(labels);
    world.flush();
    const texts = labels.children.map((c) => c as Text);
    assert.deepEqual(
      texts.map((t) => [t.text, t.size, t.color]),
      [
        ["BOLT 0", 8, "#8e9ac2"],
        ["FROST 1", 12, "#8e9ac2"],
      ]
    );
  });

  it("rejects `let`, JSX and the game state outside a component", () => {
    const codes = (source: string) => compileErrors(source).map((d) => d.code);
    assert.deepEqual(codes(`let n = 1; function A() { return <Entity />; }`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`function icon() { return <Entity />; } function A() { return <Entity />; }`), [
      DiagnosticCode.UnsupportedSyntax,
    ]);
  });
});

describe("reads by index and Math's constants", () => {
  it("lowers `table[key]` and `Math.PI` in render, derived values and handlers", async () => {
    const compiled = compile(`
const FRAMES: Record<string, number> = { bolt: 0, frost: 2 };
interface IconProps { kind: string; angles: number[]; at: number; }
export function Icon({ kind, angles, at }: IconProps) {
  const s = useMutable({ turns: 0 });
  const angle = angles[at] ?? 0;
  useUpdate(() => { s.turns += angles[at]! / (Math.PI * 2); });
  return <Sprite image="icons.png" frame={FRAMES[kind]!} transform={{ rotation: angle + Math.PI }} />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /FRAMES\[this\.props\.kind\]/);
    assert.match(compiled.code, /Math\.PI/);
    const { Icon } = await load<{ Icon: new (p: { kind: string; angles: number[]; at: number }) => Sprite }>(compiled);
    const world = new World();
    const icon = new Icon({ kind: "frost", angles: [0, 1], at: 1 });
    world.mount(icon);
    world.flush();
    assert.equal(icon.frame, 2);
    assert.equal(icon.transform.rotation, 1 + Math.PI);
  });
});

describe("a component whose root is another component, a condition or null", () => {
  it("is a container layout sees through, holding that component, which gets {children} and props", async () => {
    const project = compileProject({
      "Panel.tsx": `
interface PanelProps { title: string; children: Child; }
export function Panel({ title, children }: PanelProps) {
  return <Flex direction="column" width="grow"><Text size={8}>{title}</Text>{children}</Flex>;
}`,
      "Menu.tsx": `
import { Panel } from "./Panel.tsx";
interface MenuProps { title: string; }
export function Menu({ title }: MenuProps) {
  return <Panel title={title}><Text size={8}>item</Text></Panel>;
}`,
    });
    assert.deepEqual(typeCheckProject(project), []);
    assert.match(project["Menu.tsx"]!.code, /override readonly layoutContents = true;/);
    const { Menu } = await loadProject<{ Menu: new (p: { title: string }) => Entity & { updateProps(p: { title: string }): void } }>(
      project,
      "Menu.tsx"
    );
    const world = new World();
    const menu = new Menu({ title: "BUILD" });
    world.mount(menu);
    world.flush();
    assert.equal(menu.layoutContents, true);
    const panel = menu.children[0] as Flex;
    assert.ok(panel instanceof Flex);
    assert.deepEqual(
      panel.children.map((c) => (c as Text).text),
      ["BUILD", "item"]
    );
    menu.updateProps({ title: "SELL" });
    world.flush();
    assert.equal((panel.children[0] as Text).text, "SELL");
  });

  it("renders a condition of elements, or nothing", async () => {
    const compiled = compile(
      `
interface FlashProps { on: boolean; big: boolean; }
export function Flash({ on, big }: FlashProps) {
  return on ? <Text size={big ? 16 : 8}>on</Text> : null;
}
export function Spark({ on }: FlashProps) {
  return on && <Text size={8}>spark</Text>;
}
export function Either({ on }: FlashProps) {
  return on ? <Text size={8}>yes</Text> : <Shape kind="rect" width={2} height={2} />;
}
export function Nothing() {
  return null;
}`,
      "Flash.tsx"
    );
    assert.deepEqual(typeCheck(compiled), []);
    type C = new (p?: { on: boolean; big: boolean }) => Entity & { updateProps(p: { on: boolean; big: boolean }): void };
    const { Flash, Spark, Either, Nothing } = await load<{ Flash: C; Spark: C; Either: C; Nothing: C }>(compiled);
    const world = new World();
    const flash = new Flash({ on: false, big: true });
    const spark = new Spark({ on: true, big: false });
    const either = new Either({ on: true, big: false });
    const nothing = new Nothing();
    for (const c of [flash, spark, either, nothing]) world.mount(c);
    world.flush();
    assert.equal(flash.children.length, 0);
    assert.deepEqual(
      spark.children.map((c) => (c as Text).text),
      ["spark"]
    );
    assert.ok(either.children[0] instanceof Text);
    assert.equal(nothing.children.length, 0);
    flash.updateProps({ on: true, big: true });
    either.updateProps({ on: false, big: false });
    world.flush();
    assert.equal((flash.children[0] as Text).size, 16);
    assert.ok(either.children[0] instanceof Shape);
    assert.equal(either.children.length, 1);
  });
});

describe("a callback prop forwarded to a built-in", () => {
  it("is written as the arrow that calls it: `<Flex onPress={onPress}>`, `props.onPress` too", async () => {
    const compiled = compile(`
interface ButtonProps { onPress: () => void; label: string; }
export function Button({ onPress, label }: ButtonProps) {
  return <Flex onPress={onPress}><Text size={8}>{label}</Text></Flex>;
}
export function Plain(props: ButtonProps) {
  return <Pointer width={4} height={4} onPress={props.onPress} />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Button, Plain } = await load<{
      Button: new (p: { onPress: () => void; label: string }) => Flex;
      Plain: new (p: { onPress: () => void; label: string }) => Entity & { onPress?: () => void };
    }>(compiled);
    let presses = 0;
    const world = new World();
    const button = new Button({ onPress: () => presses++, label: "go" });
    const plain = new Plain({ onPress: () => (presses += 10), label: "x" });
    world.mount(button);
    world.mount(plain);
    world.flush();
    button.onPress!();
    plain.onPress!();
    assert.equal(presses, 11);
  });
});

describe("the three smaller gaps: useTime, hover and <Game font>", () => {
  it("useTime gives the seconds since mount, growing each update", async () => {
    const compiled = compile(`
export function Blink() {
  const time = useTime();
  return <Text size={8} color={time % 1 < 0.5 ? "white" : "black"}>{\`\${Math.floor(time)}\`}</Text>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Blink } = await load<{ Blink: new () => Text }>(compiled);
    const world = new World();
    const blink = new Blink();
    world.mount(blink);
    world.flush();
    assert.equal(blink.color, "white");
    for (let i = 0; i < 4; i++) world.tick(0.2);
    world.flush();
    assert.equal(blink.color, "black");
    for (let i = 0; i < 2; i++) world.tick(0.2);
    world.flush();
    assert.equal(blink.text, "1");
  });

  it("hover callbacks are built-in callback props of <Pointer> and <Flex>, and may be passed whole", async () => {
    const compiled = compile(`
interface TipProps { onPointerEnter: () => void; }
export function Tip({ onPointerEnter }: TipProps) {
  const s = useMutable({ over: false });
  return (
    <Entity>
      <Pointer width={4} height={4} onPointerEnter={() => { s.over = true; }} onPointerLeave={() => { s.over = false; }} />
      <Flex onPointerEnter={onPointerEnter} />
      {s.over && <Text size={8}>tip</Text>}
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    let entered = 0;
    const { Tip } = await load<{ Tip: new (p: { onPointerEnter: () => void }) => Entity }>(compiled);
    const world = new World();
    const tip = new Tip({ onPointerEnter: () => entered++ });
    world.mount(tip);
    world.flush();
    const [pointer, flex] = tip.children as [Pointer, Flex];
    world.reportHover(pointer);
    world.flush();
    assert.equal(tip.children.length, 3, "the tip shows while the mouse is over the pointer");
    world.reportHover(flex);
    world.flush();
    assert.equal(tip.children.length, 2);
    assert.equal(entered, 1);
  });

  it("<Game font> is a literal setting, checked against the assets folder", () => {
    const compiled = compile(`export function Main() { return <Game font="font.png"><Text size={8}>hi</Text></Game>; }`);
    assert.deepEqual(typeCheck(compiled), []);
    const found = checkAssets([compiled.ir], { folder: "assets", exists: (name) => name === "fonts.png", list: () => ["fonts.png"] });
    assert.deepEqual(
      found.map((d) => d.code),
      [DiagnosticCode.MissingAsset]
    );
    assert.match(found[0]!.message, /font 'font.png'.*did you mean 'fonts.png'/);
  });
});

describe("keys that press things, from TSX", () => {
  it("pressKey, focusable, autoFocus, onFocus / onBlur and a Pointer's origin compile and run", async () => {
    const compiled = compile(`
interface PadsProps { onWave: () => void; }
export function Pads({ onWave }: PadsProps) {
  const s = useMutable({ focused: -1 });
  return (
    <Entity>
      <Flex pressKey="Space" onPress={onWave} />
      <Pointer width={10} height={10} originX={5} originY={5} focusable autoFocus onFocus={() => { s.focused = 0; }} />
      <Pointer width={10} height={10} originX={5} originY={5} transform={{ x: 30 }} focusable onFocus={() => { s.focused = 1; }} onBlur={() => { s.focused = -1; }} />
      <Text size={8}>{\`\${s.focused}\`}</Text>
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    let waves = 0;
    const { Pads } = await load<{ Pads: new (p: { onWave: () => void }) => Entity }>(compiled);
    const world = new World();
    const pads = new Pads({ onWave: () => waves++ });
    world.mount(pads);
    world.flush();
    const text = pads.children[3] as Text;
    world.tick(1 / 60, createInputState({ pressed: ["Space"] }));
    assert.equal(text.text, "0");
    world.tick(1 / 60, createInputState({ pressed: ["ArrowRight"] }));
    assert.equal(text.text, "1");
    assert.equal(waves, 1);
    assert.equal((pads.children[1] as Pointer).contains(-4, -4), true);
  });
});

describe("types imported from a .ts file", () => {
  it("are imported by the generated module as types, renamed or not, when it uses them", async () => {
    const project = compileProject({
      "Card.tsx": `
import type { Tower as TowerData } from "./rules.ts";
import { type Kind } from "./rules.ts";
interface CardProps { tower: TowerData | null; kind: Kind; }
export function Card({ tower, kind }: CardProps) {
  return <Entity>{tower !== null && <Text size={8}>{\`\${kind} \${tower.level}\`}</Text>}</Entity>;
}`,
    });
    const code = project["Card.tsx"]!.code;
    assert.match(code, /import type \{ Tower as TowerData, Kind \} from "\.\.\/rules\.ts";/);
  });
});
