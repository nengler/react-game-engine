import { GameObject } from "../GameObject.ts";

export interface TextProps {
  text: string;
  /** Pixels. Default 16. */
  size?: number;
  /** A CSS color. Default white. */
  color?: string;
}

export const DEFAULT_TEXT_SIZE = 16;
export const DEFAULT_TEXT_COLOR = "white";

/**
 * A line of text for HUDs, labels and menus. The mock draws nothing: a
 * renderer reads `text`, `size`, `color` and `worldTransform()`. In JSX the
 * content is the element's text (`<Text>Score: {score}</Text>`) or its `text`
 * prop; either way it is this `text` field, updated in place.
 */
export class Text<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  text: string;
  size: number;
  color: string;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: TextProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.text = hostProps.text;
    this.size = hostProps.size ?? DEFAULT_TEXT_SIZE;
    this.color = hostProps.color ?? DEFAULT_TEXT_COLOR;
  }
}
