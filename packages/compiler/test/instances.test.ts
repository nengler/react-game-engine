/** Per-instance objects (`useState(() => createShake())`) with methods, <EventListener>, and the engine's own hooks (`useSquash`). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Entity, World, type EventChannel, type Shake } from "@rge/runtime";

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

const ENEMY = `import { AnimatedSprite, Camera, Entity, EventListener, createShake, useSquash, useState } from "@rge/runtime/jsx";
import { hits } from "./events.ts";

interface Props { id: string }

export function Enemy({ id }: Props) {
  const [shake] = useState(() => createShake({ strength: 2 }));
  const [squash, setSquash] = useSquash(2);
  const [hp, setHp] = useState(3);
  return (
    <Entity name={id}>
      <Camera shake={shake} />
      {hp > 0 && <AnimatedSprite frames={["a.png"]} transform={{ scaleX: squash.scaleX, scaleY: squash.scaleY }} />}
      <EventListener
        events={hits}
        onEvent={(e) => {
          if (e.type === "hit" && e.target === id) {
            shake.start(e.power);
            setSquash({ scaleX: 1 + e.power * 0.1, scaleY: 1 - e.power * 0.1 });
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
      assert.match(code, /shake: ReturnType<typeof createShake> = createShake\(\{ strength: 2 \}\);/);
      assert.match(code, /this\.shake\.start\(/);
      assert.match(code, /springBack\(/, "useSquash was inlined: its spring back is this component's own update");
      const { Enemy } = (await import(pathToFileURL(join(p.dir, "out", "Enemy.ts")).href)) as {
        Enemy: new (props: { id: string }) => Entity & { shake: Shake; squash: { scaleX: number; scaleY: number }; hp: number };
      };
      const { hits } = (await import(pathToFileURL(join(p.dir, "src", "events.ts")).href)) as { hits: EventChannel<{ type: "hit"; power: number; target: string }> };
      const world = new World();
      const root = new Entity();
      const a = new Enemy({ id: "a" });
      const b = new Enemy({ id: "b" });
      root.addChild(a);
      root.addChild(b);
      world.mount(root);
      world.flush();
      assert.notEqual(a.shake, b.shake, "one object per instance");
      assert.equal(hits.listeners, 2);
      hits.emit({ type: "hit", power: 2, target: "a" });
      world.flush();
      assert.equal(a.hp, 1);
      assert.equal(b.hp, 3);
      assert.deepEqual([a.shake.starts, b.shake.starts], [1, 0]);
      assert.deepEqual([a.squash.scaleX, b.squash.scaleX], [1.2, 1], "each has its own squash state");
      world.tick(0.05);
      assert.ok(Math.abs(a.squash.scaleX - 1.1) < 1e-9, "it springs back in the component's own update");
      for (let i = 0; i < 10; i++) world.tick(0.05);
      assert.equal(a.squash.scaleX, 1);
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
    const q = project({ "B.tsx": `import { Entity, createShake, useState } from "@rge/runtime/jsx";\nexport function B() { const [s] = useState((x: number) => createShake()); return <Entity name="B" />; }\n` });
    try {
      assert.equal(q.status, 1);
      assert.match(q.stderr, /A lazy initial value is an arrow with no parameters/);
    } finally {
      rmSync(q.dir, { recursive: true, force: true });
    }
  });
});
