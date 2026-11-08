import { GameObject } from "../GameObject.ts";
import { IDENTITY_TRANSFORM, Transform, composeTransforms, type WorldTransform } from "../Transform.ts";

export interface EntityProps {
  name?: string;
}

/** A named container. Compiled components extend Entity. */
export class Entity extends GameObject {
  static override readonly intrinsic = true;

  name: string;
  /** Position, rotation and scale relative to the nearest ancestor Entity (unless `global`); set with the `transform={{ x, y }}` attribute. */
  readonly transform: Transform = new Transform();

  constructor(props: EntityProps = {}) {
    super();
    this.name = props.name ?? "";
  }

  /** This entity's transform in world space: its own, composed with every ancestor Entity's (see `Transform`). */
  worldTransform(): WorldTransform {
    let ancestor = this.parent;
    while (ancestor !== null && !(ancestor instanceof Entity)) ancestor = ancestor.parent;
    const parent = ancestor instanceof Entity ? ancestor.worldTransform() : IDENTITY_TRANSFORM;
    return composeTransforms(parent, this.transform);
  }
}
