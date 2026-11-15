import assert from "node:assert/strict";
import { dirname, join } from "node:path";
/**
 * `useBody` (DESIGN.md, "Bodies: `useBody`"): a component moves its own box against solid tiles and solid colliders and learns what it
 * hit in the same step, with no rules file in between.
 */
import { after, describe, it } from "node:test";

import { Entity, World, captureHotState, registerTilemaps, restoreHotState, type TilemapData } from "@tsengine/runtime";

import { cleanOutput, closeCompiler, compile, compileErrors, getCompiler, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

// A 6 × 4 room of 8-pixel tiles: a floor along the bottom row (tile 1 is solid, tile 2 is not).
const ROOM: TilemapData = {
  width: 6,
  height: 4,
  tileWidth: 8,
  tileHeight: 8,
  firstGid: 1,
  solid: [1],
  layers: [{ name: "Tiles", visible: true, data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] }],
};

const HERO = `
interface HeroProps { onLanded: (y: number) => void; onSpikes: () => void }
export function Hero({ onLanded, onSpikes }: HeroProps) {
  const s = useMutable({ vy: 0 });
  const { x, y, move, touching } = useBody({ x: 0, y: 0, width: 4, height: 4 });
  useUpdate((dt) => {
    const hit = move(40 * dt, s.vy * dt);
    if (hit.down) {
      s.vy = 0;
      onLanded(y);
    } else s.vy += 400 * dt;
    if (touching("spikes")) onSpikes();
  });
  return <Entity transform={{ x, y }} />;
}
export function Room({ onLanded, onSpikes }: HeroProps) {
  return (
    <Entity>
      <Tilemap map="body-room" layer="Tiles" solid />
      <Collider width={8} height={8} tag="crate" solid transform={{ x: 16, y: 16 }} />
      <Collider width={8} height={2} tag="spikes" transform={{ x: 32, y: 22 }} />
      <Hero onLanded={onLanded} onSpikes={onSpikes} />
    </Entity>
  );
}`;

describe("useBody", () => {
  it("falls onto a solid floor, is stopped by a solid crate, and feels spikes, each in the step it happens", async () => {
    registerTilemaps({ "body-room": ROOM });
    const compiled = compile(HERO);
    assert.deepEqual(typeCheck(compiled), []);
    assert.match(compiled.code, /ownedHandles\(\)/, "the body is told its world");
    type P = { onLanded: (y: number) => void; onSpikes: () => void };
    const { Room } = await load<{ Room: new (p: P) => Entity }>(compiled);
    const landed: number[] = [];
    let spiked = 0;
    const world = new World();
    const room = new Room({ onLanded: (y) => landed.push(y), onSpikes: () => spiked++ });
    world.mount(room);
    world.flush();
    const hero = room.children[3] as Entity;
    for (let i = 0; i < 60; i++) {
      world.tick(1 / 30);
      world.flush();
    }
    // The floor's top is y = 24 and the hero is 4 high, so it stands at y = 20; the crate's left side is x = 16 and the hero is
    // 4 wide, so it is stopped at x = 12 and never reaches the spikes.
    assert.equal(hero.transform.y, 20);
    assert.equal(hero.transform.x, 12);
    assert.ok(landed.length > 0, "it landed");
    assert.equal(spiked, 0);
  });
});

const PROBE = `
interface ProbeProps { onAsk: (answers: string) => void }
export function Probe({ onAsk }: ProbeProps) {
  const { blocked } = useBody({ x: 12, y: 20, width: 4, height: 4 });
  useUpdate(() => {
    onAsk([blocked(0, 1), blocked(0, -1), blocked(1, 0), blocked(-1, 0)].join(","));
  });
  return <Entity />;
}
export function Corner({ onAsk }: ProbeProps) {
  return (
    <Entity>
      <Tilemap map="body-room" layer="Tiles" solid />
      <Collider width={8} height={8} tag="crate" solid x={16} y={16} />
      <Probe onAsk={onAsk} />
    </Entity>
  );
}`;

describe("useBody's blocked", () => {
  it("says whether something solid is a move away, without moving: the floor below, the crate to the right", async () => {
    registerTilemaps({ "body-room": ROOM });
    const compiled = compile(PROBE);
    assert.deepEqual(typeCheck(compiled), []);
    const { Corner } = await load<{ Corner: new (p: { onAsk: (a: string) => void }) => Entity }>(compiled);
    const asked: string[] = [];
    const world = new World();
    world.mount(new Corner({ onAsk: (a) => asked.push(a) }));
    world.flush();
    world.tick(1 / 60);
    world.flush();
    // Standing on the floor (its top is y = 24) against the crate (its left side is x = 16): below and right are solid.
    assert.deepEqual(asked, ["true,false,true,false"]);
  });
});

const TOWER = `
interface TowerProps { onSee: (ids: string) => void }
export function Tower({ onSee }: TowerProps) {
  const { overlapping } = useBody({ x: -10, y: -10, width: 20, height: 20 });
  useUpdate(() => {
    onSee(overlapping("enemy").map((enemy) => enemy.data.id).join(","));
  });
  return <Entity />;
}
export function Field({ onSee }: TowerProps) {
  return (
    <Entity>
      <Collider width={4} height={4} tag="enemy" data={{ id: "near" }} transform={{ x: 32, y: 30 }} />
      <Collider width={4} height={4} tag="enemy" data={{ id: "far" }} transform={{ x: 80, y: 30 }} />
      <Collider width={4} height={4} tag="wall" transform={{ x: 30, y: 30 }} />
      <Entity transform={{ x: 30, y: 30 }}>
        <Tower onSee={onSee} />
      </Entity>
    </Entity>
  );
}`;

// What the game declares once: the data each tag carries, which types \`overlapping("enemy")\`'s contacts.
const ENEMY_DATA = `declare global {
  interface ColliderData { enemy: { id: string }; wall: undefined }
}
export {};
`;

describe("useBody's overlapping", () => {
  it("answers which colliders of a tag overlap the body now, with their data, typed by tag", async () => {
    const compiled = compile(TOWER);
    const data = join(dirname(compiled.fileName), "colliders.ts");
    assert.deepEqual(
      getCompiler().typeCheck([
        { fileName: compiled.fileName, text: compiled.code },
        { fileName: data, text: ENEMY_DATA },
      ]),
      []
    );
    assert.match(compiled.code, /overlapping = <Tag extends string>\(tag: Tag\)/, "the hook's function keeps its type parameter");
    const { Field } = await load<{ Field: new (p: { onSee: (ids: string) => void }) => Entity }>(compiled);
    const seen: string[] = [];
    const world = new World();
    world.mount(new Field({ onSee: (ids) => seen.push(ids) }));
    world.flush();
    world.tick(1 / 60);
    assert.deepEqual(seen, ["near"], "the far enemy is outside its box, and the wall is not an enemy");
  });
});

describe("useBody across a hot reload", () => {
  it("keeps the body's place in the new component's own body, which still knows its owner and stops at walls", async () => {
    registerTilemaps({ "body-room": ROOM });
    const compiled = compile(HERO);
    type P = { onLanded: (y: number) => void; onSpikes: () => void };
    const { Room } = await load<{ Room: new (p: P) => Entity }>(compiled);
    const world = new World();
    const props: P = { onLanded: () => {}, onSpikes: () => {} };
    const first = new Room(props);
    world.mount(first);
    world.flush();
    for (let i = 0; i < 10; i++) {
      world.tick(1 / 30);
      world.flush();
    }
    const saved = captureHotState(first);
    world.root.removeChild(first);
    const second = new Room(props);
    world.mount(second);
    restoreHotState(world, second, saved);
    const hero = second.children[3] as Entity;
    const before = { x: hero.transform.x, y: hero.transform.y };
    assert.ok(before.x > 0, "it kept where it was");
    for (let i = 0; i < 60; i++) {
      world.tick(1 / 30);
      world.flush();
    }
    assert.equal(hero.transform.y, 20, "and still lands on the floor: its body is attached to it, not to the component that left");
    assert.equal(hero.transform.x, 12, "and still stops at the crate");
  });
});

describe("one mistake, one error, through an inlined hook", () => {
  it("reports a bad argument to useBody once, not again as the hook's own methods failing", () => {
    const errors = compileErrors(`function Hero() {
  const { x, y, move, blocked } = useBody({ x: nowhere, y: 0, width: 4, height: 4 });
  useUpdate(() => { if (blocked(0, 1)) move(1, 0); });
  return <Entity x={x} y={y} />;
}`);
    assert.equal(errors.length, 1, errors.map((d) => d.message).join("\n"));
    assert.match(errors[0]!.message, /'nowhere'/);
  });

  it("still reports a second mistake that is not in the hook call", () => {
    const errors = compileErrors(`function Hero() {
  const { x, y } = useBody({ x: nowhere, y: 0, width: 4, height: 4 });
  useUpdate(() => { missing(); });
  return <Entity x={x} y={y} />;
}`);
    assert.equal(errors.length, 2, errors.map((d) => d.message).join("\n"));
  });
});
