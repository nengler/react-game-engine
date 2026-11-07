import { GameObject } from "../GameObject.ts";

export interface SpriteProps {
  image: string;
}

export class Sprite extends GameObject {
  static override readonly intrinsic = true;

  image: string;

  constructor(props: SpriteProps) {
    super();
    this.image = props.image;
  }
}
