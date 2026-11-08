import { GameObject } from "../GameObject.ts";

export interface SpriteProps {
  image: string;
}

export class Sprite<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  image: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: SpriteProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.image = hostProps.image;
  }
}
