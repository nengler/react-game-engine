import { GameObject } from "../GameObject.ts";
import type { BurstOptions, ParticleRenderer, ParticleStore } from "../effects.ts";
import { Particles } from "./Particles.ts";

export interface ParticleLayerProps {
  /** The store whose bursts this layer draws: `createParticles({ … })`, kept in a `.ts` module. */
  particles: ParticleStore;
}

/**
 * Where a particle store's bursts are drawn, as a `<Toaster />` is where a toast library's toasts are: mount it once, in the
 * space the bursts are given in (inside a `<Camera>`, so a burst at the character's world position is drawn there), and call
 * `fx.burst("dust", x, y)` from anywhere. A burst belongs to the layer, not to whoever asked for it, so it plays out even if
 * that leaves the world. It holds one emitter per kind of burst, drawn in the order the store names them, and stops with
 * the world when it is frozen. A leaf.
 */
export class ParticleLayer<P extends object = {}> extends GameObject<P> implements ParticleRenderer {
  static override readonly intrinsic = true;

  readonly particles: ParticleStore;
  readonly #emitters = new Map<string, Particles>();

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ParticleLayerProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.particles = hostProps.particles;
    let seed = 1;
    for (const [name, preset] of Object.entries(this.particles.presets)) {
      const emitter = new Particles({ seed: seed++, ...preset, rate: 0, emitting: false, space: "local" });
      this.#emitters.set(name, emitter);
      this.addChild(emitter);
    }
  }

  emitBurst(name: string, x: number, y: number, options: BurstOptions | undefined): void {
    const emitter = this.#emitters.get(name);
    if (emitter === undefined) return;
    emitter.emitAt(options?.count ?? emitter.burst, x, y, options?.angle ?? emitter.angle);
  }

  override onMount(): void {
    this.particles.attach(this);
  }

  override onUnmount(): void {
    this.particles.detach(this);
  }
}
