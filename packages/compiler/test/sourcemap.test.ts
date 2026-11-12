/** Source maps from generated code to the component source (`compile(…, { file, source })`, `rge-compile --source-maps`). */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { cleanOutput, closeCompiler, compile, getCompiler, OUTPUT_ROOT, typeCheck, withAuthoringImports } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const SOURCE = withAuthoringImports(`interface Item { id: string }

export function Shelf() {
  const [items, setItems] = useState<Item[]>([{ id: "a" }]);
  const [n, setN] = useState(0);
  useUpdate(() => {
    setN((n) => n + 1);
    if (n === 1) setItems([{ id: "b" }, { id: "b" }]);
  });
  return (
    <Entity name="Shelf">
      <Sprite image="shelf.png" transform={{ x: n }} />
      {items.map((item) => <Sprite key={item.id} image="box.png" />)}
    </Entity>
  );
}
`);

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The first segment of each generated line: its 0-based source line, or null for an unmapped line. */
function decode(mappings: string): (number | null)[] {
  let sourceLine = 0;
  return mappings.split(";").map((segment) => {
    if (segment === "") return null;
    const values: number[] = [];
    let value = 0;
    let shift = 0;
    for (const char of segment) {
      const digit = BASE64.indexOf(char);
      value += (digit & 31) << shift;
      if (digit & 32) shift += 5;
      else {
        values.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
    }
    sourceLine += values[2]!;
    return sourceLine;
  });
}

function withMap() {
  const result = getCompiler().compile("Shelf.tsx", SOURCE, { file: "Shelf.ts", source: "../src/Shelf.tsx" });
  assert.ok(result.ok && result.sourceMap, result.diagnostics.map((d) => d.message).join("\n"));
  return { code: result.code, map: JSON.parse(result.sourceMap) as { version: number; file: string; sources: string[]; sourcesContent: string[]; mappings: string } };
}

const lineOf = (text: string, needle: string): number => text.split("\n").findIndex((l) => l.includes(needle));

describe("source maps", () => {
  it("map handler, element and component lines to where they are written", () => {
    const { code, map } = withMap();
    assert.equal(map.version, 3);
    assert.deepEqual(map.sources, ["../src/Shelf.tsx"]);
    assert.equal(map.sourcesContent[0], SOURCE);
    assert.match(code, /\/\/# sourceMappingURL=Shelf\.ts\.map\n$/);
    const lines = decode(map.mappings);
    const mapped = (generated: string): number | null => lines[lineOf(code, generated)] ?? null;
    assert.equal(mapped("override onUpdate("), lineOf(SOURCE, "useUpdate("));
    assert.equal(mapped("readonly sprite: Sprite = new Sprite("), lineOf(SOURCE, `<Sprite image="shelf.png"`));
    assert.equal(mapped("Duplicate key"), lineOf(SOURCE, "items.map("));
    assert.equal(mapped("setN(value:"), lineOf(SOURCE, "const [n, setN]"));
    assert.equal(mapped("export class Shelf"), lineOf(SOURCE, "export function Shelf"));
  });

  it("leave code without a map unchanged, and type-check with one", () => {
    const plain = compile(SOURCE, "Shelf.tsx");
    const { code } = withMap();
    assert.equal(code, `${plain.code}//# sourceMappingURL=Shelf.ts.map\n`);
    assert.deepEqual(typeCheck({ ...plain, code }), []);
  });

  it("make a Node stack trace point into the .tsx (node --enable-source-maps)", () => {
    const { code, map } = withMap();
    const dir = join(OUTPUT_ROOT, `map-${process.pid}`, "out");
    mkdirSync(join(dirname(dir), "src"), { recursive: true });
    writeFileSync(join(dir, "..", "src", "Shelf.tsx"), SOURCE);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Shelf.ts"), code);
    writeFileSync(join(dir, "Shelf.ts.map"), JSON.stringify(map));
    const run = `import { World } from "@rge/runtime"; import { Shelf } from "./Shelf.ts";
const world = new World(); world.mount(new Shelf());
try { world.tick(1); world.tick(1); world.tick(1); } catch (e) { console.log(e.stack); }`;
    writeFileSync(join(dir, "run.ts"), run);
    const r = spawnSync(process.execPath, ["--enable-source-maps", join(dir, "run.ts")], { encoding: "utf8" });
    assert.match(r.stdout, /Duplicate key "b"/, r.stderr);
    assert.match(r.stdout, new RegExp(`${basename("Shelf.tsx")}:${lineOf(SOURCE, "items.map(") + 1}:`), r.stdout);
  });
});

describe("rge-compile --source-maps", () => {
  it("writes a map beside each generated file, naming the source from there", () => {
    const root = join(OUTPUT_ROOT, `cli-map-${process.pid}`);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Shelf.tsx"), SOURCE);
    const cli = resolve(import.meta.dirname, "../src/cli.ts");
    const r = spawnSync(process.execPath, [cli, join(root, "src"), join(root, "out"), "--source-maps", "--no-check"], { encoding: "utf8", cwd: resolve(import.meta.dirname, "../../..") });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(root, "out", "Shelf.ts.map")));
    assert.deepEqual(JSON.parse(readFileSync(join(root, "out", "Shelf.ts.map"), "utf8")).sources, ["../src/Shelf.tsx"]);
    const plain = spawnSync(process.execPath, [cli, join(root, "src"), join(root, "plain"), "--no-check"], { encoding: "utf8", cwd: resolve(import.meta.dirname, "../../..") });
    assert.equal(plain.status, 0, plain.stderr);
    assert.ok(!existsSync(join(root, "plain", "Shelf.ts.map")), "no map without the flag");
  });
});
