import { Entity, type EntityProps } from "./Entity.ts";

/** How what is drawn meets what is under it. */
export type BlendMode = "normal" | "add" | "multiply" | "screen";

/** Every blend mode, for the compiler's check of a literal (`blend="mulitply"` is an error). */
export const BLEND_MODES: readonly BlendMode[] = ["normal", "add", "multiply", "screen"];

export interface LayerProps extends EntityProps {
  /**
   * How the layer is laid over what is under it, once its children are drawn into it. Default `"normal"`.
   * - `"normal"`: painted over, as any drawing is.
   * - `"multiply"`: shade. White leaves what is under it as it is, black makes it black: a dark layer with lights cut into it is night.
   * - `"add"`: light. Its colours are added to what is under it, so it only brightens.
   * - `"screen"`: a softer light that never passes white.
   */
  blend?: BlendMode;
  /** How each child is drawn onto the layer itself: `"add"` makes overlapping lights add up. Default `"normal"`. */
  childBlend?: BlendMode;
  /** The colour the layer starts from each frame, before its children are drawn: `"black"` for a light map. Default transparent. */
  clear?: string;
  /** How strongly the layer is laid over what is under it, 0 (not at all) to 1 (fully, the default). */
  opacity?: number;
}

/**
 * A container whose children are drawn off screen, into a layer the size of the screen, which is then laid over what is under it
 * with a blend mode: the way to darken a cave and light it again (`<Layer blend="multiply" clear="#202038" childBlend="add">`, its
 * children the lights), or to add a glow. Layers nest, four deep. Inside a layer, children are drawn in tree order: a `z` there is
 * ignored, and the layer as a whole is drawn at its own `z`.
 */
export class Layer<P extends object = {}> extends Entity<P> {
  static override readonly intrinsic = true;

  blend: BlendMode;
  childBlend: BlendMode;
  clear: string;
  opacity: number;

  constructor(hostProps: LayerProps = {}, props?: P, defaults?: Partial<P>) {
    super(hostProps, props, defaults);
    this.blend = hostProps.blend ?? "normal";
    this.childBlend = hostProps.childBlend ?? "normal";
    this.clear = hostProps.clear ?? "transparent";
    this.opacity = hostProps.opacity ?? 1;
  }
}
