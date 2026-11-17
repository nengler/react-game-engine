import assert from "node:assert/strict";
import { dirname, join } from "node:path";
/**
 * Collider callbacks and contact data (DESIGN.md, "What `other` exposes"): `onCollisionEnter` and friends on a `<Collider>`, and
 * `<Collider data>` reaching `other.data`, typed by tag through `ColliderData`.
 */
import { after, describe, it } from "node:test";

import { Collider, Entity, Text, World } from "@tsengine/runtime";

import { DiagnosticCode } from "../src/index.ts";
import { cleanOutput, closeCompiler, compile, getCompiler, load, compileErrors, typeCheck, elementOf } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

const PURSE = `
export function Purse() {
  const s = useMutable({ coins: 0, hurt: 0 });
  return (
    <Entity>
      <Text>{\`\${s.coins} \${s.hurt}\`}</Text>
      <Collider width={4} height={4} tag="player" onCollisionEnter={(other) => {
        if (other.tag === "coin") s.coins += other.data.value;
        else if (other.tag === "enemy") s.hurt += other.data.damage;
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
    const typeErrors = getCompiler().typeCheck([
      { fileName: compiled.fileName, text: compiled.code },
      { fileName: data, text: DATA },
    ]);
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

describe("collider callbacks", () => {
  it("types the callback's parameter from the runtime and imports what it needs", () => {
    const compiled = compile(`function Hero() {
  return <Entity name="H"><Collider width={1} height={1} onCollisionEnter={(other) => {}} /></Entity>;
}`);
    const collider = elementOf(compiled.ir.components[0]!.root.children[0]!);
    const callback = collider.props.find((p) => p.kind === "CallbackProp");
    assert.ok(callback?.kind === "CallbackProp");
    assert.deepEqual(
      callback.handler.params.map((p) => p.type),
      [{ kind: "Named", name: "Contact" }]
    );
    assert.match(compiled.code, /import \{ Collider, Entity, type Contact \} from "@tsengine\/runtime";/);
    assert.match(compiled.code, /onCollisionEnter: \(other: Contact\) => \{/);
    assert.deepEqual(typeCheck(compiled), []);
  });

  it("rejects a function on a built-in that has no such callback, and an unknown callback name", () => {
    const run = (jsx: string) => compileErrors(`function A() { return <Entity>${jsx}</Entity>; }`).map((d) => d.code);
    assert.deepEqual(run(`<Sprite image="a" onClick={() => {}} />`), [DiagnosticCode.UnsupportedAttribute]);
    assert.deepEqual(run(`<Collider width={1} height={1} onTouch={() => {}} />`), [DiagnosticCode.UnsupportedAttribute]);
    assert.deepEqual(run(`<Collider width={1} height={1} onCollisionEnter={(a, b) => {}} />`), [DiagnosticCode.InvalidHandler]);
  });

  it("lets a handler read the other collider's tag and owner, and nothing else", () => {
    const compiled = compile(`function Hero() {
  const s = useMutable({ coins: 0, hurt: false });
  return (
    <Entity name="H">
      <Collider width={1} height={1} tag="player" layer="player" hits={["coin", "enemy"]}
        onCollisionEnter={(other) => { if (other.tag === "coin") s.coins += 1; else if (other.owner === "Spikes") s.hurt = true; }}
        onCollisionExit={(other) => { if (other.tag === "enemy") s.hurt = false; }} />
    </Entity>
  );
}`);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /onCollisionExit: \(other: Contact\) =>/);
    assert.match(compiled.code, /tag: "player"/);
    const unknown = compileErrors(
      `function A() { return <Entity><Collider width={1} height={1} onCollisionEnter={(other) => { const w = other.width; }} /></Entity>; }`
    );
    assert.match(unknown[0]!.message, /'Contact' has no readable property 'width'/);
  });

  it("type-checks authored collider callbacks", () => {
    const source = `import { useMutable, Entity, Collider } from "@tsengine/runtime/jsx";
function A() {
  const s = useMutable({ n: 0 });
  return <Entity name="A"><Collider width={1} height={1} onCollisionEnter={(other) => { s.n += 1; }} /></Entity>;
}`;
    const check = (text: string) => getCompiler().typeCheckSources([{ fileName: `${process.cwd()}/.test-output/Cb.tsx`, text }]);
    assert.deepEqual(check(source), []);
    assert.ok(check(source.replace("s.n += 1", `s.n = "a"`)).length > 0);
    assert.ok(check(source.replace("(other) =>", "(other: string) =>")).length > 0, "the parameter is typed");
  });
});

// What a game declares once: what each tag carries, and what each tag can be sent.
const MESSAGES = `declare global {
  interface ColliderData { foe: { id: number } }
  interface ColliderMessages { foe: { damage: number } }
}
export {};
`;

const TOWER = `
export function Tower() {
  const s = useMutable({ seen: 0 });
  useUpdate(() => {
    const foes = nearby("foe", 0, 0, 50);
    s.seen = foes.length > 0 ? foes[0]!.data.id + foes[0]!.distance : -1;
    if (foes.length > 0) send("foe", foes[0]!, { damage: 3 });
    send("foe", { x: 0, y: 0, radius: 20 }, { damage: 1 });
  });
  return <Entity />;
}
export function Foe() {
  const s = useMutable({ hp: 10 });
  return <Collider width={4} height={4} tag="foe" data={{ id: 7 }} onReceive={(blast) => { s.hp -= blast.damage; }} />;
}
export function Ward() {
  const s = useMutable({ hp: 10 });
  return <Entity><Collider width={4} height={4} tag="foe" data={{ id: 8 }} onReceive={(hit) => { s.hp -= hit.damage; }} /></Entity>;
}`;

describe("nearby, send and onReceive", () => {
  it("compile to the component's own calls, and type-check by tag once the game declares ColliderMessages", () => {
    const compiled = compile(TOWER);
    assert.match(compiled.code, /this\.nearby\("foe", 0, 0, 50\)/);
    assert.match(compiled.code, /this\.send\("foe", \{ x: 0, y: 0, radius: 20 \}, \{ damage: 1 \}\)/);
    assert.match(compiled.code, /export class Foe extends Collider<\{\}, "foe">/, "a <Collider> root names its tag, which types onReceive");
    assert.match(compiled.code, /this\.onReceive = \(blast\) => \{/);
    assert.match(compiled.code, /onReceive: \(hit\) => \{/, "a <Collider> inside: typed by its tag where it is made");
    const data = join(dirname(compiled.fileName), "colliders.ts");
    assert.deepEqual(
      getCompiler().typeCheck([
        { fileName: compiled.fileName, text: compiled.code },
        { fileName: data, text: MESSAGES },
      ]),
      []
    );
    const wrong = compile(TOWER.replace("{ damage: 1 }", "{ dmg: 1 }"));
    const errors = getCompiler().typeCheck([
      { fileName: wrong.fileName, text: wrong.code },
      { fileName: join(dirname(wrong.fileName), "colliders.ts"), text: MESSAGES },
    ]);
    assert.ok(errors.length > 0, "a value that is not the tag's message is a type error");
  });

  it("is unknown until declared, so reading a member of what was received is a type error", () => {
    const compiled = compile(TOWER);
    assert.ok(typeCheck(compiled).length > 0);
  });

  it("is only valid in a handler, with the right number of arguments", () => {
    const run = (body: string) => compileErrors(`function A() { ${body} return <Entity />; }`).map((d) => d.message);
    assert.match(
      run(`const f = nearby("foe", 0, 0, 5);`)[0]!,
      /'nearby\(\)' asks where colliders are this step, so it is only valid in a handler/
    );
    assert.match(run(`useUpdate(() => { send("foe", { x: 0, y: 0, radius: 1 }); });`)[0]!, /send expects 3 arguments/);
  });
});
