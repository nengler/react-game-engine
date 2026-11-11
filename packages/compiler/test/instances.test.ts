/** Per-instance objects (`useState(() => createSquash())`) with methods, and <EventListener>: what a component answers itself. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Entity, World, type EventChannel, type Squash } from "@rge/runtime";

const repo = resolve(import.meta.dirname, "../../..");

function project(files: Record<string, string>) {
  mkdirSync(join(repo, ".test-output"), { recursive: true });
  const dir = mkdtempSync(join(repo, ".test-output", "inst-"));
  mkdirSync(join(dir, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], { cwd: repo, encoding: "utf8" });
  return { dir, status: r.status, stderr: r.stderr, out: (name: string) => readFileSync(join(dir, "out", name), "utf8") };
}

const EVENTS = `import { createEvents } from "@rge/runtime";
export type Hit = { type: "hit"; power: number; target: string } | { type: "heal"; amount: number };
export const hits = createEvents<Hit>();
`;

const ENEMY = `import { AnimatedSprite, Entity, EventListener, createSquash, useState } from "@rge/runtime/jsx";
import { hits } from "./events.ts";

interface Props { id: string }

export function Enemy({ id }: Props) {
  const [squash] = useState(() => createSquash({ recover: 2 }));
  const [hp, setHp] = useState(3);
  return (
    <Entity name={id}>
      {hp > 0 && <AnimatedSprite frames={["a.png"]} squash={squash} />}
      <EventListener
        events={hits}
        onEvent={(e) => {
          if (e.type === "hit" && e.target === id) {
            squash.start(1 + e.power * 0.1, 1 - e.power * 0.1);
            setHp((h) => h - e.power);
          }
        }}
      />
    </Entity>
  );
}
`;

describe("per-instance objects and <EventListener>", () => {
  it("give each instance its own object, made once, whose methods a handler calls; listen only while mounted", async () => {
    const p = project({ "events.ts": EVENTS, "Enemy.tsx": ENEMY });
    try {
      assert.equal(p.status, 0, p.stderr);
      const code = p.out("Enemy.ts");
      assert.match(code, /squash: ReturnType<typeof createSquash> = createSquash\(\{ recover: 2 \}\);/);
      assert.match(code, /this\.squash\.start\(/);
      const { Enemy } = (await import(pathToFileURL(join(p.dir, "out", "Enemy.ts")).href)) as { Enemy: new (props: { id: string }) => Entity & { squash: Squash; hp: number } };
      const { hits } = (await import(pathToFileURL(join(p.dir, "src", "events.ts")).href)) as { hits: EventChannel<{ type: "hit"; power: number; target: string }> };
      const world = new World();
      const root = new Entity();
      const a = new Enemy({ id: "a" });
      const b = new Enemy({ id: "b" });
      root.addChild(a);
      root.addChild(b);
      world.mount(root);
      world.flush();
      assert.notEqual(a.squash, b.squash, "one object per instance");
      assert.equal(hits.listeners, 2);
      hits.emit({ type: "hit", power: 2, target: "a" });
      world.flush();
      assert.equal(a.hp, 1);
      assert.equal(b.hp, 3);
      assert.ok(Math.abs(a.squash.x - 1.2) < 1e-9 && b.squash.resting);
      root.removeChild(a);
      world.flush();
      assert.equal(hits.listeners, 1, "a listener leaves with its component");
      hits.emit({ type: "hit", power: 1, target: "a" });
      assert.equal(a.hp, 1);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("keeps the old messages for arrays and records, and asks for a lazy initializer's shape", () => {
    const p = project({
      "A.tsx": `import { Entity, useState, useUpdate } from "@rge/runtime/jsx";
export function A() { const [items, setItems] = useState<number[]>([]); useUpdate(() => { setItems(items.reverse()); }); return <Entity name="A" />; }
`,
    });
    try {
      assert.equal(p.status, 1);
      assert.match(p.stderr, /'reverse' is not an allowlisted call|changes the array in place/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
    const q = project({ "B.tsx": `import { Entity, createSquash, useState } from "@rge/runtime/jsx";\nexport function B() { const [s] = useState((x: number) => createSquash()); return <Entity name="B" />; }\n` });
    try {
      assert.equal(q.status, 1);
      assert.match(q.stderr, /A lazy initial value is an arrow with no parameters/);
    } finally {
      rmSync(q.dir, { recursive: true, force: true });
    }
  });
});
