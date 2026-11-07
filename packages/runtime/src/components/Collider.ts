import { GameObject } from "../GameObject.ts";

export interface ColliderProps {
  width: number;
  height: number;
}

export class Collider extends GameObject {
  static override readonly intrinsic = true;

  width: number;
  height: number;

  constructor(props: ColliderProps) {
    super();
    this.width = props.width;
    this.height = props.height;
  }
}
