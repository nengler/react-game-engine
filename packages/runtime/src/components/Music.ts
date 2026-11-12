import { GameObject } from "../GameObject.ts";
import type { InputState } from "../input.ts";
import { getSoundSink, getVolume } from "../Sound.ts";

export interface MusicProps {
  /** The music file, a path relative to the assets folder. It streams from the file, so it can be long (an `.ogg`, `.mp3` or `.wav`). */
  src: string;
  /** Whether it plays. Turning it off fades it out and then stops the stream; turning it on again starts it from the beginning, fading in. Default true. */
  playing?: boolean;
  /** 0 to 1. Default 1. A change fades to the new level over `fade` seconds. */
  volume?: number;
  /** Whether it repeats. Default true. */
  loop?: boolean;
  /** Seconds a full fade (from silence to `volume`, or back) takes. Default 0.5. 0 switches at once. */
  fade?: number;
}

/**
 * Music that streams, loops, stops and fades, and that lives as long as the component that holds it: put it in a root that is
 * never removed (the `<Game>`'s screen) and it keeps playing while rooms and screens come and go. A leaf with no position.
 * It follows `playing`, `volume` and `fade` in `onUpdate` (so, like everything, at the fixed timestep) and tells the player's
 * sound sink; the sink opens the stream when the object is made, so playing does not hitch.
 */
export class Music<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  src: string;
  playing: boolean;
  volume: number;
  loop: boolean;
  fade: number;
  /** The volume it is playing at right now, 0 while silent. */
  level = 0;
  #started = false;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: MusicProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.src = hostProps.src;
    this.playing = hostProps.playing ?? true;
    this.volume = hostProps.volume ?? 1;
    this.loop = hostProps.loop ?? true;
    this.fade = hostProps.fade ?? 0.5;
    if (this.src !== undefined) getSoundSink()?.loadMusic?.(this.src);
  }

  /** Whether the stream is going (it may be fading out). */
  get started(): boolean {
    return this.#started;
  }

  /** The music group's volume last sent to the stream, so a change of it is heard at once even while the level holds still. */
  #group = 1;

  override onUpdate(dt: number, _input?: InputState): void {
    const sink = getSoundSink();
    if (this.src === undefined || this.src === "") return;
    const goal = this.playing ? Math.min(1, Math.max(0, this.volume)) : 0;
    if (goal > 0 && !this.#started) {
      this.#started = true;
      this.level = this.fade > 0 ? 0 : goal;
      this.#group = getVolume("music");
      sink?.playMusic?.(this.src, this.level * this.#group, this.loop);
    }
    if (!this.#started) return;
    const group = getVolume("music");
    if (this.level !== goal) {
      const step = this.fade > 0 ? Math.max(0, dt) / this.fade : 1;
      this.level = this.level < goal ? Math.min(goal, this.level + step) : Math.max(goal, this.level - step);
      this.#group = group;
      sink?.setMusicVolume?.(this.src, this.level * group);
    } else if (group !== this.#group) {
      this.#group = group;
      sink?.setMusicVolume?.(this.src, this.level * group);
    }
    if (this.level === 0 && goal === 0) {
      this.#started = false;
      sink?.stopMusic?.(this.src);
    }
  }
}
