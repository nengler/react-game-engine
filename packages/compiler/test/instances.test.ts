import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * What a component owns and does itself: a per-instance object (`useState(() => makeTally())`) whose methods a handler calls, the
 * engine's `useSquash` and `useShake` hooks, and a game-state action whose result the handler uses (`const blow = strike(power)`).
 */
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createInputState, Entity, World, type ShakeState } from "@tsengine/runtime";

const repo = resolve(import.meta.dirname, "../../..");

function project(files: Record<string, string>) {
  mkdirSync(join(repo, ".test-output"), { recursive: true });
  const dir = mkdtempSync(join(repo, ".test-output", "inst-"));
  mkdirSync(join(dir, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "src", name), text);
  const r = spawnSync(process.execPath, [resolve(repo, "packages/compiler/src/cli.ts"), join(dir, "src"), join(dir, "out")], {
    cwd: repo,
    encoding: "utf8",
  });
  return { dir, status: r.status, stderr: r.stderr, out: (name: string) => readFileSync(join(dir, "out", name), "utf8") };
}

const STATE = `import { createGameState } from "@tsengine/runtime";
interface Blow { power: number; crit: boolean }
export const useGame = createGameState(
  { hits: 0 },
  {
    strike(s, power: number): Blow {
      s.hits += 1;
      return { power, crit: power > 1 };
    },
  },
);
`;

const TALLY = `export function makeTally() {
  return { count: 0, add(n: number): void { this.count += n; } };
}
`;

const ENEMY = `import { AnimatedSprite, Camera, Entity, useInput, useShake, useSquash, useMutable } from "@tsengine/runtime/jsx";
import { useGame } from "./GameState.ts";
import { makeTally } from "./tally.ts";

interface Props { power: number }

export function Enemy({ power }: Props) {
  const strike = useGame((s) => s.strike);
  const st = useMutable({ tally: makeTally(), hp: 3 });
  const shake = useShake();
  const squash = useSquash(2);
  useInput((input) => {
    if (input.pressed("Z")) {
      const blow = strike(power);
      st.tally.add(blow.power);
      shake.strength = blow.crit ? 4 : 1;
      shake.duration = 0.2;
      shake.elapsed = 0;
      squash.x = 1 + blow.power * 0.1;
      squash.y = 1 - blow.power * 0.1;
      st.hp -= blow.power;
    }
  });
  return (
    <Entity name="Enemy">
      <Camera shake={shake} />
      {st.hp > 0 && <AnimatedSprite frames={["a.png"]} scaleX={squash.x} scaleY={squash.y} />}
    </Entity>
  );
}
`;

describe("what a component owns and does itself", () => {
  it("gives each instance its own object and squash, and lets a handler use what an action returns", async () => {
    const p = project({ "GameState.ts": STATE, "tally.ts": TALLY, "Enemy.tsx": ENEMY });
    try {
      assert.equal(p.status, 0, p.stderr);
      const code = p.out("Enemy.ts");
      assert.match(code, /tally: ReturnType<typeof makeTally> = makeTally\(\);/);
      assert.match(code, /this\.#\$st_tallyNext\.add\(/);
      assert.match(code, /const blow = useGame\.getState\(\)\.strike\(this\.\$live\.power\);/);
      assert.match(code, /springBack\(/, "useSquash was inlined: its spring back is this component's own update");
      assert.match(code, /shakeOn\(/, "and so was useShake");
      const { Enemy } = (await import(pathToFileURL(join(p.dir, "out", "Enemy.ts")).href)) as {
        Enemy: new (props: {
          power: number;
        }) => Entity & { st: { tally: { count: number }; hp: number }; shake: ShakeState; squash: { x: number; y: number } };
      };
      const { useGame } = (await import(pathToFileURL(join(p.dir, "src", "GameState.ts")).href)) as {
        useGame: { getState(): { hits: number } };
      };
      const world = new World();
      const root = new Entity();
      const a = new Enemy({ power: 1 });
      const b = new Enemy({ power: 2 });
      root.addChild(a);
      root.addChild(b);
      world.mount(root);
      world.flush();
      assert.notEqual(a.st.tally, b.st.tally, "one object per instance");
      world.tick(0.05, createInputState({ pressed: ["Z"], down: ["Z"] }));
      assert.equal(useGame.getState().hits, 2, "the action ran once for each");
      assert.deepEqual([a.st.hp, b.st.hp], [2, 1]);
      assert.deepEqual([a.st.tally.count, b.st.tally.count], [1, 2]);
      assert.deepEqual([a.shake.strength, b.shake.strength], [1, 4], "each read its own result");
      assert.ok(a.squash.x < b.squash.x, "each has its own squash state");
      for (let i = 0; i < 20; i++) world.tick(0.05);
      assert.deepEqual([a.squash.x, b.squash.x], [1, 1], "sprung back in each component's own update");
      assert.equal(a.shake.elapsed, 0.2, "the shake ran down");
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });

  it("keeps the message for an array changed in place", () => {
    const p = project({
      "A.tsx": `import { Entity, useMutable, useUpdate } from "@tsengine/runtime/jsx";
export function A() { const s = useMutable({ items: [] as number[] }); useUpdate(() => { s.items = s.items.reverse(); }); return <Entity name="A" />; }
`,
    });
    try {
      assert.equal(p.status, 1);
      assert.match(p.stderr, /`reverse` changes `s\.items` in place[^]*`s\.items = s\.items\.toReversed\(\)`/);
    } finally {
      rmSync(p.dir, { recursive: true, force: true });
    }
  });
});
