import { GameObject } from "../GameObject.ts";
import type { Squash } from "../effects.ts";
import type { InputState } from "../input.ts";

/** What can change how a sprite is drawn, beyond which image it is. All optional; a sprite that sets none is drawn plainly, as it always was. */
export interface SpriteOptions {
  /** Mirror left to right, about the origin. */
  flipX?: boolean;
  /** Mirror top to bottom, about the origin. */
  flipY?: boolean;
  /** The point of the image, in its pixels (of one frame, for a sheet), that sits at the object's position and that flipping and rotating turn about. Default 0, the top left. */
  originX?: number;
  originY?: number;
  /** A CSS colour that multiplies the image's colours: white (the default) changes nothing, `"red"` keeps only the red. Its alpha is opacity too. */
  tint?: string;
  /** 0 (invisible) to 1 (the default); multiplies the tint's alpha. */
  opacity?: number;
  /** Squash and stretch about the origin: a `createSquash()` started from anywhere, which this sprite draws and springs back. */
  squash?: Squash;
}

export interface SpriteProps extends SpriteOptions {
  image: string;
  /** Draw one frame of a sheet: the size of a frame, in pixels. The sheet is read left to right, then down. */
  frameWidth?: number;
  frameHeight?: number;
  /** Which frame of the sheet, counting from 0 (a sheet needs `frameWidth` and `frameHeight`). Default 0. */
  frame?: number;
}

/** The fields every sprite-like object (a `Sprite`, an `AnimatedSprite` playing a sheet) has to say how it is drawn. */
export interface SpriteLook {
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly tint: string | undefined;
  readonly opacity: number;
  readonly squash: Squash | undefined;
}

/** Whether a sprite's look is anything but the plain, whole-image, top-left one. */
export function isStyled(look: SpriteLook): boolean {
  return look.flipX || look.flipY || look.originX !== 0 || look.originY !== 0 || look.tint !== undefined || look.opacity !== 1 || look.squash !== undefined;
}

/** What a sprite does with its squash: take it on mounting, spring it back each update, and draw again while it moves. */
export const squashHooks = {
  mount(sprite: GameObject & SpriteLook): void {
    sprite.squash?.attach(sprite);
  },
  unmount(sprite: GameObject & SpriteLook): void {
    sprite.squash?.detach(sprite);
  },
  update(sprite: GameObject & SpriteLook, dt: number): void {
    const squash = sprite.squash;
    if (squash !== undefined && squash.owns(sprite) && squash.advance(dt)) sprite.markChanged();
  },
};

export class Sprite<P extends object = {}> extends GameObject<P> implements SpriteLook {
  static override readonly intrinsic = true;

  image: string;
  frameWidth: number | undefined;
  frameHeight: number | undefined;
  frame: number;
  flipX: boolean;
  flipY: boolean;
  originX: number;
  originY: number;
  tint: string | undefined;
  opacity: number;
  squash: Squash | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: SpriteProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.image = hostProps.image;
    this.frameWidth = hostProps.frameWidth;
    this.frameHeight = hostProps.frameHeight;
    this.frame = hostProps.frame ?? 0;
    this.flipX = hostProps.flipX ?? false;
    this.flipY = hostProps.flipY ?? false;
    this.originX = hostProps.originX ?? 0;
    this.originY = hostProps.originY ?? 0;
    this.tint = hostProps.tint;
    this.opacity = hostProps.opacity ?? 1;
    this.squash = hostProps.squash;
  }

  override onMount(): void {
    squashHooks.mount(this);
  }

  override onUnmount(): void {
    squashHooks.unmount(this);
  }

  override onUpdate(dt: number, _input?: InputState): void {
    squashHooks.update(this, dt);
  }
}
