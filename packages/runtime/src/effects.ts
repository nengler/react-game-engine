import type { ParticlesProps } from "./components/Particles.ts";
import { addSoundPreload, Sound } from "./Sound.ts";

/**
 * Effects that happen at a moment rather than last as state: a burst of dust where the character landed, a sound, a shake of
 * the view. They work like a toast library: create one store per kind of effect in a `.ts` file, mount its renderer once
 * (`<ParticleLayer particles={fx} />`, `<Camera shake={shake}>`), and call it from anywhere: a game-state action, a plain
 * function, or a component's handler (`fx.burst("dust", x, y)`). What it makes outlives whoever asked for it.
 */

/** How one kind of burst looks: the `<Particles>` props, less the ones that belong to an emitter that stays. */
export type ParticlePreset = Omit<ParticlesProps, "rate" | "emitting" | "space">;

/** Changes to one burst. `angle` turns it (a wall jump's dust goes sideways), `count` overrides the preset's `burst`. */
export interface BurstOptions {
  readonly angle?: number;
  readonly count?: number;
}

/** What draws a particle store's bursts: the `<ParticleLayer>` mounted for it. */
export interface ParticleRenderer {
  emitBurst(name: string, x: number, y: number, options: BurstOptions | undefined): void;
}

/**
 * The bursts of particles a game makes, by name (`createParticles({ dust: { burst: 9, … } })`). `burst` makes one at a point in
 * the space of the `<ParticleLayer>` that draws them (inside a `<Camera>`, the world's). With no layer mounted a burst is
 * counted and nothing is drawn, as a sound with no speakers.
 */
export class ParticleStore<Name extends string = string> {
  readonly presets: Readonly<Record<Name, ParticlePreset>>;
  /** Bursts made so far, by name: what a test checks. */
  readonly bursts: Record<string, number> = {};
  #renderer: ParticleRenderer | null = null;

  constructor(presets: Readonly<Record<Name, ParticlePreset>>) {
    this.presets = presets;
  }

  /** Make the burst `name` at (`x`, `y`). */
  burst(name: Name, x: number, y: number, options?: BurstOptions): void {
    if (!Object.hasOwn(this.presets, name)) throw new Error(`There is no particle burst named '${name}' (there are: ${Object.keys(this.presets).join(", ")}).`);
    this.bursts[name] = (this.bursts[name] ?? 0) + 1;
    this.#renderer?.emitBurst(name, x, y, options);
  }

  /** The layer that draws this store's bursts now. One at a time: the last one mounted. */
  attach(renderer: ParticleRenderer): void {
    this.#renderer = renderer;
  }

  detach(renderer: ParticleRenderer): void {
    if (this.#renderer === renderer) this.#renderer = null;
  }
}

/** Make the game's particle bursts. Keep the result in a module (`export const fx = createParticles({ … })`). */
export function createParticles<const Presets extends Record<string, ParticlePreset>>(presets: Presets): ParticleStore<keyof Presets & string> {
  return new ParticleStore<keyof Presets & string>(presets);
}

/** One sound of a sound store: a file, or a file and the volume it plays at. */
export type SoundEntry = string | { readonly src: string; readonly volume?: number };

/**
 * The game's sounds, by name (`createSounds({ jump: "jump.wav", land: { src: "land.wav", volume: 0.5 } })`), played from
 * anywhere with `sfx.play("land")`. Each file is loaded when the player starts, so the first play does not hitch.
 */
export class SoundStore<Name extends string = string> {
  readonly #sounds: Record<string, { sound: Sound | null; src: string; volume: number }> = {};

  constructor(entries: Readonly<Record<Name, SoundEntry>>) {
    for (const [name, entry] of Object.entries<SoundEntry>(entries)) {
      const src = typeof entry === "string" ? entry : entry.src;
      this.#sounds[name] = { sound: null, src, volume: typeof entry === "string" ? 1 : (entry.volume ?? 1) };
      addSoundPreload(src);
    }
  }

  /** Play `name` at its volume, times `volume` (default 1). */
  play(name: Name, volume = 1): void {
    const entry = this.#sounds[name];
    if (entry === undefined) throw new Error(`There is no sound named '${name}' (there are: ${Object.keys(this.#sounds).join(", ")}).`);
    entry.sound ??= new Sound(entry.src);
    entry.sound.play(entry.volume * volume);
  }

  /** How many times `name` has been played: what a test checks. */
  plays(name: Name): number {
    return this.#sounds[name]?.sound?.plays ?? 0;
  }
}

/** Make the game's sounds. Keep the result in a module (`export const sfx = createSounds({ … })`). */
export function createSounds<const Entries extends Record<string, SoundEntry>>(entries: Entries): SoundStore<keyof Entries & string> {
  return new SoundStore<keyof Entries & string>(entries);
}

/**
 * A shake of the view, started from anywhere with `shake.start()` and drawn by the `<Camera shake={shake}>` that has it. Each
 * start throws the view by `strength` pixels and dies away over `duration` seconds; a start while one runs starts it again.
 */
export class Shake {
  strength: number;
  duration: number;
  /** Starts so far. The camera starts its shake when this changes. */
  starts = 0;

  constructor(strength: number, duration: number) {
    this.strength = strength;
    this.duration = duration;
  }

  /** Shake now, by `strength` pixels for `duration` seconds (default: the ones it was created with). */
  start(strength?: number, duration?: number): void {
    this.starts++;
    this.#next = { strength: strength ?? this.strength, duration: duration ?? this.duration };
  }

  #next = { strength: 0, duration: 0 };

  /** The strength and duration of the latest start. */
  get current(): { readonly strength: number; readonly duration: number } {
    return this.#next;
  }
}

/** Make a shake for a camera. Keep the result in a module (`export const shake = createShake({ strength: 3, duration: 0.25 })`). */
export function createShake(options: { strength?: number; duration?: number } = {}): Shake {
  return new Shake(options.strength ?? 2, options.duration ?? 0.2);
}

/** What a squash tells when it starts: the sprite that draws it, so the frame is drawn again. */
export interface SquashOwner {
  markChanged(): void;
}

/**
 * Squash and stretch: a sprite's scale thrown away from 1 at a moment (`squash.start(0.6, 1.4)` as a jump leaves the ground,
 * `start(1.6, 0.4)` on a hard landing) that springs back to 1 at `recover` a second, as Celeste's character does. Given to a
 * sprite as `<AnimatedSprite squash={squash}>`, it scales about the sprite's origin (put the origin at the feet), on top of
 * the transform's scale, and only the drawing: the hitbox does not change. The sprite that has it advances it, in `onUpdate`,
 * so it follows the fixed timestep and stops while the world is frozen.
 */
export class Squash {
  x = 1;
  y = 1;
  /** How fast each axis goes back to 1, in scale a second. */
  recover: number;
  #owner: SquashOwner | null = null;

  constructor(recover: number) {
    this.recover = recover;
  }

  /** Throw the scale to (`x`, `y`) now; it springs back from there. */
  start(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.#owner?.markChanged();
  }

  /** Back at 1 on both axes. */
  get resting(): boolean {
    return this.x === 1 && this.y === 1;
  }

  /** Spring back by `dt` seconds. Returns whether it moved. */
  advance(dt: number): boolean {
    if (this.resting || !(dt > 0)) return false;
    const step = this.recover * dt;
    this.x = this.x < 1 ? Math.min(1, this.x + step) : Math.max(1, this.x - step);
    this.y = this.y < 1 ? Math.min(1, this.y + step) : Math.max(1, this.y - step);
    return true;
  }

  /** The sprite drawing it now (the last one mounted), which is the one that advances it. */
  attach(owner: SquashOwner): void {
    this.#owner = owner;
  }

  detach(owner: SquashOwner): void {
    if (this.#owner === owner) this.#owner = null;
  }

  owns(owner: SquashOwner): boolean {
    return this.#owner === owner;
  }
}

/** Make a squash for a sprite. Keep the result in a module (`export const squash = createSquash()`). Celeste springs back at 1.75. */
export function createSquash(options: { recover?: number } = {}): Squash {
  return new Squash(options.recover ?? 1.75);
}
