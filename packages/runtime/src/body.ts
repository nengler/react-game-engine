/**
 * A box that moves through the world and is stopped by what is solid, answering at once: what `useBody` keeps for a component.
 * Movement and collision used to be a step apart (a collider learns it touched something after the step's update), which is why
 * the games moved their movement into plain functions over the tile grid. A body asks the world in the same step.
 *
 * What is solid: the solid tiles of a `<Tilemap solid>` (tiles with the Tiled property `solid`) and every `<Collider solid>`, in
 * the world the body's component is mounted in. The body moves a pixel at a time (`moveActorX` / `moveActorY`), so it never ends
 * a step inside something however fast it goes.
 */
import type { GameObject } from "./GameObject.ts";
import { moveActorX, moveActorY, type PixelActor } from "./move.ts";
import type { World } from "./World.ts";

export interface BodyOptions {
  /** Where the box's top left starts, in its component's parent's space (what `transform={{ x, y }}` on the component means). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a move met: the sides it was stopped on, and the tags of the solids that stopped it (`"tile"` for a tile). */
export interface BodyHit {
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly tags: readonly string[];
}

/** A box in world space. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a world answers for a body: what is solid in a box, and which colliders overlap one. Implemented by `World`. */
export interface BodySpace {
  /** The tag of something solid that overlaps `box`, or null when nothing does. Colliders under `ignore` do not count. */
  solidIn(box: Box, ignore: GameObject): string | null;
  /** Whether a collider with this tag overlaps `box`. Colliders under `ignore` do not count. */
  tagIn(box: Box, tag: string, ignore: GameObject): boolean;
}

export class Body implements PixelActor {
  x: number;
  y: number;
  rx = 0;
  ry = 0;
  readonly width: number;
  readonly height: number;
  #owner: GameObject | null = null;
  #world: (World & BodySpace) | null = null;

  constructor(options: BodyOptions) {
    this.x = Math.round(options.x);
    this.y = Math.round(options.y);
    this.width = options.width;
    this.height = options.height;
  }

  /** Called by the owner when it joins a world (`GameObject.ownedHandles`). */
  attachOwner(owner: GameObject, world: World): void {
    this.#owner = owner;
    this.#world = world as World & BodySpace;
  }

  detachOwner(): void {
    this.#owner = null;
    this.#world = null;
  }

  /** The box at (x, y) in world space: the parent's world position plus the body's own. */
  #box(x: number, y: number): Box {
    const parent = this.#owner?.parent ?? null;
    const origin = parent === null ? { x: 0, y: 0 } : parent.worldTransform();
    return { x: origin.x + x, y: origin.y + y, width: this.width, height: this.height };
  }

  /**
   * Move by (dx, dy) pixels, x first, each a pixel at a time while the next pixel is free; stopped on a side by anything solid.
   * Fractions are carried to the next move. Before the owner is mounted nothing is solid.
   */
  move(dx: number, dy: number): BodyHit {
    const tags: string[] = [];
    const sides = { left: false, right: false, up: false, down: false };
    const blocked = (x: number, y: number): boolean => {
      if (this.#world === null || this.#owner === null) return false;
      const tag = this.#world.solidIn(this.#box(x, y), this.#owner);
      if (tag !== null && !tags.includes(tag)) tags.push(tag);
      return tag !== null;
    };
    if (dx !== 0) moveActorX(this, dx, blocked, (direction) => (direction < 0 ? (sides.left = true) : (sides.right = true)));
    if (dy !== 0) moveActorY(this, dy, blocked, (direction) => (direction < 0 ? (sides.up = true) : (sides.down = true)));
    return { ...sides, tags };
  }

  /** Whether a collider with this tag overlaps the body now (its own colliders do not count). */
  touching(tag: string): boolean {
    if (this.#world === null || this.#owner === null) return false;
    return this.#world.tagIn(this.#box(this.x, this.y), tag, this.#owner);
  }

  /** Put the body somewhere, with no collision (a respawn, a door). */
  place(x: number, y: number): void {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.rx = 0;
    this.ry = 0;
  }
}

/** Make a body: `useBody` does, in a `useState` of the component that owns it. */
export function createBody(options: BodyOptions): Body {
  return new Body(options);
}

/** Do two boxes overlap (touching edges do not)? */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
