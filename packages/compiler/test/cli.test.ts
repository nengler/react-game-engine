/** The compiler's CLI (`tse-compile`): prefabs and scenes (`--scenes`), and type-checking the sources (`--no-check`). */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { OUTPUT_ROOT, cleanOutput, closeCompiler } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

let counter = 0;

const IMPORTS = `import { useMutable, useUpdate, useInput, clamp, Entity, Sprite, Collider } from "@tsengine/runtime/jsx";`;

describe("the CLI: prefabs and scenes", () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");
  let counter = 0;

  /** Writes a project inside the repo (so `@tsengine/runtime/jsx` resolves), runs the CLI with --scenes, and reads back what it wrote. */
  function run(files: Record<string, string>, scenes: Record<string, string>) {
    const dir = join(OUTPUT_ROOT, `m6-cli-${process.pid}`, String(++counter));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", name), text);
    }
    for (const [name, text] of Object.entries(scenes)) {
      mkdirSync(join(dir, "scenes"), { recursive: true });
      writeFileSync(join(dir, "scenes", name), text);
    }
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), "--scenes", join(dir, "scenes")], {
      encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, out: join(dir, "out") };
  }

  const FILES = {
    "Enemy.tsx": `import { Entity } from "@tsengine/runtime/jsx";\ninterface EnemyProps { speed: number }\nexport function Enemy({ speed }: EnemyProps) { return <Entity name="Enemy" transform={{ x: speed }} />; }`,
  };
  const GOOD = `{ "version": 1, "entities": [{ "id": "a", "prefab": "Enemy", "props": { "speed": 2 } }] }`;
  const TMJ = JSON.stringify({
    type: "map",
    layers: [
      {
        type: "objectgroup",
        name: "Units",
        objects: [{ id: 1, class: "Enemy", x: 8, y: 9, properties: [{ name: "speed", type: "int", value: 3 }] }],
      },
    ],
  });

  it("writes prefabs.ts and prefabs.json, validates scenes, and imports a Tiled map", () => {
    const { status, output, out } = run(FILES, { "good.json": GOOD, "map.tmj": TMJ });
    assert.equal(status, 0, output);
    assert.match(output, /wrote prefabs\.ts and prefabs\.json \(1 prefab\)/);
    assert.match(readFileSync(join(out, "prefabs.ts"), "utf8"), /import \{ prefabs as prefabs0 \} from "\.\/Enemy\.ts";/);
    assert.deepEqual(Object.keys((JSON.parse(readFileSync(join(out, "prefabs.json"), "utf8")) as { prefabs: object }).prefabs), ["Enemy"]);
    const imported = JSON.parse(readFileSync(join(out, "scenes", "map.scene.json"), "utf8")) as {
      entities: { id: string; transform: object }[];
    };
    assert.deepEqual(
      imported.entities.map((e) => e.id),
      ["Units/1"]
    );
  });

  it("fails a bad scene with its file, line and column and JSON path", () => {
    const { status, output } = run(FILES, {
      "bad.json": `{\n  "version": 1,\n  "entities": [\n    { "id": "a", "prefab": "Enemy", "props": { "speed": "fast" } }\n  ]\n}\n`,
    });
    assert.equal(status, 1);
    assert.match(output, /bad\.json:4:57 - error TSE1506: entities\[0\]\.props\.speed: Expected a number, got the string "fast"/);
  });

  it("fails a Tiled map whose object does not fit its prefab", () => {
    const { status, output } = run(FILES, {
      "map.tmj": JSON.stringify({
        type: "map",
        layers: [{ type: "objectgroup", name: "Units", objects: [{ id: 1, class: "Enemy", x: 0, y: 0 }] }],
      }),
    });
    assert.equal(status, 1);
    assert.match(output, /map\.scene\.json:\d+:\d+ - error TSE1505: entities\[0\]: Enemy needs the prop 'speed'/);
  });

  /** Runs the CLI with exactly these arguments after the source and output directories. */
  function runWith(files: Record<string, string>, extra: (dir: string) => string[], scenes: Record<string, string> = {}) {
    const dir = join(OUTPUT_ROOT, `m6-cli-${process.pid}`, `w${++counter}`);
    mkdirSync(join(dir, "src"), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
    for (const [name, text] of Object.entries(scenes)) {
      mkdirSync(join(dir, "scenes"), { recursive: true });
      writeFileSync(join(dir, "scenes", name), text);
    }
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), ...extra(dir)], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}`, out: join(dir, "out") };
  }

  it("refuses a flag with no value, instead of silently skipping what it was for", () => {
    for (const flag of ["--scenes", "--runtime"]) {
      const { status, output } = runWith(FILES, () => [flag]);
      assert.equal(status, 2, flag);
      assert.match(output, new RegExp(`${flag} needs a value`));
    }
    const followedByFlag = runWith(FILES, () => ["--scenes", "--no-check"]);
    assert.equal(followedByFlag.status, 2, "the next argument is another flag, not a value");
  });

  it("refuses an unknown option, and a scenes or source directory that does not exist", () => {
    const unknown = runWith(FILES, () => ["--sceens", "x"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.output, /unknown option --sceens/);
    const missing = runWith(FILES, (dir) => ["--scenes", join(dir, "nope")]);
    assert.equal(missing.status, 2);
    assert.match(missing.output, /The scenes directory '.*nope' does not exist/);
    assert.doesNotMatch(missing.output, /at .*\.ts:\d+/, "a message, not a stack trace");
  });

  it("writes prefabs.ts and prefabs.json only when every file compiled, so they are never missing a component", () => {
    const broken = {
      ...FILES,
      "Broken.tsx": `import { Entity } from "@tsengine/runtime/jsx";\nexport function Broken() { return <Entity name="b">{oops}</Entity>; }`,
    };
    const partial = runWith(broken, () => ["--no-check"]);
    assert.equal(partial.status, 1);
    assert.match(partial.output, /skipped prefabs\.ts and prefabs\.json: not every file compiled/);
    assert.equal(existsSync(join(partial.out, "prefabs.ts")), false);
    assert.equal(existsSync(join(partial.out, "prefabs.json")), false);
    assert.equal(existsSync(join(partial.out, "Enemy.ts")), true, "the file that compiled is still written, as before");
    const whole = runWith(FILES, () => ["--no-check"]);
    assert.equal(existsSync(join(whole.out, "prefabs.ts")), true);
  });

  it("fails duplicate exported names, and does not validate scenes against a broken project", () => {
    const { status, output } = run(
      {
        ...FILES,
        "Other.tsx": `import { Entity } from "@tsengine/runtime/jsx";\nexport function Enemy() { return <Entity name="Other" />; }`,
      },
      { "good.json": GOOD }
    );
    assert.equal(status, 1);
    assert.match(output, /TSE1206: Exported component 'Enemy' is also exported from/);
    assert.match(output, /skipped scene validation/);
  });
});

describe("the CLI type-checks sources", () => {
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../src/cli.ts");

  /** Writes a one-file project inside the repo (so `@tsengine/runtime/jsx` resolves) and runs the CLI on it. */
  function runCli(source: string, ...flags: string[]) {
    const dir = join(OUTPUT_ROOT, `m7-cli-${process.pid}`, String(++counter));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "Coin.tsx"), source);
    const result = spawnSync(process.execPath, [cli, join(dir, "src"), join(dir, "out"), ...flags], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  const COIN = (props: string) => `${IMPORTS}
export function Coin() {
  return <Entity name="coin"><Sprite ${props} /></Entity>;
}`;

  it("fails with a source type error before anything is generated wrongly", () => {
    const { status, output } = runCli(COIN(`imag="coin.png"`));
    assert.equal(status, 1);
    assert.match(output, /TSE9002/);
    assert.match(output, /Did you mean 'image'/);
  });

  it("skips the source check with --no-check", () => {
    assert.equal(runCli(COIN(`imag="coin.png"`), "--no-check").status, 0);
  });

  it("fails a source that does not import what it uses, with both the compiler's and TypeScript's error", () => {
    const { status, output } = runCli(`export function Coin() { return <Entity name="coin" />; }`);
    assert.equal(status, 1);
    assert.match(output, /TSE1005: 'Entity' is not imported: add `import \{ Entity \} from "@tsengine\/runtime\/jsx"`/);
    assert.match(output, /TSE9002/);
  });
});
