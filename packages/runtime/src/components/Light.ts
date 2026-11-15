import { GameObject } from "../GameObject.ts";
import { Layer, type LayerProps } from "./Layer.ts";

export interface LightProps {
  /** How far it reaches, in pixels: its colour at the middle falls off smoothly to nothing here. */
  radius: number;
  /** A CSS colour. Default a warm white. */
  color?: string;
  /** How strong it is, 0 (off) to 1 (its full colour at the middle, the default). Lights that overlap add up. */
  intensity?: number;
}

/**
 * A light: a soft disc of colour, brightest at its middle, falling off to nothing at `radius`. Put it in a `<Lighting>` (or a
 * `<Layer childBlend="add">`), where it lifts the dark; outside one it is drawn over the world as a glow. Placed with `x` and `y`
 * (its middle) or `transform`, like a shape.
 */
export class Light<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  radius: number;
  color: string;
  intensity: number;

  constructor(hostProps: LightProps = { radius: 0 }, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.radius = hostProps.radius;
    this.color = hostProps.color ?? "#fff3dc";
    this.intensity = hostProps.intensity ?? 1;
  }
}

export interface LightingProps extends Omit<LayerProps, "blend" | "childBlend" | "clear"> {
  /** The darkness where no light reaches: a CSS colour, black for none at all. Default `"#101018"`. */
  ambient?: string;
}

/**
 * The world as light reaches it: everything under this is darkened to `ambient`, except where its `<Light>`s shine, which add up.
 * A `<Layer blend="multiply" childBlend="add" clear={ambient}>` with that set for you; it may take a `shader` and `params` as a layer
 * does. Put it after what it lights (the world and the characters), before the HUD.
 */
export class Lighting<P extends object = {}> extends Layer<P> {
  static override readonly intrinsic = true;

  constructor(hostProps: LightingProps = {}, props?: P, defaults?: Partial<P>) {
    super({ ...hostProps, blend: "multiply", childBlend: "add", clear: hostProps.ambient ?? "#101018" }, props, defaults);
  }

  /** The darkness where no light reaches (the layer's `clear`). */
  get ambient(): string {
    return this.clear;
  }

  set ambient(color: string) {
    this.clear = color;
  }
}
