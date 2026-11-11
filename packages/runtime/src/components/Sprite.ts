import { GameObject } from "../GameObject.ts";
import type { AfterimageSnapshot, Afterimages } from "../effects.ts";

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
  /** Afterimages of this sprite: a `createAfterimages()`, drawn by an `<AfterimageLayer>` given the same one. */
  afterimages?: Afterimages;
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
  readonly afterimages: Afterimages | undefined;
}

/** Whether a sprite's look is anything but the plain, whole-image, top-left one. */
export function isStyled(look: SpriteLook): boolean {
  return look.flipX || look.flipY || look.originX !== 0 || look.originY !== 0 || look.tint !== undefined || look.opacity !== 1;
}

/** A sprite as it is drawn now, in the world: what an afterimage keeps. */
type Snapshotable = GameObject & SpriteLook & { snapshot(): Omit<AfterimageSnapshot, "age"> | null };

/** What a sprite does with its afterimages: be what they copy while it is in the world. */
export const spriteHooks = {
  mount(sprite: Snapshotable): void {
    sprite.afterimages?.attach(sprite);
  },
  unmount(sprite: Snapshotable): void {
    sprite.afterimages?.detach(sprite);
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
  afterimages: Afterimages | undefined;

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
    this.afterimages = hostProps.afterimages;
  }

  /** How it is drawn now, in the world (for an afterimage). */
  snapshot(): Omit<AfterimageSnapshot, "age"> | null {
    const sheet = this.frameWidth !== undefined || this.frameHeight !== undefined;
    return snapshotOf(this, this.image, sheet, this.frameWidth, this.frameHeight, this.frame);
  }

  override onMount(): void {
    spriteHooks.mount(this);
  }

  override onUnmount(): void {
    spriteHooks.unmount(this);
  }
}

/** A sprite's look and world transform (with its scale: a squash, say) as an afterimage keeps them. */
export function snapshotOf(
  sprite: GameObject & SpriteLook,
  image: string,
  sheet: boolean,
  frameWidth: number | undefined,
  frameHeight: number | undefined,
  frame: number,
): Omit<AfterimageSnapshot, "age"> | null {
  if (image === "") return null;
  const world = sprite.worldTransform();
  return {
    image, sheet, frameWidth, frameHeight, frame, originX: sprite.originX, originY: sprite.originY, flipX: sprite.flipX, flipY: sprite.flipY,
    x: world.x, y: world.y, rotation: world.rotation, scaleX: world.scaleX, scaleY: world.scaleY,
  };
}
