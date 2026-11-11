/**
 * What a component owns and does itself: a per-instance object (`useState(() => createShake())`) whose methods a handler calls,
 * the engine's `useSquash` hook, and a game-state action whose result the handler uses (`const blow = strike(power)`).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInputState, Entity, World, type Shake } from "@rge/runtime";

const repo = resolve(import.meta.dirname, "../../..");

function project(files: Record<string, string>) {
  mkdirSync(join(repo, ".test-output"), { recursive: true });
  const dir = mkdtempSync(join(repo, ".test-output", "inst-"));
  mkdirSync(join(dir, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], { cwd: repo, encoding: "utf8" });
  return { dir, status: r.status, stderr: r.stderr, out: (name: string) => readFileSync(join(dir, "out", name), "utf8") };
}

const STATE = `import { createGameState } from "@rge/runtime";
interface Blow { power: number; crit: boolean }
interface State { hits: number; strike: (power: number) => Blow }
export const useGame = createGameState<State>()((set) => ({
  hits: 0,
  strike: (power) => {
    set((s) => ({ hits: s.hits + 1 }));
    return { power, crit: power > 1 };
  },
}));
`;

const ENEMY = `import { AnimatedSprite, Camera, Entity, createShake, useInput, useSquash, useState } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

interface Props { power: number }

export function Enemy({ power }: Props) {
  const strike = useGame((s) => s.strike);
  const [shake] = useState(() => createShake({ strength: 2 }));
  const [squash, setSquash] = useSquash(2);
  const [hp, setHp] = useState(3);
  useInput((input) => {
    if (input.pressed("Z")) {
      const blow = strike(power);
      shake.start(blow.crit ? 4 : 1);
      setSquash({ scaleX: 1 + blow.power * 0.1, scaleY: 1 - blow.power * 0.1 });
      setHp((h) => h - blow.power);
    }
  });
  return (
    <Entity name="Enemy">
      <Camera shake={shake} />
      {hp > 0 && <AnimatedSprite frames={["a.png"]} transform={{ scaleX: squash.scaleX, scaleY: squash.scaleY }} />}
    </Entity>
  );
}
`;

describe("what a component owns and does itself", () => {
  it("gives each instance its own object and squash, and lets a handler use what an action returns", async () => {
    const p = project({ "GameState.ts": STATE, "Enemy.tsx": ENEMY });
    try {
      assert.equal(p.status, 0, p.stderr);
      const code = p.out("Enemy.ts");
      assert.match(code, /shake: ReturnType<typeof createShake> = createShake\(\{ strength: 2 \}\);/);
      assert.match(code, /const blow = useGame\.getState\(\)\.strike\(this\.props\.power\);/);
      assert.match(code, /springBack\(/, "useSquash was inlined: its spring back is this component's own update");
      const { Enemy } = (await import(pathToFileURL(join(p.dir, "out", "Enemy.ts")).href)) as {
        Enemy: new (props: { power: number }) => Entity & { shake: Shake; squash: { scaleX: number; scaleY: number }; hp: number };
      };
      const { useGame } = (await import(pathToFileURL(join(p.dir, "src", "GameState.ts")).href)) as { useGame: { getState(): { hits: number } } };
      const world = new World();
      const root = new Entity();
      const a = new Enemy({ power: 1 });
      const b = new Enemy({ power: 2 });
      root.addChild(a);
      root.addChild(b);
      world.mount(root);
      world.flush();
      assert.notEqual(a.shake, b.shake, "one object per instance");
      world.tick(0.05, createInputState({ pressed: ["Z"], down: ["Z"] }));
      assert.equal(useGame.getState().hits, 2, "the action ran once for each");
      assert.deepEqual([a.hp, b.hp], [2, 1]);
      assert.deepEqual([a.shake.current.strength, b.shake.current.strength], [1, 4], "each read its own result");
      assert.ok(a.squash.scaleX < b.squash.scaleX, "each has its own squash state");
      for (let i = 0; i < 20; i++) world.tick(0.05);
      assert.deepEqual([a.squash.scaleX, b.squash.scaleX], [1, 1], "sprung back in each component's own update");
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
