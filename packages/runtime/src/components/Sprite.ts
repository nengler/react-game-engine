import { GameObject } from "../GameObject.ts";

export interface SpriteProps {
  image: string;
}

export class Sprite extends GameObject {
  image: string;

  constructor(props: SpriteProps) {
    super();
    this.image = props.image;
  }
}
