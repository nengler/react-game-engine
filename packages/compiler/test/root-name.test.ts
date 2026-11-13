/**
 * A root `<Entity>` with no `name` is named after its component (REACT_FEEL_PLAN.md, B1), so `<Entity name="Player">` need not
 * repeat what the function is called, and `other.owner` in a collision still says which component it touched.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Collider, Entity, Game, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

async function mount<T extends Entity>(source: string, exported: string, props: object = {}): Promise<T> {
  const compiled = compile(source);
  assert.deepEqual(typeCheck(compiled), []);
  const module = await load<Record<string, new (p: object) => T>>(compiled);
  const object = new module[exported]!(props);
  const world = new World();
  world.mount(object);
  world.flush();
  return object;
}

describe("a root's name", () => {
  it("is the component's when the root <Entity> has none", async () => {
    const player = await mount(`export function Player() { return <Entity><Collider width={8} height={8} /></Entity>; }`, "Player");
    assert.equal(player.name, "Player");
    assert.equal((player.children[0] as Collider).owner, "Player");
  });

  it("is the one written, static or dynamic", async () => {
    const fixed = await mount(`export function Player() { return <Entity name="Hero" />; }`, "Player");
    assert.equal(fixed.name, "Hero");
    const dynamic = await mount(
      `interface P { id: string; } export function Enemy({ id }: P) { return <Entity name={id} />; }`,
      "Enemy",
      { id: "beetle-3" },
    );
    assert.equal(dynamic.name, "beetle-3");
  });

  it("is the component's for a fragment root", async () => {
    const coin = await mount(`export const Coin = () => <><Collider width={4} height={4} /></>;`, "Coin");
    assert.equal(coin.name, "Coin");
  });

  it("is the component's for a <Game> root", async () => {
    const main = await mount(`export default function Main() { return <Game title="T"><Entity /></Game>; }`, "default");
    assert.ok(main instanceof Game);
    assert.equal(main.name, "Main");
  });

  it("leaves nested entities unnamed", async () => {
    const level = await mount(`export function Level() { return <Entity><Entity /></Entity>; }`, "Level");
    assert.equal((level.children[0] as Entity).name, "");
  });
});
