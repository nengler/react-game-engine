/** Contacts carry data (REACT_FEEL_PLAN.md, A3): `<Collider data>` reaches `other.data`, typed by tag through `ColliderData`. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { Collider, Entity, Text, World } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, getCompiler, load } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const PURSE = `
export function Purse() {
  const [coins, setCoins] = useState(0);
  const [hurt, setHurt] = useState(0);
  return (
    <Entity>
      <Text>{\`\${coins} \${hurt}\`}</Text>
      <Collider width={4} height={4} tag="player" onCollisionEnter={(other) => {
        if (other.tag === "coin") setCoins((c) => c + other.data.value);
        else if (other.tag === "enemy") setHurt((h) => h + other.data.damage);
      }} />
    </Entity>
  );
}
export function Coin() {
  return <Collider width={4} height={4} tag="coin" data={{ value: 5 }} />;
}`;

// What a game writes once, in a .ts file: the data each tag carries.
const DATA = `declare global {
  interface ColliderData { coin: { value: number }; enemy: { damage: number }; player: undefined }
}
export {};
`;

describe("contact data", () => {
  it("reaches other.data, and type-checks by tag once the game declares ColliderData", async () => {
    const compiled = compile(PURSE);
    const data = join(dirname(compiled.fileName), "colliders.ts");
    const typeErrors = getCompiler().typeCheck([{ fileName: compiled.fileName, text: compiled.code }, { fileName: data, text: DATA }]);
    assert.deepEqual(typeErrors, []);
    const { Purse, Coin } = await load<{ Purse: new () => Entity; Coin: new () => Collider }>(compiled);
    const world = new World();
    const root = new Entity({});
    world.mount(root);
    const purse = new Purse();
    const coin = new Coin();
    root.addChild(purse);
    root.addChild(coin);
    world.flush();
    const enemy = new Collider({ width: 4, height: 4, tag: "enemy", data: { damage: 2 } });
    root.addChild(enemy);
    world.flush();
    world.reportCollision(purse.children[1] as Collider, coin);
    world.reportCollision(purse.children[1] as Collider, enemy);
    world.flush();
    assert.equal((purse.children[0] as Text).text, "5 2");
  });

  it("is unknown until declared, so reading a member of it is a type error", () => {
    const compiled = compile(PURSE);
    const typeErrors = getCompiler().typeCheck([{ fileName: compiled.fileName, text: compiled.code }]);
    assert.ok(typeErrors.length > 0, "other.data.value on unknown data does not type-check");
  });
});
