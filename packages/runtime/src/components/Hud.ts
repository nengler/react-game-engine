import { GameObject, type InputScopeProps } from "../GameObject.ts";

export type HudProps = InputScopeProps;

/**
 * A layer drawn after the world through a view that ignores the camera, so what is in it stays where it is put while
 * the camera moves: a score, a health bar, a button. Its coordinates are screen pixels: game pixels under a
 * `<Screen>` (the top-left corner of the game is 0, 0), window pixels without one. Its `transform` moves the whole
 * layer, and `z` orders the things inside it. A `<Pointer>` inside is pressed at the HUD's coordinates, so HUD
 * buttons work however the camera moves. Put it directly inside the game's root; a `<Hud>` inside another `<Hud>`
 * is a plain container. Colliders in a HUD never touch anything.
 */
export class Hud<P extends object = {}> extends GameObject<P> {
  static override readonly intrinsic = true;

  /** `props` and `defaults` are the component's own (see `GameObject`). */
  constructor(hostProps: HudProps = {}, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.inert = hostProps.inert ?? false;
    this.modal = hostProps.modal ?? false;
  }
}
