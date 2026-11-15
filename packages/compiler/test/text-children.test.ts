import assert from "node:assert/strict";
/**
 * Text wrappers (REACT_FEEL_PLAN.md, B3): a component whose props say `children: TextChild | readonly TextChild[]` takes words
 * between its tags, as `<Text>` does, and passes them on with `<Text>{children}</Text>`.
 */
import { after, describe, it } from "node:test";

import { Entity, Text, World } from "@rge/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const LABEL = `import { Entity, Text, useInput, useMutable, type TextChild } from "@rge/runtime/jsx";
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
