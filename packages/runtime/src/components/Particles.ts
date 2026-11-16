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
  /**
   * An area particles start anywhere in, from the emitter's position right and down, in pixels: dust in a room, snow across the
   * screen. Default 0 by 0, a point.
   */
  width?: number;
  height?: number;
  /** Start as if it had been emitting for a whole lifetime already, so a room's dust is there when the room is. Default false. */
  prewarm?: boolean;
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
  width: number;
  height: number;
  prewarm: boolean;

  // x, y, vx, vy, age, life, colours per particle. Colours: 0 for the emitter's own, or 1 + an index into #colors.
  #data: Float64Array;
  /** The colours of bursts made with their own (`emitAt`'s `colors`), each pair once; emptied whenever no particle is alive. */
  #colors: ParticleColors[] = [];
  #count = 0;
  #carry = 0;
  #wasEmitting = false;
  #warmed = false;
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
    this.width = hostProps.width ?? 0;
    this.height = hostProps.height ?? 0;
    this.prewarm = hostProps.prewarm ?? false;
    this.#data = new Float64Array(this.max * STRIDE);
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
    const at = i * STRIDE;
    out.x = d[at] as number;
    out.y = d[at + 1] as number;
    out.t = (d[at + 4] as number) / (d[at + 5] as number);
  }

  /** Whether some live particle has colours of its own (from a burst given them), so a renderer must ask `colorsOf`. */
  get hasOwnColors(): boolean {
    return this.#colors.length > 0;
  }

  /** Particle `i`'s colours: its burst's own, or null for the emitter's (`color` and `endColor`). */
  colorsOf(i: number): ParticleColors | null {
    const k = this.#data[i * STRIDE + 6] as number;
    return k === 0 ? null : (this.#colors[k - 1] ?? null);
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
   * going `angle` degrees (default: the emitter's), in `colors` if given (each one given replaces the emitter's: a burst given
   * only `color` and an emitter with no `endColor` stays that colour). How a `<ParticleLayer>` makes a burst wherever it is asked to.
   */
  emitAt(n: number, originX: number, originY: number, direction: number = this.angle, colors?: Partial<ParticleColors>): void {
    if (this.max * STRIDE > this.#data.length) this.#data = grow(this.#data, this.max * STRIDE);
    const paint = n > 0 && colors !== undefined ? this.#colorIndex(colors) : 0;
    for (let k = 0; k < n; k++) {
      const slot = this.#count < this.max ? this.#count++ : 0; // full: the first one is replaced
      const angle = ((direction + (this.#random() * 2 - 1) * this.spread) * Math.PI) / 180;
      const speed = this.speed * (0.6 + this.#random() * 0.4);
      const at = slot * STRIDE;
      const d = this.#data;
      // A point uses no randomness for its place, so emitters without an area repeat exactly as they always have.
      d[at] = this.width > 0 ? originX + this.#random() * this.width : originX;
      d[at + 1] = this.height > 0 ? originY + this.#random() * this.height : originY;
      d[at + 2] = Math.cos(angle) * speed;
      d[at + 3] = Math.sin(angle) * speed;
      d[at + 4] = 0;
      d[at + 5] = Math.max(1e-6, this.lifetime * (0.75 + this.#random() * 0.25));
      d[at + 6] = paint;
    }
    if (n > 0) this.markChanged();
  }

  /** The colours' number for a particle: 0 when they are the emitter's own, or 1 + their place in #colors (added if new). */
  #colorIndex(colors: Partial<ParticleColors>): number {
    const color = colors.color ?? this.color;
    const endColor = colors.endColor ?? this.endColor;
    if (color === this.color && endColor === this.endColor) return 0;
    const list = this.#colors;
    for (let k = 0; k < list.length; k++) {
      const known = list[k] as ParticleColors;
      if (known.color === color && known.endColor === endColor) return k + 1;
    }
    list.push({ color, endColor });
    return list.length;
  }

  override onUpdate(dt: number, _input?: InputState): void {
    if (!(dt > 0)) return;
    if (this.prewarm && !this.#warmed && this.emitting && this.rate > 0) this.#warm();
    this.#warmed = true;
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
      const at = i * STRIDE;
      const age = (d[at + 4] as number) + dt;
      if (age >= (d[at + 5] as number)) continue;
      const to = live * STRIDE;
      const vy = (d[at + 3] as number) + this.gravity * dt;
      d[to] = (d[at] as number) + (d[at + 2] as number) * dt;
      d[to + 1] = (d[at + 1] as number) + vy * dt;
      d[to + 2] = d[at + 2] as number;
      d[to + 3] = vy;
      d[to + 4] = age;
      d[to + 5] = d[at + 5] as number;
      d[to + 6] = d[at + 6] as number;
      live++;
    }
    this.#count = live;
    if (live === 0) this.#colors.length = 0;
    this.markChanged();
  }

  /** Fill in a lifetime's worth of particles, each as far through its life (and its path) as if it had been made then. */
  #warm(): void {
    const n = Math.min(this.max, Math.floor(this.rate * this.lifetime));
    const start = this.#count;
    this.emit(n);
    const d = this.#data;
    for (let i = start; i < this.#count; i++) {
      const at = i * STRIDE;
      const age = this.#random() * (d[at + 5] as number);
      d[at] = (d[at] as number) + (d[at + 2] as number) * age;
      d[at + 1] = (d[at + 1] as number) + (d[at + 3] as number) * age + 0.5 * this.gravity * age * age;
      d[at + 3] = (d[at + 3] as number) + this.gravity * age;
      d[at + 4] = age;
    }
  }
}

/** Numbers kept per particle: x, y, vx, vy, age, life, colours. */
const STRIDE = 7;

/** The colours of one burst: what `color` and `endColor` are for its particles (see `ParticlesProps`). */
export interface ParticleColors {
  readonly color: string;
  readonly endColor: string | undefined;
}

function grow(old: Float64Array, length: number): Float64Array {
  const next = new Float64Array(length);
  next.set(old);
  return next;
}
