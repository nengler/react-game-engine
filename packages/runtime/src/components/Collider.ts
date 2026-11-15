import { GameObject } from "../GameObject.ts";

declare global {
  /**
   * The data each collider tag carries, so `other.data` is typed by `other.tag`. A game declares it once, in any `.ts` file:
   *
   *     declare global {
   *       interface ColliderData { coin: { value: number }; enemy: { damage: number }; spikes: undefined }
   *     }
   *
   * Then `if (other.tag === "coin") collect(other.data.value)` type-checks. With nothing declared, `data` is `unknown`.
   */
  interface ColliderData {}
}

/** A contact whose tag the game did not declare in `ColliderData`: its data is `unknown`. */
export interface BaseContact {
  /** The other collider's `tag` (`""` when it has none): `if (other.tag === "coin") …`. */
  readonly tag: string;
  /**
   * The name of the object the other collider belongs to: the nearest `<Entity name>` at or above it, or its
   * component's class name when none is named. Tells two prefabs apart without a tag; `tag` tells apart two
   * colliders on one prefab.
   */
  readonly owner: string;
  /** What the other collider's `data` prop holds (`<Collider tag="coin" data={{ value }} />`), or undefined. */
  readonly data: unknown;
}

/** One contact per tag the game declared in `ColliderData`, so comparing `other.tag` narrows `other.data`. */
type DeclaredContact = {
  [K in keyof ColliderData & string]: { readonly tag: K; readonly owner: string; readonly data: ColliderData[K] };
}[keyof ColliderData & string];

/**
 * What a collision callback can read about the collider it touched (the `other` of `onCollisionEnter(other)`): its `tag`, its
 * `owner` and its `data`. Typed by tag once the game declares `ColliderData`; the compiler checks the members (the manifest's
 * `handleTypes`).
 */
export type Contact = [keyof ColliderData] extends [never] ? BaseContact : DeclaredContact;

/** A contact with this tag: typed by `ColliderData` when the game declares it (`overlapping("enemy")`'s `data` is an enemy's), else any contact. */
export type ContactOf<Tag extends string> = [Extract<Contact, { readonly tag: Tag }>] extends [never]
  ? Contact
  : Extract<Contact, { readonly tag: Tag }>;

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
  /** Bodies (`useBody`) cannot move into it: a wall, a crate, a closed door. Default false. */
  solid?: boolean;
  /**
   * What the collider tells whatever touches it, as `other.data`: a coin's value, an enemy's damage. Any value; typed by tag
   * through `ColliderData`.
   */
  data?: unknown;
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
export class Collider<P extends object = {}> extends GameObject<P> implements BaseContact {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  tag: string;
  layer: string;
  hits: readonly string[] | undefined;
  solid: boolean;
  data: unknown;
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
    this.solid = hostProps.solid ?? false;
    this.data = hostProps.data;
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
