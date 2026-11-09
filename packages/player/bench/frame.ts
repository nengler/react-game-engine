/**
 * How long a frame of script takes: `createPlayer(...).step()` with `n` moving entities, each drawn as a
 * rectangle, against a backend that draws nothing, so only the engine (hooks, renders, the tree walk, the
 * draw list, collisions) is measured, not the GPU. The same file runs under Node and, bundled, under the
 * Rust host (QuickJS-ng):
 *
 *   node packages/player/bench/frame.ts
 *   npm run bundle -- packages/player/bench/frame.ts host/dist/bench.js && host/target/release/rge-host host/dist/bench.js
 */
import { Collider, Entity, Shape } from "@rge/runtime";
import { createPlayer, RGE_IN_DT, RGE_IN_QUIT, type Backend } from "@rge/player";

/** A backend that draws nothing and reports a steady 60 fps. */
const nothing: Backend = {
  open() {},
  close() {},
  loadTexture: () => 0,
  loadSound: () => 0,
  playSound() {},
  frame(_clear, _records, _length, _texts, input) {
    input[RGE_IN_DT] = 1 / 60;
    input[RGE_IN_QUIT] = 0;
  },
};

/** Moves on every update, like a sprite with a script. */
class Mover extends Entity {
  override onUpdate(dt: number): void {
    this.transform.x += dt * 30;
    this.transform.y += dt * 10;
  }
}

function measure(n: number, withColliders: boolean): number {
  const player = createPlayer(nothing, {
    width: 800,
    height: 600,
    title: "bench",
    root: () => {
      const root = new Entity();
      const side = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const mover = new Mover();
        mover.transform.x = (i % side) * 14;
        mover.transform.y = Math.floor(i / side) * 14;
        mover.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
        if (withColliders) mover.addChild(new Collider({ width: 10, height: 10 }));
        root.addChild(mover);
      }
      return root;
    },
  });
  for (let i = 0; i < 10; i++) player.step(); // warm up
  const frames = n >= 5000 ? 30 : 100;
  const start = Date.now();
  for (let i = 0; i < frames; i++) player.step();
  const elapsed = Date.now() - start;
  player.close();
  return elapsed / frames;
}

for (const [n, withColliders] of [[500, false], [2000, false], [5000, false], [500, true], [2000, true]] as const) {
  console.log(`${String(n).padStart(5)} moving rects${withColliders ? " with colliders" : "              "}: ${measure(n, withColliders).toFixed(2)} ms per frame`);
}
