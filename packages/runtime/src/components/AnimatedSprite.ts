import { GameObject } from "../GameObject.ts";

export interface AnimatedSpriteProps {
  /** The images to cycle through, in order. Must not be empty to show anything. */
  frames: readonly string[];
  /** Frames per second. Default 10. A value that is not positive and finite freezes the animation. */
  fps?: number;
  /** False freezes it on the current frame; true resumes from there. Default true. */
  playing?: boolean;
}

const DEFAULT_FPS = 10;

/**
 * A sprite that cycles through `frames` at `fps`, looping. The mock draws
 * nothing: a renderer reads `image`, which is the current frame, exactly as it
 * reads a `Sprite`'s. Playing is not state: advancing a frame does not
 * re-render anything, so an animation costs no renders.
 *
 * Setting `frames` to different contents restarts at the first frame; setting it
 * to the same contents (a new array that is equal, which is what a dynamic JSX
 * prop produces on every render) changes nothing.
 */
export class AnimatedSprite<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  fps: number;
  playing: boolean;
  /** Index of the current frame. */
  frame = 0;
  /** Time carried over toward the next frame, in seconds. */
  elapsed = 0;
  #frames: readonly string[];

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: AnimatedSpriteProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    // `frames` is required, but a component rooted at one whose frames vary gets `undefined` here (the generated
    // `super()` runs before state exists) and its real value in the first render.
    this.#frames = [...(hostProps.frames ?? [])];
    this.fps = hostProps.fps ?? DEFAULT_FPS;
    this.playing = hostProps.playing ?? true;
  }

  get frames(): readonly string[] {
    return this.#frames;
  }

  set frames(value: readonly string[] | undefined) {
    const next = value ?? [];
    if (next.length === this.#frames.length && next.every((image, i) => image === this.#frames[i])) return;
    this.#frames = [...next];
    this.frame = 0;
    this.elapsed = 0;
  }

  /** The current frame's image; empty when there are no frames. */
  get image(): string {
    return this.#frames[this.frame] ?? "";
  }

  /** Advance by `dt` seconds while playing. The World calls this every tick, since the class overrides it. */
  override onUpdate(dt: number): void {
    const count = this.#frames.length;
    if (!this.playing || count === 0 || !(this.fps > 0) || !Number.isFinite(this.fps) || !(dt > 0)) return;
    const step = 1 / this.fps;
    this.elapsed += dt;
    // The epsilon keeps 10 ticks of 0.1s at 10 fps from landing a rounding error short of the 10th frame.
    const steps = Math.floor((this.elapsed + 1e-9) / step);
    if (steps === 0) return;
    this.elapsed = Math.max(0, this.elapsed - steps * step);
    const next = (this.frame + steps) % count;
    if (next !== this.frame) this.markChanged();
    this.frame = next;
  }
}
