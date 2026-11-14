/**
 * Props read live: a handler of a child reads a prop as its parent has it now, which includes what a handler that ran before it
 * wrote to the parent's state in this step, where `props` holds what the parent's last render copied (docs/MUTABLE_STATE.md,
 * "Shared lists: live everywhere"). Render reads what the frame committed, as before.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

/** Mount the first component with no props, tick it `steps` times, and give back the root and the world. */
async function run(source: string, steps = 1): Promise<{ root: Entity; find: (name: string) => Entity & { s: Record<string, unknown> } }> {
  const compiled = compile(source);
  assert.deepEqual(typeCheck(compiled), []);
  const module = await load<Record<string, new () => Entity>>(compiled);
  const world = new World();
  const root = new module["Parent"]!();
  world.mount(root);
  world.flush();
  for (let i = 0; i < steps; i++) {
    world.tick(1 / 60);
    world.flush();
  }
  const find = (name: string): Entity & { s: Record<string, unknown> } => {
    const walk = (o: Entity): Entity | null => (o.constructor.name === name ? o : (o.children.map((c) => walk(c as Entity)).find((x) => x !== null) ?? null));
    return walk(root) as Entity & { s: Record<string, unknown> };
  };
  return { root, find };
}

const HURT = `export function Hurt({ onHit }: { onHit: (n: number) => void }) { useUpdate(() => { onHit(20); }); return <Entity />; }`;
const WATCH = `export function Watch({ health }: { health: number }) { const s = useMutable({ saw: -1 }); useUpdate(() => { s.saw = health; }); return <Entity />; }`;

describe("props read live", () => {
  it("a second child sees what the first wrote to the parent, in the same step", async () => {
    const { root, find } = await run(`${HURT}
${WATCH}
export function Parent() {
  const s = useMutable({ health: 100 });
  const hit = (n: number) => { s.health -= n; };
  return <Entity><Hurt onHit={hit} /><Watch health={s.health} /></Entity>;
}`);
    assert.equal((root as unknown as { s: { health: number } }).s.health, 80);
    assert.equal(find("Watch").s.saw, 80, "not the 100 the last render copied");
  });

  it("the parent's own write earlier in the step, and a child before the writer, which sees the step's start", async () => {
    const { find } = await run(`${HURT}
${WATCH}
export function Parent() {
  const s = useMutable({ health: 100 });
  useUpdate(() => { s.health = 50; });
  const hit = (n: number) => { s.health -= n; };
  return <Entity><Watch health={s.health} /><Hurt onHit={hit} /></Entity>;
}`);
    // The parent ran first (health 50), then Watch (sees 50); Hurt ran after Watch, so Watch did not see its write.
    assert.equal(find("Watch").s.saw, 50);
  });

  it("a prop worked out from the parent's state, and one passed on through a middle component", async () => {
    const { find } = await run(`${HURT}
export function Watch({ health }: { health: number }) { const s = useMutable({ saw: -1 }); useUpdate(() => { s.saw = health; }); return <Entity />; }
export function Middle({ hp }: { hp: number }) { return <Watch health={hp} />; }
export function Parent() {
  const s = useMutable({ health: 100 });
  const hit = (n: number) => { s.health -= n; };
  const low = s.health < 50;
  return <Entity><Hurt onHit={hit} /><Middle hp={low ? 1 : s.health * 2} /></Entity>;
}`);
    // 100 - 20 = 80: not low (under 50), so 80 * 2 = 160, read live through Middle's prop and Watch's.
    assert.equal(find("Watch").s.saw, 160);
  });

  it("render still shows what the frame committed", async () => {
    const { find } = await run(`${HURT}
export function Show({ health }: { health: number }) { return <Entity name={"hp" + health} />; }
export function Parent() {
  const s = useMutable({ health: 100 });
  const hit = (n: number) => { s.health -= n; };
  return <Entity><Hurt onHit={hit} /><Show health={s.health} /></Entity>;
}`);
    assert.equal(find("Show").name, "hp80", "after the frame's render, the committed value");
  });
});
