import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
/**
 * Component state in saves (DESIGN.md, "Component state in saves"): `createSave({ tree: true })` keeps each component's own state, found again by
 * its path, and a list item by its key.
 */
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { Compiler, formatDiagnostic } from "@rge/compiler";
import { createMemoryStorage, createSave, setStorage, type GameObject } from "@rge/runtime";

import { render } from "../src/index.ts";

const OUT = resolve(import.meta.dirname, "../../../.test-output", `save-tree-${process.pid}`);
let compiler: Compiler;
before(() => {
  compiler = new Compiler();
});
after(() => {
  compiler.close();
  setStorage(null);
  rmSync(OUT, { recursive: true, force: true });
});

const PACK = `import { Entity, Text, useMutable } from "@rge/runtime/jsx";
interface EnemyProps { id: string }
export function Enemy({ id }: EnemyProps) {
  const s = useMutable({ hp: 3 });
  return <Entity><Text>{\`\${id} \${s.hp}\`}</Text></Entity>;
}
interface PackProps { ids: string[] }
export function Pack({ ids }: PackProps) {
  return <Entity>{ids.map((id) => <Enemy key={id} id={id} />)}</Entity>;
}`;

async function build(): Promise<{ Pack: new (p: { ids: string[] }) => GameObject }> {
  const result = compiler.compile("Pack.tsx", PACK);
  if (!result.ok) throw new Error(result.diagnostics.map(formatDiagnostic).join("\n"));
  const file = join(OUT, "Pack.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, result.code);
  return (await import(pathToFileURL(file).href)) as { Pack: new (p: { ids: string[] }) => GameObject };
}

describe("a save with its tree", () => {
  it("keeps each component's state, and finds a list item by its key when an earlier one is gone", async () => {
    const { Pack } = await build();
    setStorage(createMemoryStorage());
    const save = createSave({ name: "tree-test", version: 1, tree: true });

    const first = render(Pack, { ids: ["a", "b", "c"] });
    const [, b, c] = first.findAll("Enemy");
    (b as unknown as { s: { hp: number } }).s.hp = 2;
    (c as unknown as { s: { hp: number } }).s.hp = 1;
    first.step();
    assert.deepEqual(first.texts(), ["a 3", "b 2", "c 1"]);
    assert.ok(save.write());

    // A new game where "a" is gone: by index, "b" would take "a"'s state; by key, each keeps its own.
    const second = render(Pack, { ids: ["b", "c"] });
    assert.deepEqual(second.texts(), ["b 3", "c 3"]);
    assert.ok(save.load());
    second.step();
    assert.deepEqual(second.texts(), ["b 2", "c 1"]);
  });
});
