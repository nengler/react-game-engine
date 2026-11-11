import { GameObject } from "../GameObject.ts";
import type { Afterimages } from "../effects.ts";
import type { InputState } from "../input.ts";

export interface AfterimageLayerProps {
  /** Whose afterimages to draw: a `createAfterimages()`, also given to the sprite it copies. */
  afterimages: Afterimages;
  /** While true, a copy is taken when it turns on and every `interval` seconds after. Default false: only `capture()`. */
  emitting?: boolean;
  /** Seconds between copies while emitting. Default 0.08. */
  interval?: number;
}

/**
 * Where a sprite's afterimages are drawn: in the world, each where the sprite was when it was copied, tinted and fading. Put it
 * in the world's space (next to a `<Camera>`, not inside it) and below or above the sprite as wanted. It takes copies while
 * `emitting`, ages them in `onUpdate` (so they follow the fixed timestep and stop while the world is frozen), and draws again
 * while any are alive. A leaf.
 */
export class AfterimageLayer<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  afterimages: Afterimages;
  emitting: boolean;
  interval: number;
  #timer = 0;
  #wasEmitting = false;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: AfterimageLayerProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.afterimages = hostProps.afterimages;
    this.emitting = hostProps.emitting ?? false;
    this.interval = hostProps.interval ?? 0.08;
  }

  override onUpdate(dt: number, _input?: InputState): void {
    // Age what is there first, so a copy taken this step starts at 0.
    let changed = this.afterimages.advance(dt);
    if (this.emitting) {
      if (!this.#wasEmitting) {
        this.afterimages.capture();
        this.#timer = 0;
      } else {
        this.#timer += dt;
        if (this.interval > 0 && this.#timer >= this.interval) {
          this.#timer -= this.interval;
          this.afterimages.capture();
        }
      }
    }
    this.#wasEmitting = this.emitting;
    // A copy taken by `capture()` elsewhere, or here, is a change too.
    if (this.afterimages.advance(0)) changed = true;
    if (changed) this.markChanged();
  }
}
