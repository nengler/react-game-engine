/**
 * `useBody` (REACT_FEEL_PLAN.md, A2): a component moves its own box against solid tiles and solid colliders and learns what it
 * hit in the same step, with no rules file in between.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Entity, World, registerTilemaps, type TilemapData } from "@rge/runtime";
import { cleanOutput, closeCompiler, compile, load, typeCheck } from "./helpers.ts";

after(() => {
  closeCompiler();
  cleanOutput();
});

// A 6 × 4 room of 8-pixel tiles: a floor along the bottom row (tile 1 is solid, tile 2 is not).
const ROOM: TilemapData = {
  width: 6, height: 4, tileWidth: 8, tileHeight: 8, firstGid: 1, solid: [1],
  layers: [{ name: "Tiles", visible: true, data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] }],
};

const HERO = `
interface HeroProps { onLanded: (y: number) => void; onSpikes: () => void }
export function Hero({ onLanded, onSpikes }: HeroProps) {
  const [vy, setVy] = useState(0);
  const { x, y, move, touching } = useBody({ x: 0, y: 0, width: 4, height: 4 });
  useUpdate((dt) => {
    const hit = move(40 * dt, vy * dt);
    if (hit.down) {
      setVy(0);
      onLanded(y);
    } else setVy(vy + 400 * dt);
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
