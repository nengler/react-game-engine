import { GameObject } from "../GameObject.ts";
import { Transform } from "../Transform.ts";

export interface EntityProps {
  name?: string;
}

/** A named container. Compiled components extend Entity. */
export class Entity extends GameObject {
  static override readonly intrinsic = true;

  name: string;
  /** Per-frame position data; see `useTransform`. */
  readonly transform: Transform = new Transform();

  constructor(props: EntityProps = {}) {
    super();
    this.name = props.name ?? "";
  }
}
