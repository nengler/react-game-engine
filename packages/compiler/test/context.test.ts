import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/** Context (REACT_FEEL_PLAN.md, C3): `createContext`, `<X.Provider value>` and `useContext`, compiled. */
import { after, describe, it } from "node:test";

import { Entity, Text, World } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const THEME = `import { createContext } from "@tsengine/runtime";
export const Theme = createContext({ accent: "gold", size: 10 });
`;

const SOURCE = `import { Entity, Text, useContext, useMutable, useUpdate } from "@tsengine/runtime/jsx";
import { Theme } from "./theme.ts";

function Label() {
  const theme = useContext(Theme);
  return <Text size={theme.size}>{theme.accent}</Text>;
}
function Badge() {
  const { accent: ink } = useContext(Theme);
  return <Text>{\`badge \${ink}\`}</Text>;
}
function Panel() {
  return <Entity><Label /><Badge /></Entity>;
}
export function App() {
  const s = useMutable({ dark: false });
  useUpdate(() => { s.dark = true; });
  return (
    <Entity>
      <Theme.Provider value={{ accent: s.dark ? "violet" : "gold", size: s.dark ? 12 : 10 }}>
        <Panel />
      </Theme.Provider>
      <Label />
    </Entity>
  );
}`;

describe("context", () => {
  it("gives every reader under a provider its value, follows it, and gives the default elsewhere", async () => {
    const result = getCompiler().compile("App.tsx", SOURCE);
    assert.ok(result.ok, result.ok ? "" : result.diagnostics.map((d) => d.message).join("\n"));
    const compiled = compile(SOURCE, "App.tsx");
    mkdirSync(dirname(compiled.fileName), { recursive: true });
    writeFileSync(join(dirname(compiled.fileName), "..", "theme.ts"), THEME);
    const typeErrors = getCompiler().typeCheck([
      { fileName: compiled.fileName, text: compiled.code },
      { fileName: join(dirname(compiled.fileName), "..", "theme.ts"), text: THEME },
    ]);
    assert.deepEqual(typeErrors, []);
    const { App } = await load<{ App: new () => Entity }>(compiled);
    const world = new World();
    const app = new App();
    world.mount(app);
    world.flush();
    const texts = (): string[] => {
      const out: string[] = [];
      const visit = (o: Entity | Text): void => {
        if (o instanceof Text) out.push(`${o.text}@${o.size}`);
        for (const c of o.children) visit(c as Entity);
      };
      visit(app);
      return out;
    };
    // Under the provider: its value; outside it: the context's default.
    assert.deepEqual(texts(), ["gold@10", "badge gold@16", "gold@10"]);
    world.tick(1 / 60);
    world.flush();
    assert.deepEqual(texts(), ["violet@12", "badge violet@16", "gold@10"]);
  });

  it("takes only an imported context", () => {
    const errors = compileErrors(`function C() { const t = useContext(5); return <Entity />; }`);
    assert.ok(errors.some((d) => /createContext/.test(d.message)));
  });
});
