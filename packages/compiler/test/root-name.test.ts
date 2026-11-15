import assert from "node:assert/strict";
/**
 * A root `<Entity>` with no `name` is named after its component (DESIGN.md, "A root named after its component"), so `<Entity name="Player">` need not
 * repeat what the function is called, and `other.owner` in a collision still says which component it touched.
 */
import { after, describe, it } from "node:test";

import { Collider, Entity, Game, Sprite, Text, World } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, compileErrors, load, typeCheck } from "./helpers.ts";

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
    const dynamic = await mount(`interface P { id: string; } export function Enemy({ id }: P) { return <Entity name={id} />; }`, "Enemy", {
      id: "beetle-3",
    });
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

describe("names that the root built-in also has (DESIGN.md, 'Roots and component forms')", () => {
  it("lets state be called `name` on an <Entity> root, apart from the entity's own name", async () => {
    const compiled = compile(`export function Badge() {
  const s = useMutable({ name: "Ada" });
  useUpdate(() => { s.name = "Bo"; });
  return <Entity><Text>{s.name}</Text></Entity>;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Badge } = await load<{ Badge: new () => Entity }>(compiled);
    const world = new World();
    const badge = new Badge();
    world.mount(badge);
    world.flush();
    assert.equal(badge.name, "Badge", "the entity keeps the component's name");
    assert.equal((badge.children[0] as Text).text, "Ada");
    world.tick(1 / 60);
    world.flush();
    assert.equal((badge.children[0] as Text).text, "Bo");
    assert.equal(badge.name, "Badge");
  });

  it("lets a ref be called `image` on a <Sprite> root, and state `parent` anywhere", async () => {
    const compiled = compile(`export function Coin() {
  const s = useMutable({ parent: 1, image: 0 });
  useUpdate(() => {
    s.image += 1;
    s.parent = s.image + 1;
  });
  return <Sprite image={s.parent > 1 ? "b.png" : "a.png"} />;
}`);
    assert.deepEqual(typeCheck(compiled), []);
    const { Coin } = await load<{ Coin: new () => Sprite }>(compiled);
    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const coin = new Coin();
    root.addChild(coin);
    world.flush();
    assert.equal(coin.image, "a.png");
    assert.equal(coin.parent, root, "the runtime's parent is untouched");
    world.tick(1 / 60);
    world.flush();
    assert.equal(coin.image, "b.png");
  });

  it("still refuses a name declared twice in the component", () => {
    assert.ok(compileErrors(`export function A() { const n = useMutable({ v: 0 }); const n = 2; return <Entity />; }`).length > 0);
  });
});
