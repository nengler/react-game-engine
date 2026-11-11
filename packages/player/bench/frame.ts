/**
 * How long a frame of script takes: `createPlayer(...).step()` with `n` moving entities, each drawn as a
 * rectangle, against a backend that draws nothing, so only the engine (hooks, renders, the tree walk, the
 * draw list, collisions) is measured, not the GPU. Movers either set their transform directly, or move the way
 * compiled components do (state setters, a render each frame). One scene piles 300 colliders on one spot, every
 * pair touching, which is the worst case for collisions. The same file runs under Node and, bundled, under the
 * Rust host (QuickJS-ng). A mover that writes its transform in a hook (`Mover`) is the hand-written case, which the player
 * redraws every frame; one that moves by state (`StateMover`) is a compiled component, which it reuses around while it stands still:
 *
 *   node packages/player/bench/frame.ts
 *   npm run bundle -- packages/player/bench/frame.ts host/dist/bench.js && host/target/release/rge-host host/dist/bench.js
 *
 * `npm run bench:check` runs it under both and fails when a scene is over its budget in `budget.json` (CI does).
 */
import { AnimatedSprite, Collider, Entity, Shape, Sprite, World } from "@rge/runtime";
import { CollisionTracker, createPlayer, FrameBuilder, HOST_BACKEND_KEY, PlayerInput, RGE_IN_DT, RGE_IN_QUIT, Warner, type Backend } from "@rge/player";

/**
 * The host's broad phase for collisions, when the bench runs under a host that has one (the Rust host): a player there asks
 * it which boxes overlap instead of sweeping in script. Under plain `node` there is no host, and the script's sweep is measured.
 */
const hostBackend = (globalThis as { [HOST_BACKEND_KEY]?: Backend })[HOST_BACKEND_KEY];
// Bound: the Node host's backend is a class whose `overlaps` reads its own fields (the Rust host's is a plain function).
const hostOverlaps = hostBackend?.overlaps?.bind(hostBackend);

/** A backend that draws nothing and reports a steady 60 fps. */
const nothing: Backend = {
  overlaps: hostOverlaps,
  open() {},
  close() {},
  loadTexture: () => 0,
  textureSize: () => ({ width: 56, height: 56 }),
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

/** Moves the way a compiled component does: `useUpdate` calls state setters, and a render applies the state. */
class StateMover extends Entity {
  /** What the compiler writes on every component: its draw state changes only in `render()`, so its draw records may be reused while it stands still. */
  static readonly managed = true;
  x = 0;
  #xNext = 0;
  y = 0;
  #yNext = 0;
  setX(value: number | ((previous: number) => number)): void {
    const next = typeof value === "function" ? value(this.#xNext) : value;
    if (next === this.#xNext) return;
    this.#xNext = next;
    this.markDirty();
  }
  setY(value: number | ((previous: number) => number)): void {
    const next = typeof value === "function" ? value(this.#yNext) : value;
    if (next === this.#yNext) return;
    this.#yNext = next;
    this.markDirty();
  }
  override commitState(): void {
    this.x = this.#xNext;
    this.y = this.#yNext;
  }
  override onUpdate(dt: number): void {
    // `setX((x) => x + dt * 30)`, as the compiler writes an updater of one expression in a hook.
    {
      const x = this.#xNext;
      this.#xNext = x + dt * 30;
      if (this.#xNext !== x) this.markDirty();
    }
    {
      const y = this.#yNext;
      this.#yNext = y + dt * 10;
      if (this.#yNext !== y) this.markDirty();
    }
  }
  /** As generated: `render()` says what it changed, here only where the component is. */
  protected override readonly reportsChanges = true;
  override render(): void {
    const $t = this.transform;
    let $moved = false;
    const $x = this.x;
    if ($t.x !== $x) {
      $t.x = $x;
      $moved = true;
    }
    const $y = this.y;
    if ($t.y !== $y) {
      $t.y = $y;
      $moved = true;
    }
    if ($moved) this.markMoved();
  }
}

/**
 * A compiled component with an animated, styled sprite, like Hearth's enemy: moved by state, and on each render it also writes the
 * sprite's `flipX` and `tint` (a hit flash), the way `<AnimatedSprite flipX={left} tint={flash > 0 ? … : …} />` does.
 */
class AnimatedMover extends StateMover {
  readonly sprite = new AnimatedSprite({ sheet: "walk.png", frameWidth: 14, frameHeight: 14, animations: "walk:0-3@8", animation: "walk", originX: 7, originY: 7 });
  constructor() {
    super();
    this.addChild(this.sprite);
  }
  override render(): void {
    super.render();
    const flip = Math.floor(this.x / 4) % 2 === 0;
    const tint = Math.floor(this.x / 2) % 2 === 0 ? "#ffffff" : "#9ee7ff";
    if (this.sprite.flipX !== flip || this.sprite.tint !== tint) {
      this.sprite.flipX = flip;
      this.sprite.tint = tint;
      this.sprite.markChanged();
    }
  }
}

interface Scene {
  readonly n: number;
  /** The movers are animated, styled sprites (`AnimatedMover`) instead of rects. */
  readonly animated?: boolean;
  /** Hearth's wave 10 built from shapes: `n` enemies, 20 towers (a base, a barrel and a ring each) and 50 shots, all moving by state. */
  readonly tower?: boolean;
  readonly colliders?: boolean;
  readonly state?: boolean;
  readonly pile?: boolean;
  /** How many of the `n` entities move; the rest are still. Default all of them. */
  readonly moving?: number;
  /** Sweep in script even under a host with a broad phase of its own. */
  readonly scriptSweep?: boolean;
}

/** 80 animated enemies, 20 towers and 50 shots, built from engine pieces so the bench does not depend on the game package. */
function buildTowerScene(enemies: number): Entity {
  const root = new Entity();
  for (let i = 0; i < enemies; i++) {
    const e = new AnimatedMover();
    e.setX((i % 40) * 6);
    e.setY(Math.floor(i / 40) * 30 + 20);
    root.addChild(e);
  }
  for (let i = 0; i < 20; i++) {
    const t = new Entity();
    t.transform.x = (i % 10) * 24;
    t.transform.y = Math.floor(i / 10) * 60 + 5;
    t.addChild(new Sprite({ image: "base.png", frameWidth: 12, frameHeight: 12, frame: i % 9 }));
    const barrel = new Sprite({ image: "barrel.png", frameWidth: 12, frameHeight: 12, frame: i % 9, originX: 6, originY: 6 });
    barrel.transform.rotation = i * 0.3;
    t.addChild(barrel);
    t.addChild(new Shape({ kind: "circle", width: 60, height: 60, color: "#ffffff22" }));
    root.addChild(t);
  }
  for (let i = 0; i < 50; i++) {
    const shot = new StateMover();
    shot.setX(i * 5);
    shot.setY(40 + (i % 5) * 20);
    shot.addChild(new Sprite({ image: "shot.png", frameWidth: 8, frameHeight: 8, frame: 0, originX: 4, originY: 4 }));
    root.addChild(shot);
  }
  return root;
}

function buildScene({ n, animated = false, tower = false, colliders: withColliders = false, state = false, pile = false, moving = n }: Scene): Entity {
  if (tower) return buildTowerScene(n);
  const root = new Entity();
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const x = pile ? 0 : (i % side) * 14;
    const y = pile ? 0 : Math.floor(i / side) * 14;
    const mover = i >= moving ? new Entity() : animated ? new AnimatedMover() : state ? new StateMover() : new Mover();
    mover.transform.x = x;
    mover.transform.y = y;
    if (mover instanceof StateMover) {
      mover.setX(x);
      mover.setY(y);
    }
    if (!animated) mover.addChild(new Shape({ kind: "rect", width: 10, height: 10 }));
    if (withColliders) mover.addChild(new Collider({ width: 10, height: 10 }));
    root.addChild(mover);
  }
  return root;
}

function measure(scene: Scene): number {
  const { n } = scene;
  const player = createPlayer(scene.scriptSweep ? { ...nothing, overlaps: undefined } : nothing, { width: 800, height: 600, title: "bench", root: () => buildScene(scene) });
  for (let i = 0; i < 10; i++) player.step(); // warm up
  const frames = n >= 5000 ? 30 : 100;
  const start = Date.now();
  for (let i = 0; i < frames; i++) player.step();
  const elapsed = Date.now() - start;
  player.close();
  return elapsed / frames;
}

/** Where a frame's time goes, by the three phases `step()` runs: the tick (hooks, state, renders), the tree walk and draw list, and collisions. Milliseconds per frame. */
function phases(scene: Scene): { tick: number; walk: number; collisions: number } {
  const world = new World();
  const builder = new FrameBuilder({ loadTexture: () => 0 });
  const tracker = new CollisionTracker(undefined, true, true, scene.scriptSweep ? undefined : hostOverlaps);
  world.mount(buildScene(scene));
  const input = new PlayerInput(new Warner());
  const run = (): [number, number, number] => {
    const t0 = Date.now();
    world.tick(1 / 60, input);
    const t1 = Date.now();
    const built = builder.build(world.root, 800, 600);
    const t2 = Date.now();
    tracker.update(world, built.colliders);
    return [t1 - t0, t2 - t1, Date.now() - t2];
  };
  for (let i = 0; i < 10; i++) run();
  const frames = scene.n >= 5000 ? 30 : 100;
  const total = [0, 0, 0];
  for (let i = 0; i < frames; i++) run().forEach((ms, k) => (total[k] = (total[k] as number) + ms));
  return { tick: (total[0] as number) / frames, walk: (total[1] as number) / frames, collisions: (total[2] as number) / frames };
}

const scenes: [string, Scene][] = [
  ["500 moving rects", { n: 500 }],
  ["2000 moving rects", { n: 2000 }],
  ["5000 moving rects", { n: 5000 }],
  ["2000 rects moved by state", { n: 2000, state: true }],
  ["2000 rects by state with colliders", { n: 2000, state: true, colliders: true }],
  ["2000 still rects", { n: 2000, moving: 0 }],
  ["2000 rects, 20 moving, colliders", { n: 2000, moving: 20, colliders: true }],
  ["2000 still rects with colliders", { n: 2000, moving: 0, colliders: true }],
  ["2000 rects, 20 moving by state, colliders", { n: 2000, moving: 20, state: true, colliders: true }],
  ["500 moving rects with colliders", { n: 500, colliders: true }],
  ["2000 moving rects with colliders", { n: 2000, colliders: true }],
  ["300 colliders in one pile", { n: 300, colliders: true, pile: true }],
  // Hearth's finding 9: many styled, animated sprites, each re-rendered by state every step.
  ["200 animated sprites by state", { n: 200, animated: true, state: true }],
  ["80 enemies, 20 towers, 50 shots", { n: 80, tower: true }],
];
// Under a host with a broad phase, the same scenes with the script's sweep, to compare.
if (hostOverlaps !== undefined) {
  scenes.push(["2000 by state with colliders, script sweep", { n: 2000, state: true, colliders: true, scriptSweep: true }]);
  scenes.push(["300 in one pile, script sweep", { n: 300, colliders: true, pile: true, scriptSweep: true }]);
}
/** How long building and mounting a scene takes (`createPlayer` up to the first frame), in ms: a mount that turns quadratic shows here. */
function mount(scene: Scene): number {
  const start = Date.now();
  const player = createPlayer(nothing, { width: 800, height: 600, title: "bench", root: () => buildScene(scene) });
  const elapsed = Date.now() - start;
  player.close();
  return elapsed;
}

console.log(hostOverlaps === undefined ? "collisions: the script's sweep" : "collisions: the host's broad phase");
for (const [name, scene] of scenes) console.log(`${name.padEnd(35)}: ${measure(scene).toFixed(2)} ms per frame`);
// The middle of three, since one mount is a single short measurement.
for (const n of [5000, 20000]) {
  const runs = [0, 1, 2].map(() => mount({ n })).sort((a, b) => a - b);
  console.log(`${`mount ${n} rects`.padEnd(35)}: ${(runs[1] as number).toFixed(2)} ms once`);
}
for (const [name, scene] of [scenes[3], scenes[4], scenes[6], scenes[7], scenes[8], ...scenes.slice(12, 14)] as [string, Scene][]) {
  const p = phases(scene);
  console.log(`  ${name} by phase: tick ${p.tick.toFixed(2)}, walk ${p.walk.toFixed(2)}, collisions ${p.collisions.toFixed(2)} ms`);
}
