import { GameObject } from "../GameObject.ts";

export interface LineProps {
  /** Where the line ends, in the same space as its `x` and `y` (its parent's): it is drawn from (`x`, `y`) to (`x2`, `y2`). */
  x2: number;
  y2: number;
  /** How thick it is, in pixels, centred on the line. Default 1. The ends are square. */
  width?: number;
  /** A CSS color. Default white. */
  color?: string;
}

const DEFAULT_LINE_COLOR = "white";

/**
 * A straight line from where it is placed to (`x2`, `y2`) in its parent's space: a shot's trace from attacker to target, a
 * tether, a laser. Its own `rotation` and `scale` do not move the end; a parent's turn and scale the whole line, and its
 * thickness with them. The mock draws nothing: a renderer reads the fields and `worldTransform()`. A leaf.
 */
export class Line<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  x2: number;
  y2: number;
  width: number;
  color: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: LineProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.x2 = hostProps.x2;
    this.y2 = hostProps.y2;
    this.width = hostProps.width ?? 1;
    this.color = hostProps.color ?? DEFAULT_LINE_COLOR;
  }
}
