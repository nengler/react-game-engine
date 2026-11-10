import { GameObject } from "../GameObject.ts";

export interface FadeProps {
  /** A CSS colour the screen fades to. Default black. */
  color?: string;
  /** True fades the screen to `color`, false fades back. Default false: nothing is covered. */
  on?: boolean;
  /** Seconds a full fade takes, either way. Default 0.25. 0 switches at once. */
  duration?: number;
}

/**
 * A cover over the whole screen that fades in and out: put it in a `<Hud>` (it is drawn on that layer, over the world, in
 * screen pixels), and switch `on` for a death, a room change or a scene change. `amount` (0 clear, 1 covered) moves toward
 * the goal by `dt / duration` each update, so it follows the fixed timestep. Nothing is drawn while `amount` is 0.
 */
export class Fade<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  color: string;
  on: boolean;
  duration: number;
  /** How far covered it is now, 0 to 1. */
  amount = 0;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: FadeProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.color = hostProps.color ?? "black";
    this.on = hostProps.on ?? false;
    this.duration = hostProps.duration ?? 0.25;
  }

  override onUpdate(dt: number): void {
    const goal = this.on ? 1 : 0;
    if (this.amount === goal) return;
    const step = this.duration > 0 ? Math.max(0, dt) / this.duration : 1;
    this.amount = this.amount < goal ? Math.min(goal, this.amount + step) : Math.max(goal, this.amount - step);
    this.markChanged();
  }
}
