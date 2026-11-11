/**
 * Writing components the way a React author does (found by the second game, Hearth): constants and helpers beside the
 * components, index reads, `Math.PI`, a component whose root is another component, an action or callback passed as a value,
 * and a component that renders nothing (`return null`, `cond ? <X/> : null`).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, Sprite, Text, World } from "@rge/runtime";
import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

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
    assert.deepEqual(texts.map((t) => [t.text, t.size, t.color]), [["BOLT 0", 8, "#8e9ac2"], ["FROST 1", 12, "#8e9ac2"]]);
  });

  it("rejects `let`, JSX and the game state outside a component", () => {
    const codes = (source: string) => compileErrors(source).map((d) => d.code);
    assert.deepEqual(codes(`let n = 1; function A() { return <Entity />; }`), [DiagnosticCode.UnsupportedSyntax]);
    assert.deepEqual(codes(`function icon() { return <Entity />; } function A() { return <Entity />; }`), [DiagnosticCode.UnsupportedSyntax]);
  });
});

describe("reads by index and Math's constants", () => {
  it("lowers `table[key]` and `Math.PI` in render, derived values and handlers", async () => {
    const compiled = compile(`
const FRAMES: Record<string, number> = { bolt: 0, frost: 2 };
interface IconProps { kind: string; angles: number[]; at: number; }
export function Icon({ kind, angles, at }: IconProps) {
  const [turns, setTurns] = useState(0);
  const angle = angles[at] ?? 0;
  useUpdate(() => { setTurns(turns + angles[at]! / (Math.PI * 2)); });
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
