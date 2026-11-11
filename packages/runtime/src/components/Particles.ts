import { GameObject } from "../GameObject.ts";
import type { InputState } from "../input.ts";

export interface ParticlesProps {
  /** Particles per second while `emitting`. Default 0 (only `burst`). */
  rate?: number;
  /** Particles made at once when `emitting` turns on. Default 0. */
  burst?: number;
  /** Seconds a particle lives. Default 0.5. */
  lifetime?: number;
  /** Starting speed in pixels per second. Default 40. */
  speed?: number;
  /** Direction in degrees: 0 right, 90 down, 180 left, 270 up. Default 270 (up). */
  angle?: number;
  /** How far either side of `angle` a particle may go, in degrees. Default 30. 180 sends them in every direction. */
  spread?: number;
  /** Acceleration down the screen, in pixels per second squared. Negative floats up. Default 0. */
  gravity?: number;
  /** A CSS colour. Default white. */
  color?: string;
  /** A particle's colour at the end of its life, mixed in as it ages. Default: `color` throughout. */
  endColor?: string;
  /** The square's side, in pixels. Default 2. */
  size?: number;
  /** Make a particle smaller as it ages, to nothing at the end. */
  shrink?: boolean;
  /** Make a particle more transparent as it ages, to nothing at the end. */
  fade?: boolean;
  /** Whether it makes particles. Default true. Particles already in the air carry on. */
  emitting?: boolean;
  /** The most particles alive at once (the oldest is replaced). Default 64. */
  max?: number;
  /** `"local"` (the default): particles move with the emitter. `"world"`: they stay where they were made, as a trail does. */
  space?: "local" | "world";
  /** Seeds the randomness, so a run repeats exactly. Default 1. */
  seed?: number;
}

export const PARTICLE_SPACES = ["local", "world"] as const;

const DEFAULT_MAX = 64;

/** A small deterministic generator (mulberry32): the same seed gives the same particles under every engine. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An emitter of small squares: dust, a dash's trail, a death. Particles live in flat arrays inside this one object, so a
 * thousand of them cost no game objects. It simulates in `onUpdate` (so it follows the fixed timestep and stops while the
 * world is frozen) and reports a change each tick it has particles, which is how the player knows to redraw it. The
 * player reads `count` and `read` to draw. A leaf.
 */
export class Particles<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  rate: number;
  burst: number;
  lifetime: number;
  speed: number;
  angle: number;
  spread: number;
  gravity: number;
  color: string;
  endColor: string | undefined;
  size: number;
  shrink: boolean;
  fade: boolean;
  emitting: boolean;
  max: number;
  space: "local" | "world";
  seed: number;

  // x, y, vx, vy, age, life per particle.
  #data: Float64Array;
  #count = 0;
  #carry = 0;
  #wasEmitting = false;
  #random: () => number;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ParticlesProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.rate = hostProps.rate ?? 0;
    this.burst = hostProps.burst ?? 0;
    this.lifetime = hostProps.lifetime ?? 0.5;
    this.speed = hostProps.speed ?? 40;
    this.angle = hostProps.angle ?? 270;
    this.spread = hostProps.spread ?? 30;
    this.gravity = hostProps.gravity ?? 0;
    this.color = hostProps.color ?? "white";
    this.endColor = hostProps.endColor;
    this.size = hostProps.size ?? 2;
    this.shrink = hostProps.shrink ?? false;
    this.fade = hostProps.fade ?? false;
    this.emitting = hostProps.emitting ?? true;
    this.max = Math.max(1, Math.floor(hostProps.max ?? DEFAULT_MAX));
    this.space = hostProps.space ?? "local";
    this.seed = hostProps.seed ?? 1;
    this.#data = new Float64Array(this.max * 6);
    this.#random = makeRandom(this.seed);
    // Not on yet, so a particle emitter that starts emitting bursts as it joins the world: `{dead && <Particles burst={12} />}` is a death.
    this.#wasEmitting = false;
  }

  /** How many particles are alive. */
  get count(): number {
    return this.#count;
  }

  /** Particle `i`'s position (in the emitter's space, or the world's for `space="world"`) and how far through its life it is, 0 to 1. */
  read(i: number, out: { x: number; y: number; t: number }): void {
    const d = this.#data;
    const at = i * 6;
    out.x = d[at] as number;
    out.y = d[at + 1] as number;
    out.t = (d[at + 4] as number) / (d[at + 5] as number);
  }

  /** Make `n` particles now, at the emitter. */
  emit(n: number): void {
    let originX = 0;
    let originY = 0;
    if (this.space === "world") {
      const at = this.worldTransform();
      originX = at.x;
      originY = at.y;
    }
    this.emitAt(n, originX, originY);
  }

  /**
   * Make `n` particles now at (`x`, `y`) in the space they live in (the emitter's own, or the world's for `space="world"`),
   * going `angle` degrees (default: the emitter's). How a `<ParticleLayer>` makes a burst wherever it is asked to.
   */
  emitAt(n: number, originX: number, originY: number, direction: number = this.angle): void {
    if (this.max * 6 > this.#data.length) this.#data = grow(this.#data, this.max * 6);
    for (let k = 0; k < n; k++) {
      const slot = this.#count < this.max ? this.#count++ : 0; // full: the first one is replaced
      const angle = ((direction + (this.#random() * 2 - 1) * this.spread) * Math.PI) / 180;
      const speed = this.speed * (0.6 + this.#random() * 0.4);
      const at = slot * 6;
      const d = this.#data;
      d[at] = originX;
      d[at + 1] = originY;
      d[at + 2] = Math.cos(angle) * speed;
      d[at + 3] = Math.sin(angle) * speed;
      d[at + 4] = 0;
      d[at + 5] = Math.max(1e-6, this.lifetime * (0.75 + this.#random() * 0.25));
    }
    if (n > 0) this.markChanged();
  }

  override onUpdate(dt: number, _input?: InputState): void {
    if (!(dt > 0)) return;
    if (this.emitting) {
      if (!this.#wasEmitting && this.burst > 0) this.emit(this.burst);
      if (this.rate > 0) {
        this.#carry += this.rate * dt;
        const n = Math.floor(this.#carry);
        if (n > 0) {
          this.#carry -= n;
          this.emit(n);
        }
      }
    } else this.#carry = 0;
    this.#wasEmitting = this.emitting;
    if (this.#count === 0) return;
    const d = this.#data;
    let live = 0;
    for (let i = 0; i < this.#count; i++) {
      const at = i * 6;
      const age = (d[at + 4] as number) + dt;
      if (age >= (d[at + 5] as number)) continue;
      const to = live * 6;
      const vy = (d[at + 3] as number) + this.gravity * dt;
      d[to] = (d[at] as number) + (d[at + 2] as number) * dt;
      d[to + 1] = (d[at + 1] as number) + vy * dt;
      d[to + 2] = d[at + 2] as number;
      d[to + 3] = vy;
      d[to + 4] = age;
      d[to + 5] = d[at + 5] as number;
      live++;
    }
    this.#count = live;
    this.markChanged();
  }
}

function grow(old: Float64Array, length: number): Float64Array {
  const next = new Float64Array(length);
  next.set(old);
  return next;
}
