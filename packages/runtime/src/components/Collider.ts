import { GameObject } from "../GameObject.ts";

export interface ColliderProps {
  width: number;
  height: number;
  /**
   * Called when this collider starts touching another (see
   * `World.reportCollision`), with the collider it touched. It is the
   * collider's own callback, so a component with several colliders knows which
   * one was hit.
   */
  onCollisionEnter?: (other: GameObject) => void;
}

export class Collider<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  onCollisionEnter: ((other: GameObject) => void) | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ColliderProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.onCollisionEnter = hostProps.onCollisionEnter;
  }
}
