import assert from "node:assert/strict";
/**
 * Text children. Text wrappers (DESIGN.md, "Text", text wrappers): a component whose props say `children: TextChild | readonly
 * TextChild[]` takes words between its tags, as `<Text>` does, and passes them on with `<Text>{children}</Text>`. Further down,
 * `<Text>` itself: its content is the text between its tags or its `text` prop.
 */
import { after, describe, it, before } from "node:test";

import { Entity, Text, World, runtimeManifest } from "@tsengine/runtime";

import { DiagnosticCode, type ExprIR, type PropIR } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck, elementOf, getCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const LABEL = `import { Entity, Text, useInput, useMutable, type TextChild } from "@tsengine/runtime/jsx";
interface LabelProps {
  color?: string;
  children: TextChild | readonly TextChild[];
}
export function Label({ color = "#fff1d6", children }: LabelProps) {
  return <Text size={10} color={color}>{children}</Text>;
}

interface ButtonProps {
  children: TextChild | readonly TextChild[];
}
export function Button({ children }: ButtonProps) {
  return (
    <Entity>
      <Label color="gold">{children}</Label>
    </Entity>
  );
}

export function Purse() {
  const s = useMutable({ coins: 3 });
  useInput((input) => {
    if (input.pressed("Space")) s.coins += 1;
  });
  return (
    <Entity>
      <Label>Coins: {s.coins}</Label>
      <Label color="red">GAME OVER</Label>
      <Button>Buy for {s.coins * 2}</Button>
    </Entity>
  );
}`;

describe("text children on components", () => {
  it("passes literal text and {expressions} as one string, and forwards it through a second component", async () => {
    const compiled = compile(LABEL);
    assert.deepEqual(typeCheck(compiled), []);
    const { Purse } = await load<{ Purse: new () => Entity }>(compiled);
    const world = new World();
    const hud = new Purse();
    world.mount(hud);
    world.flush();
    const texts = (): string[] => {
      const out: string[] = [];
      const visit = (o: Entity | Text): void => {
        if (o instanceof Text) out.push(`${o.text}|${o.color}|${o.size}`);
        for (const c of o.children) visit(c as Entity);
      };
      visit(hud);
      return out;
    };
    assert.deepEqual(texts(), ["Coins: 3|#fff1d6|10", "GAME OVER|red|10", "Buy for 6|gold|10"]);
    world.tick(1 / 60, { pressed: (k: string) => k === "Space", down: () => false, released: () => false } as never);
    world.flush();
    assert.deepEqual(texts(), ["Coins: 4|#fff1d6|10", "GAME OVER|red|10", "Buy for 8|gold|10"]);
  });

  it("refuses text and elements together, naming both types", () => {
    const errors = compileErrors(`${LABEL}
export function Mixed() {
  return <Button>Hi <Entity /></Button>;
}`);
    const mixed = errors.find((d) => d.code === DiagnosticCode.UnsupportedJsxChild);
    assert.ok(mixed, JSON.stringify(errors));
    assert.match(mixed.message, /children: TextChild \| readonly TextChild\[\]/);
    assert.match(mixed.message, /children: Child/);
  });

  it("says which two types children may have", () => {
    const errors = compileErrors(`
interface P { children: string[][] }
export function Bad({ children }: P) { return <Text>{children}</Text>; }`);
    assert.ok(
      errors.some((d) => /`Child` \(elements[\s\S]*TextChild \| readonly TextChild\[\]/.test(d.message)),
      JSON.stringify(errors)
    );
  });
});

// `<Text>` itself: a leaf built-in for HUDs and labels. Its content is its JSX text (`<Text>Score: {score}</Text>`) or its `text`
// prop, which are the same thing: one string prop, updated in place when the state it reads changes.

const HUD = `
interface HudProps {
  label: string;
}

function Scoreboard({ label }: HudProps) {
  const s = useMutable({ score: 0 });
  return (
    <Entity name="Scoreboard">
      <Text size={12}>
        Score: {s.score}
      </Text>
      <Text color={s.score > 5 ? "gold" : "white"} x={4}>{label + ":"}</Text>
      <Text>{\`Total \${s.score * 2}\`}</Text>
      <Text>Fixed</Text>
    </Entity>
  );
}

interface BadgeProps {
  points: number;
}

const Badge = ({ points }: BadgeProps) => <Text color="gold">+{points}</Text>;
`;

interface HudInstance extends Entity {
  readonly text: Text;
  readonly text2: Text;
  readonly text3: Text;
  readonly text4: Text;
  s: { [field: string]: unknown };
}
interface BadgeInstance extends Text {
  updateProps(next: { points: number }): void;
}

let Scoreboard: new (props: { label: string }) => HudInstance;
let Badge: new (props: { points: number }) => BadgeInstance;

before(async () => {
  ({ Scoreboard, Badge } = await load<{ Scoreboard: typeof Scoreboard; Badge: typeof Badge }>(compile(HUD, "Scoreboard.tsx")));
});

const prop = (props: readonly PropIR[], name: string): PropIR => {
  const found = props.find((p) => p.name === name);
  assert.ok(found, name);
  return found;
};
const valueOf = (p: PropIR): ExprIR => {
  assert.ok(p.kind === "StaticProp" || p.kind === "DynamicProp");
  return p.value;
};

describe("<Text>: IR", () => {
  const ir = compile(HUD, "Scoreboard.tsx").ir;
  const hud = ir.components.find((c) => c.name === "Scoreboard")!;
  const texts = hud.root.children.map((c) => elementOf(c));

  it("makes text between the tags a template over the state it reads, as a dynamic prop", () => {
    const text = prop(texts[0]!.props, "text");
    assert.equal(text.kind, "DynamicProp");
    assert.deepEqual(valueOf(text), {
      kind: "TemplateLiteral",
      quasis: ["Score: ", ""],
      expressions: [
        { kind: "Call", callee: { kind: "Function", name: "textOf" }, args: [{ kind: "StateRead", state: "Scoreboard.s.score" }] },
      ],
    });
    assert.deepEqual(text.kind === "DynamicProp" && text.dependencies, [{ kind: "State", state: "Scoreboard.s.score" }]);
    assert.equal(prop(texts[0]!.props, "size").kind, "StaticProp");
  });

  it("takes the text attribute as any other prop", () => {
    assert.equal(prop(texts[1]!.props, "text").kind, "DynamicProp");
    assert.deepEqual((prop(texts[1]!.props, "text") as { dependencies: unknown }).dependencies, [{ kind: "Prop", name: "label" }]);
    assert.equal(prop(texts[1]!.props, "color").kind, "DynamicProp");
  });

  it("uses a lone template expression as it is, not a template around a template", () => {
    const value = valueOf(prop(texts[2]!.props, "text"));
    assert.equal(value.kind, "TemplateLiteral");
    assert.deepEqual(value.kind === "TemplateLiteral" && value.quasis, ["Total ", ""]);
    assert.deepEqual(value.kind === "TemplateLiteral" && value.expressions.map((e) => e.kind), ["Binary"]);
  });

  it("makes fixed text a static prop", () => {
    assert.deepEqual(prop(texts[3]!.props, "text"), { kind: "StaticProp", name: "text", value: { kind: "StringLiteral", value: "Fixed" } });
    assert.deepEqual(texts[3]!.children, [], "the text is not a child");
  });

  it("works at the root of a component", () => {
    const badge = ir.components.find((c) => c.name === "Badge")!;
    assert.equal(badge.root.component.name, "Text");
    assert.deepEqual(valueOf(prop(badge.root.props, "text")), {
      kind: "TemplateLiteral",
      quasis: ["+", ""],
      expressions: [{ kind: "Call", callee: { kind: "Function", name: "textOf" }, args: [{ kind: "PropRead", name: "points" }] }],
    });
  });
});

describe("<Text>: whitespace and literals follow JSX", () => {
  /** The text prop of `<Text>…</Text>` with the given content, as a string (` ${n}` marks the one expression). */
  function content(body: string): string {
    const c = compile(`function C() { const s = useMutable({ n: 0 }); const n = s.n; return <Text>${body}</Text>; }`).ir.components[0]!;
    const value = valueOf(prop(c.root.props, "text"));
    if (value.kind === "StringLiteral") return value.value;
    assert.equal(value.kind, "TemplateLiteral");
    return value.kind === "TemplateLiteral" ? value.quasis.join("${n}") : "";
  }

  it("trims lines, drops blank ones, and joins with one space", () => {
    assert.equal(content("\n        Score:\n        high\n      "), "Score: high");
  });

  it("keeps the space between two expressions or around one on a line", () => {
    assert.equal(content("a {n} b"), "a ${n} b");
    assert.equal(content("{n} {n}"), "${n} ${n}");
  });

  it("drops whitespace that contains a line break, so no space appears across lines (as in React)", () => {
    assert.equal(content("\n  Score: {n}\n"), "Score: ${n}");
    assert.equal(content("\n  {n}\n  points\n"), "${n}points", 'write {n}{" "}points, or keep them on one line, for a space');
    assert.equal(content('\n  {n}{" "}\n  points\n'), "${n} points");
  });

  it("folds string and number literals into the text, and ignores comments", () => {
    assert.equal(content(`Hi {"there"} {3}{/* ignored */}`), "Hi there 3");
  });
});

describe("<Text>: generated code", () => {
  const { code } = compile(HUD, "Scoreboard.tsx");

  it("builds the element with its text and updates the field in place", () => {
    assert.match(code, /readonly text: Text = new Text\(\{ size: 12, text: `Score: \$\{textOf\(this\.\$s_score\)\}` \}\);/);
    assert.match(code, /const (\$\d+)(?:: [^=]+)? = `Score: \$\{textOf\(this\.\$s_score\)\}`;[^]*?this\.text\.text = \1;/);
    assert.match(
      code,
      /const (\$\d+)(?:: [^=]+)? = `\$\{textOf\(this\.props\.label \+ ":"\)\}`;[^]*?this\.text2\.text = \1;/,
      "an expression child is a dynamic text, as a template literal (always a string), null and booleans drawn as nothing"
    );
    assert.match(code, /const (\$\d+)(?:: [^=]+)? = \(this\.\$s_score > 5\) \? "gold" : "white";[^]*?this\.text2\.color = \1;/);
    assert.match(code, /readonly text4: Text = new Text\(\{ text: "Fixed" \}\);/);
  });

  it("makes a Text-rooted component a Text, with the content as its required prop", () => {
    assert.match(code, /export class Badge extends Text<BadgeProps> \{/);
    assert.match(code, /super\(\{ color: "gold", text: undefined as never \}, props\);/);
    assert.match(code, /const (\$\d+)(?:: [^=]+)? = `\+\$\{textOf\(this\.props\.points\)\}`;[^]*?this\.text = \1;/);
  });

  it("type-checks the generated module", () => {
    assert.deepEqual(typeCheck(compile(HUD, "Scoreboard.tsx")), []);
  });
});

describe("<Text>: authored source type-checks", () => {
  const check = (body: string) =>
    getCompiler().typeCheckSources([
      {
        fileName: `${process.cwd()}/.test-output/M10${Math.random()}.tsx`,
        text: `import { Entity, Sprite, Text } from "@tsengine/runtime/jsx";\nfunction C({ n }: { n: number }) { return <Entity name="C">${body}</Entity>; }`,
      },
    ]);

  it("accepts text between the tags, in expressions of strings or numbers, and the text prop", () => {
    assert.deepEqual(check(`<Text>Score</Text>`), []);
    assert.deepEqual(check(`<Text>Score: {n}</Text>`), []);
    assert.deepEqual(check(`<Text size={12} color="red" x={1}>{\`n = \${n}\`}</Text>`), []);
  });

  it("rejects what a Text cannot hold", () => {
    assert.ok(check(`<Text />`).length > 0, "no content");
    assert.ok(check(`<Text text="a">b</Text>`).length > 0, "both forms");
    assert.ok(check(`<Text><Sprite image="x" /></Text>`).length > 0, "an element");
    assert.ok(check(`<Text size="big">x</Text>`).length > 0, "a wrong prop type");
    assert.ok(check(`<Text>{n}</Text>`).length === 0, "a number is text too");
    assert.ok(check(`<Text>{n > 1 && "many"}{undefined}{null}</Text>`).length === 0, "null, undefined and booleans draw nothing");
    assert.ok(check(`<Text>{{ n }}</Text>`).length > 0, "an object is not text");
  });
});

describe("<Text>: runtime behaviour", () => {
  it("updates the text in place when its state changes, keeping the instance, in one render", () => {
    const world = new World();
    const hud = new Scoreboard({ label: "HP" });
    world.mount(hud);
    assert.deepEqual([hud.text.text, hud.text2.text, hud.text3.text, hud.text4.text], ["Score: 0", "HP:", "Total 0", "Fixed"]);
    const [first, second] = [hud.text, hud.text2];
    hud.s.score = 7;
    assert.equal(world.flush(), 1, "one render for the component, none for the texts");
    assert.deepEqual([hud.text.text, hud.text2.color, hud.text3.text], ["Score: 7", "gold", "Total 14"]);
    assert.equal(hud.text, first);
    assert.equal(hud.text2, second);
    assert.equal(hud.text4.text, "Fixed");
  });

  it("applies size, color and placement", () => {
    const hud = new Scoreboard({ label: "HP" });
    assert.deepEqual([hud.text.size, hud.text.color], [12, "white"]);
    assert.deepEqual([hud.text3.size, hud.text3.color], [16, "white"], "defaults");
    assert.equal(hud.text2.transform.x, 4);
  });

  it("is a Text when it is a component's root, and follows its props", () => {
    const world = new World();
    const badge = new Badge({ points: 4 });
    world.mount(badge);
    assert.ok(badge instanceof Text);
    assert.deepEqual([badge.text, badge.color], ["+4", "gold"]);
    badge.updateProps({ points: 5 });
    world.flush();
    assert.equal(badge.text, "+5");
  });
});

describe("<Text>: diagnostics", () => {
  const diag = (body: string) => compileErrors(`function C() { return <Entity name="C">${body}</Entity>; }`).map((d) => d.code);

  it("rejects elements inside a Text", () => {
    assert.deepEqual(diag(`<Text><Sprite image="x" /></Text>`), [DiagnosticCode.UnsupportedJsxChild]);
    assert.deepEqual(diag(`<Text>a<Text>b</Text></Text>`), [DiagnosticCode.UnsupportedJsxChild]);
  });

  it("rejects a text attribute (the words are children), both forms, and no content", () => {
    assert.ok(diag(`<Text text="a" />`).includes(DiagnosticCode.UnsupportedAttribute), "the words are children, not an attribute");
    assert.deepEqual(diag(`<Text text="a">b</Text>`), [DiagnosticCode.UnsupportedAttribute]);
    assert.deepEqual(diag(`<Text />`), [DiagnosticCode.UnsupportedJsxChild]);
    assert.deepEqual(diag(`<Text>{/* nothing */}</Text>`), [DiagnosticCode.UnsupportedJsxChild]);
  });

  it("rejects HTML entities, which JSX would decode", () => {
    const errors = compileErrors(`function C() { return <Text>Tom &amp; Jerry</Text>; }`);
    assert.deepEqual(
      errors.map((d) => d.code),
      [DiagnosticCode.UnsupportedJsxChild]
    );
    assert.match(errors[0]!.message, /HTML entities/);
  });

  it("is placed with transform, and cannot have elements added to it from a parent's children", () => {
    assert.ok(runtimeManifest.transformIntrinsics.includes("Text"));
    assert.ok(!runtimeManifest.containerIntrinsics.includes("Text"));
  });
});
