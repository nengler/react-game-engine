import { GameObject } from "../GameObject.ts";

/**
 * What a collision callback can read about the collider it touched (the `other` of `onCollisionEnter(other)`).
 * Handler code may read exactly these two members; the compiler checks it (see the manifest's `handleTypes`).
 */
export interface Contact {
  /** The other collider's `tag` (`""` when it has none): `if (other.tag === "coin") …`. */
  readonly tag: string;
  /**
   * The name of the object the other collider belongs to: the nearest `<Entity name>` at or above it, or its
   * component's class name when none is named. Tells two prefabs apart without a tag; `tag` tells apart two
   * colliders on one prefab.
   */
  readonly owner: string;
}

export interface ColliderProps {
  width: number;
  height: number;
  /** A label handler code can read on the other side of a collision: `other.tag === "enemy"`. Default `""`. */
  tag?: string;
  /**
   * Which group this collider is in, for `hits`. Default `""` (the default group). Unrelated to `tag`: a tag is
   * for handlers to read, a layer is for the tracker to skip pairs before testing them.
   */
  layer?: string;
  /**
   * The layers this collider can touch. Left out, it touches every layer. A pair is tested only when **each**
   * side's `hits` allows the other's `layer`, so `<Collider layer="bullet" hits={["enemy"]} />` ignores other
   * bullets, and an enemy that left `hits` out still cannot touch a bullet that does not hit enemies.
   */
  hits?: readonly string[];
  /**
   * Called when this collider starts touching another (see
   * `World.reportCollision`), with the collider it touched. It is the
   * collider's own callback, so a component with several colliders knows which
   * one was hit.
   */
  onCollisionEnter?: (other: Contact) => void;
  /**
   * Called once when a pair that was touching separates (see `World.reportCollisionExit`), with the collider it
   * touched. It also fires when the other collider leaves the world or stops having an area; it does not fire
   * for the collider that itself left (it is gone), only for the one still mounted.
   */
  onCollisionExit?: (other: Contact) => void;
}

/**
 * A box for collisions: `width × height` with its **top-left corner at the object's position**, like a `Sprite`
 * and a `Shape`, scaled and turned by its world transform. It draws nothing (pair it with a `Shape` to see it).
 * The runtime only dispatches: finding the moment two colliders start or stop touching is the player's job
 * (`CollisionTracker` in `@rge/player`), which calls `World.reportCollision` and `World.reportCollisionExit`, and
 * those call `onCollisionEnter` and `onCollisionExit`.
 */
export class Collider<P extends object = {}> extends GameObject<P> implements Contact {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  tag: string;
  layer: string;
  hits: readonly string[] | undefined;
  onCollisionEnter: ((other: Contact) => void) | undefined;
  onCollisionExit: ((other: Contact) => void) | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ColliderProps, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.tag = hostProps.tag ?? "";
    this.layer = hostProps.layer ?? "";
    this.hits = hostProps.hits;
    this.onCollisionEnter = hostProps.onCollisionEnter;
    this.onCollisionExit = hostProps.onCollisionExit;
  }

  /** See `Contact.owner`. */
  get owner(): string {
    for (let object: GameObject | null = this; object; object = object.parent) {
      const name = (object as { name?: unknown }).name;
      if (typeof name === "string" && name !== "") return name;
    }
    return this.constructor.name;
  }

  /**
   * Whether `hits` lets this collider touch one on `layer`. The tracker needs both sides to agree
   * (`a.hitsLayer(b.layer) && b.hitsLayer(a.layer)`).
   */
  hitsLayer(layer: string): boolean {
    return this.hits === undefined || this.hits.includes(layer);
  }
}
