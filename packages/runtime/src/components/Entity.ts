import { GameObject } from "../GameObject.ts";

export interface EntityProps {
  name?: string;
}

/** A named container. Compiled components extend Entity. */
export class Entity extends GameObject {
  static override readonly intrinsic = true;

  name: string;

  constructor(props: EntityProps = {}) {
    super();
    this.name = props.name ?? "";
  }
}
