import assert from "node:assert/strict";
/**
 * Props read live: a handler of a child reads a prop as its parent has it now, which includes what a handler that ran before it
 * wrote to the parent's state in this step, where `props` holds what the parent's last render copied (docs/MUTABLE_STATE.md,
 * "Shared lists: live everywhere"). Render reads what the frame committed, as before.
 */
import { after, describe, it } from "node:test";

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
    const walk = (o: Entity): Entity | null =>
      o.constructor.name === name || o.name === name ? o : (o.children.map((c) => walk(c as Entity)).find((x) => x !== null) ?? null);
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

describe("props read live: list items", () => {
  const ITEMS = `${HURT}
interface Foe { id: number; hp: number }
export function Watch({ id, hp }: { id: number; hp: number }) { const s = useMutable({ saw: -1 }); useUpdate(() => { s.saw = hp; }); return <Entity name={"w" + id} />; }
`;

  it("an item's prop is found again by key in the live list: a sibling's write to the item shows in the step", async () => {
    const { find } = await run(`${ITEMS}
export function Parent() {
  const s = useMutable({ foes: [{ id: 1, hp: 10 }, { id: 2, hp: 10 }] as Foe[] });
  const hit = (n: number) => { s.foes[1]!.hp -= n; };
  return <Entity><Hurt onHit={hit} />{s.foes.map((f) => <Watch key={f.id} id={f.id} hp={f.hp} />)}</Entity>;
}`);
    assert.equal(find("w2").s.saw, 10 - 20, "the item as the parent has it now");
    assert.equal(find("w1").s.saw, 10, "another item is as it was");
  });

  it("a spread of the item, under a condition on it: where the condition no longer holds, the last props stand", async () => {
    const compiled = compile(`${HURT}
interface Foe { id: number; hp: number }
export function See({ id, hp, onSee }: { id: number; hp: number; onSee: (line: string) => void }) { useUpdate(() => { onSee(id + ":" + hp); }); return <Entity />; }
export function Parent({ onSee }: { onSee: (line: string) => void }) {
  const s = useMutable({ foes: [{ id: 1, hp: 10 }, { id: 2, hp: 10 }] as Foe[] });
  const hit = (n: number) => { s.foes[0]!.hp -= n; };
  return <Entity><Hurt onHit={hit} />{s.foes.map((f) => f.hp >= 0 && <See key={f.id} {...f} onSee={onSee} />)}</Entity>;
}`);
    const module = await load<Record<string, new (p: object) => Entity>>(compiled);
    const log: string[] = [];
    const world = new World();
    world.mount(new module["Parent"]!({ onSee: (line: string) => log.push(line) }));
    world.flush();
    world.tick(1 / 60);
    world.flush();
    // Foe 1 is hit to -10 first (Hurt is before the list): its condition no longer holds, so it says nothing and reads the 10 it had.
    assert.deepEqual(log, ["1:10", "2:10"]);
  });

  it("an item whose key is gone reads its own last props, not the next key's: the page that is on its way out", async () => {
    const compiled = compile(`
export function Page({ label, onLog }: { label: string; onLog: (line: string) => void }) {
  useUpdate(() => { onLog("saw " + label); });
  return <Entity />;
}
export function Parent({ onLog }: { onLog: (line: string) => void }) {
  const s = useMutable({ page: "a" });
  useUpdate(() => { s.page = "b"; });
  return <Entity><Page key={s.page} label={s.page} onLog={onLog} /></Entity>;
}`);
    const module = await load<Record<string, new (p: object) => Entity>>(compiled);
    const log: string[] = [];
    const world = new World();
    world.mount(new module["Parent"]!({ onLog: (line: string) => log.push(line) }));
    world.flush();
    world.tick(1 / 60);
    world.flush();
    // The parent set the page to "b" first (tree order); the old "a" page runs next in the same step and still reads "a".
    assert.deepEqual(log, ["saw a"]);
  });
});
