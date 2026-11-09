import { GameObject } from "../GameObject.ts";

/** The shapes a `<Shape>` can be. The manifest's `intrinsicLiterals` reads this list, so the compiler cannot drift from it. */
export const SHAPE_KINDS = ["rect", "circle"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeProps {
  kind: ShapeKind;
  /** Pixels. For a circle, the diameter across (an ellipse when `width` and `height` differ). */
  width: number;
  height: number;
  /** A CSS color. Default white. */
  color?: string;
}

export const DEFAULT_SHAPE_COLOR = "white";

/**
 * A filled rectangle or circle, for debugging colliders and prototyping before
 * art exists. The mock draws nothing: a renderer reads the fields and
 * `worldTransform()`, and the shape's top-left corner is its origin, like a
 * `Sprite`'s.
 */
export class Shape<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  kind: ShapeKind;
  width: number;
  height: number;
  color: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ShapeProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.kind = hostProps.kind;
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.color = hostProps.color ?? DEFAULT_SHAPE_COLOR;
  }
}
