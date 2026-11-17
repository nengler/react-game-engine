import { GameObject } from "../GameObject.ts";
import type { ColliderShape } from "../shapes.ts";

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
  /**
   * What each collider tag can be sent (`send(tag, where, value)`, received by `<Collider onReceive>`), so both ends are typed by
   * the tag. Declared once, as `ColliderData` is:
   *
   *     declare global {
   *       interface ColliderMessages { enemy: Blast; ally: Aura }
   *     }
   *
   * With nothing declared for a tag, what it is sent is `unknown`.
   */
  interface ColliderMessages {}
}

/** What a collider with this tag is sent: its `ColliderMessages` entry, or `unknown` when the game declared none. */
export type MessageOf<Tag extends string> = Tag extends keyof ColliderMessages ? ColliderMessages[Tag] : unknown;

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

/**
 * A collider `nearby` found: its contact (`tag`, `owner`, `data`, typed by tag as `ContactOf` is), where the middle of its box is
 * in world space, and how far its box is from the point asked about (0 when the point is inside it). Hand it to `send` to reach
 * that one collider; it is good for the step it was found in (keep `data`'s id, not the result, across steps).
 */
export type Nearby<Tag extends string = string> = ContactOf<Tag> & { readonly x: number; readonly y: number; readonly distance: number };

/** What `onReceive` is, written as a method so a collider of one tag is still assignable to `Collider` (any tag). */
type Receiver<Tag extends string> = { receive(value: MessageOf<Tag>): void }["receive"];

/** Where `send` delivers: every collider of its tag whose box comes within a circle, or the one collider a `nearby` result is. */
export type SendTarget<Tag extends string = string> = { readonly x: number; readonly y: number; readonly radius: number } | Nearby<Tag>;

export interface ColliderProps<Tag extends string = string> {
  width: number;
  height: number;
  /**
   * A label handler code can read on the other side of a collision (`other.tag === "enemy"`), and what `nearby` and `send` look
   * for. Default `""`.
   */
  tag?: Tag;
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
  /** Bodies (`useBody`) cannot move into it: a wall, a crate, a closed door. Default false. A solid collider stops bodies at its box, whatever its shape. */
  solid?: boolean;
  /**
   * Its shape inside its `width` × `height` box, for what it touches: `"box"` (the default) fills the box; `"circle"` is the circle
   * inside it (centred, half the shorter side across); `"polygon"` is the convex polygon `points` makes. A pair of plain boxes is
   * tested as boxes, upright; a pair in which either has another shape is tested exactly, turned with its objects.
   */
  shape?: ColliderShape;
  /** A `"polygon"`'s corners in order, `[x0, y0, x1, y1, …]`, in the collider's own pixels, inside its box. At least three; convex. */
  points?: readonly number[];
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
  /**
   * Called with what was sent to this collider (`send(tag, where, value)`): a blast that reached an enemy, a buff that reached an
   * ally. Delivered at the end of the step's update phase, after every `useUpdate` and timer, in the order the values were sent;
   * typed by the collider's `tag` through `ColliderMessages`.
   */
  onReceive?: (value: MessageOf<Tag>) => void;
}

/**
 * A box for collisions: `width × height` with its **top-left corner at the object's position**, like a `Sprite`
 * and a `Shape`, scaled and turned by its world transform. It draws nothing (pair it with a `Shape` to see it).
 * The runtime only dispatches: finding the moment two colliders start or stop touching is the player's job
 * (`CollisionTracker` in `@tsengine/player`), which calls `World.reportCollision` and `World.reportCollisionExit`, and
 * those call `onCollisionEnter` and `onCollisionExit`.
 */
export class Collider<P extends object = {}, Tag extends string = string> extends GameObject<P> implements BaseContact {
  static override readonly intrinsic = true;

  width: number;
  height: number;
  tag: string;
  layer: string;
  hits: readonly string[] | undefined;
  solid: boolean;
  shape: ColliderShape;
  points: readonly number[];
  data: unknown;
  onCollisionEnter: ((other: Contact) => void) | undefined;
  onCollisionExit: ((other: Contact) => void) | undefined;
  /**
   * See `ColliderProps.onReceive`. Typed by the collider's tag (the class's `Tag`, which a compiled `<Collider tag="foe">` root
   * names); compared both ways (`Receiver`), so a collider of any tag is still a `Collider`.
   */
  onReceive: Receiver<Tag> | undefined;

  /** `props` and `defaults` are the component's own (see `GameObject`); `hostProps` are this element's. */
  constructor(hostProps: ColliderProps<Tag>, props?: P, defaults?: Partial<P>) {
    super(props, defaults);
    this.width = hostProps.width;
    this.height = hostProps.height;
    this.tag = hostProps.tag ?? "";
    this.layer = hostProps.layer ?? "";
    this.hits = hostProps.hits;
    this.solid = hostProps.solid ?? false;
    this.shape = hostProps.shape ?? "box";
    this.points = hostProps.points ?? [];
    this.data = hostProps.data;
    this.onCollisionEnter = hostProps.onCollisionEnter;
    this.onCollisionExit = hostProps.onCollisionExit;
    this.onReceive = hostProps.onReceive;
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
