/**
 * Balls: circles that fall, roll and pile up, pushed apart by each other and stopped by what is solid. What `useBall` keeps for a
 * component. Colliders only report touching and bodies (`useBody`) are boxes moved by their own component; a pile of fruit in a
 * jar, marbles or a ball pit needs bodies that move each other, so the world steps every ball together, once a step, before the
 * step's updates (DESIGN.md, "Balls: `useBall`").
 *
 * The solver is position-based (Verlet): a ball keeps where it is and where it was a substep ago, and the difference is its
 * velocity. Each substep moves every ball under gravity, then pushes overlapping balls apart (by mass) and out of solids, a few
 * times over. There is no bounce: piles settle instead of jittering. It is deterministic, and the order the balls are solved in is
 * worked out from where they are (left to right), not from the order they joined the world, so a rewind that rebuilds the tree
 * replays a pile exactly.
 */
import type { GameObject } from "./GameObject.ts";
import type { World } from "./World.ts";

export interface BallOptions {
  /** Where the centre starts, in its component's parent's space (what `<Entity x y>` around the component means). */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Pixels per second per second, downwards. Default 0. */
  readonly gravity?: number;
  /** How heavy it is against other balls. Default the radius squared (its area, give or take π). */
  readonly mass?: number;
  /** How much of its sliding it loses each substep it is pressed against a solid, 0 to 1. Default 0.1. */
  readonly friction?: number;
  /** About how much of its speed it loses each second to the air, 0 to 1. Default 0.2: piles come to rest, a thrown ball still flies. */
  readonly drag?: number;
  /** A name other balls see in `contacts` (`"fruit"`). Default `""`. */
  readonly tag?: string;
  /** Anything other balls see in `contacts`: what this ball is (`{ id, kind }`). */
  readonly data?: unknown;
  /** Start held in place (see `Ball.pinned`). Default false. */
  readonly pinned?: boolean;
}

/**
 * Another ball this one touches: its `tag`, its `data` (typed by the tag through the game's `ColliderData`, as a collider contact's
 * is), its `owner` (the nearest `<Entity name>` at or above its component, else the component's class name, as for colliders), and
 * where its centre is in this ball's parent's space.
 */
export interface BallContact<Tag extends string = string> {
  readonly tag: Tag;
  readonly data: Tag extends keyof ColliderData ? ColliderData[Tag] : unknown;
  readonly owner: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** A solid box in world space that balls are stopped by. */
export interface SolidBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What a world answers for its balls: the solid boxes near a box in world space (solid colliders and solid tiles). */
export interface BallSpace {
  solidBoxesNear(x: number, y: number, width: number, height: number, ignore: GameObject | null): SolidBox[];
}

const SUBSTEPS = 4;
const ITERATIONS = 3;
/**
 * The most speed, in pixels per second, a ball gains in a step from being pushed out of other balls and solids. Balls that
 * start overlapping (two made in one place, a merge's result among its neighbours) pop apart at this speed at most, instead of
 * being thrown across the world; slowing down (landing, being stopped) is not limited.
 */
export const BALL_POP_SPEED = 300;
/** Two balls closer than this beyond touching still touch (`contacts`): a settled pile jitters by a fraction of a pixel. */
export const BALL_TOUCH_TOLERANCE = 1.5;

export class Ball {
  /** The centre, in the owner's parent's space. */
  x: number;
  y: number;
  /** Where the centre was one substep ago: the difference is the velocity. */
  px: number;
  py: number;
  readonly radius: number;
  gravity: number;
  mass: number;
  friction: number;
  drag: number;
  tag: string;
  data: unknown;
  /**
   * Held in place: it does not fall, is not pushed by other balls or by `push`, and stops dead; other balls pile up on it and
   * are pushed out of it as out of something solid (a frozen fruit, a peg). Unpinned, it starts from rest.
   */
  pinned: boolean;
  /** The length of the last substep, in seconds, to turn the motion back into a velocity. */
  substep = 1 / 240;
  #owner: GameObject | null = null;
  #world: World | null = null;

  constructor(options: BallOptions) {
    this.x = options.x;
    this.y = options.y;
    this.px = options.x;
    this.py = options.y;
    this.radius = options.radius;
    this.gravity = options.gravity ?? 0;
    this.mass = options.mass ?? options.radius * options.radius;
    this.friction = options.friction ?? 0.1;
    this.drag = options.drag ?? 0.2;
    this.tag = options.tag ?? "";
    this.data = options.data;
    this.pinned = options.pinned ?? false;
  }

  /** Called by the owner when it joins a world (`GameObject.ownedHandles`). */
  attachOwner(owner: GameObject, world: World): void {
    this.#owner = owner;
    this.#world = world;
    world.addBall(this);
  }

  detachOwner(): void {
    this.#world?.removeBall(this);
    this.#owner = null;
    this.#world = null;
  }

  get owner(): GameObject | null {
    return this.#owner;
  }

  /** Where the owner's parent's space starts in the world (balls are placed by translation only, as bodies are). */
  origin(): { x: number; y: number } {
    const parent = this.#owner?.parent ?? null;
    if (parent === null) return { x: 0, y: 0 };
    const at = parent.worldTransform();
    return { x: at.x, y: at.y };
  }

  /** Pixels per second. */
  speed(): number {
    const vx = (this.x - this.px) / this.substep;
    const vy = (this.y - this.py) / this.substep;
    return Math.sqrt(vx * vx + vy * vy);
  }

  /** Add to its velocity, in pixels per second (a blast, a flick). A pinned ball takes none. */
  push(vx: number, vy: number): void {
    if (this.pinned) return;
    this.px -= vx * this.substep;
    this.py -= vy * this.substep;
  }

  /** Hold it in place, or let it go (see `pinned`). */
  pin(on: boolean): void {
    this.pinned = on;
  }

  /** Change its gravity, in pixels per second per second downwards: 0 hangs it in the air, a negative one floats it up. */
  setGravity(gravity: number): void {
    this.gravity = gravity;
  }

  /** Put it somewhere, at rest, with no collision. */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
  }

  /** The balls with this tag touching this one now, nearest first. Before the owner is mounted, none. */
  contacts<Tag extends string>(tag: Tag): BallContact<Tag>[] {
    return this.#world === null ? [] : (this.#world.ballContacts(this, tag) as BallContact<Tag>[]);
  }

  /** See `BallContact.owner`. */
  get ownerName(): string {
    for (let object: GameObject | null = this.#owner; object; object = object.parent) {
      const name = (object as { name?: unknown }).name;
      if (typeof name === "string" && name !== "") return name;
    }
    return this.#owner?.constructor.name ?? "";
  }
}

/** Make a ball: `useBall` does, in a `useMutable` field of the component that owns it. */
export function createBall(options: BallOptions): Ball {
  return new Ball(options);
}

/** A ball in world space while it is stepped. */
interface Moving {
  ball: Ball;
  ox: number;
  oy: number;
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  inv: number;
  /** Its speed at the start of the step, as a motion per substep: what popping out may add to (`BALL_POP_SPEED`). */
  start: number;
  /** Kept of its velocity each substep (`drag`). */
  keep: number;
  solids: SolidBox[];
}

/** Left to right by the left edge, then top to bottom, then by size: an order that depends only on where the balls are. */
function byPlace(a: Moving, b: Moving): number {
  return a.x - a.r - (b.x - b.r) || a.y - b.y || a.r - b.r;
}

/**
 * Step every ball by `dt`: what `World.tick` does before the updates. The balls' positions are in their owners' parents' spaces;
 * they are moved to world space for the step and back after, so a ball inside a moving entity is carried with it.
 */
export function stepBalls(balls: readonly Ball[], space: BallSpace, dt: number): void {
  if (balls.length === 0 || !(dt > 0)) return;
  const h = dt / SUBSTEPS;
  const moving: Moving[] = balls.map((ball) => {
    const o = ball.origin();
    const r = ball.radius;
    const x = o.x + ball.x;
    const y = o.y + ball.y;
    // The solids near where it can get to this step: as far as its speed, what popping out can add each substep and gravity take it.
    const speed = (Math.abs(ball.x - ball.px) + Math.abs(ball.y - ball.py)) / ball.substep;
    const reach = r + (speed + BALL_POP_SPEED * SUBSTEPS + Math.abs(ball.gravity) * dt) * dt + 2;
    return {
      ball,
      ox: o.x,
      oy: o.y,
      x,
      y,
      px: o.x + ball.px,
      py: o.y + ball.py,
      r,
      // A pinned ball, like one with no mass or an infinite one, is not moved: not by gravity, not by what it touches.
      inv: !ball.pinned && ball.mass > 0 && Number.isFinite(ball.mass) ? 1 / ball.mass : 0,
      start: speed * h,
      // Linear in the substep, not a power: Math.pow may round differently in the two hosts, and parity must be exact.
      keep: Math.max(0, 1 - Math.max(0, Math.min(1, ball.drag)) * h),
      solids: space.solidBoxesNear(x - reach, y - reach, reach * 2, reach * 2, ball.owner),
    };
  });

  for (let sub = 0; sub < SUBSTEPS; sub++) {
    for (const m of moving) {
      const vx = (m.x - m.px) * m.keep;
      const vy = (m.y - m.py) * m.keep;
      m.px = m.x;
      m.py = m.y;
      if (m.inv === 0) continue;
      m.x += vx;
      m.y += vy + m.ball.gravity * h * h;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      moving.sort(byPlace);
      for (let i = 0; i < moving.length; i++) {
        const a = moving[i] as Moving;
        const right = a.x + a.r;
        for (let j = i + 1; j < moving.length; j++) {
          const b = moving[j] as Moving;
          if (b.x - b.r >= right) break;
          separate(a, b);
        }
      }
      for (const m of moving) if (m.inv > 0) for (const box of m.solids) pushOut(m, box);
    }
    // Over the step, popping out of overlaps adds at most BALL_POP_SPEED to what the ball had and what gravity has given it since.
    for (const m of moving) {
      const vx = m.x - m.px;
      const vy = m.y - m.py;
      const speed = Math.sqrt(vx * vx + vy * vy);
      const limit = m.start + Math.abs(m.ball.gravity) * h * h * (sub + 1) + BALL_POP_SPEED * h;
      if (speed > limit) {
        m.px = m.x - (vx * limit) / speed;
        m.py = m.y - (vy * limit) / speed;
      }
    }
  }

  for (const m of moving) {
    m.ball.x = m.x - m.ox;
    m.ball.y = m.y - m.oy;
    m.ball.px = m.px - m.ox;
    m.ball.py = m.py - m.oy;
    m.ball.substep = h;
  }
}

/** Push two overlapping balls apart along the line between their centres, the lighter one further. */
function separate(a: Moving, b: Moving): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return;
  const total = a.inv + b.inv;
  if (total === 0) return;
  let d = Math.sqrt(d2);
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else d = 0;
  const overlap = min - d;
  const wa = a.inv / total;
  const wb = b.inv / total;
  a.x -= nx * overlap * wa;
  a.y -= ny * overlap * wa;
  b.x += nx * overlap * wb;
  b.y += ny * overlap * wb;
}

/**
 * Push a ball out of a solid box: away from the box's nearest point, or, when its centre is inside, out of the nearest side. Being
 * pushed out adds no speed (a ball found inside a wall is moved out, not thrown); its motion into the box is dropped, and its
 * friction takes some of its motion along it: only while pressed into the solid, so a ball that grazes a wall falls freely.
 */
function pushOut(m: Moving, box: SolidBox): void {
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const cx = Math.max(left, Math.min(m.x, right));
  const cy = Math.max(top, Math.min(m.y, bottom));
  const ex = m.x - cx;
  const ey = m.y - cy;
  const d2 = ex * ex + ey * ey;
  let nx: number;
  let ny: number;
  let depth: number;
  if (d2 > 1e-18) {
    if (d2 >= m.r * m.r) return;
    const d = Math.sqrt(d2);
    nx = ex / d;
    ny = ey / d;
    depth = m.r - d;
  } else {
    // The centre is inside: out through the nearest side.
    const toLeft = m.x - left;
    const toRight = right - m.x;
    const toTop = m.y - top;
    const toBottom = bottom - m.y;
    const least = Math.min(toLeft, toRight, toTop, toBottom);
    if (least === toTop) [nx, ny, depth] = [0, -1, toTop + m.r];
    else if (least === toBottom) [nx, ny, depth] = [0, 1, toBottom + m.r];
    else if (least === toLeft) [nx, ny, depth] = [-1, 0, toLeft + m.r];
    else [nx, ny, depth] = [1, 0, toRight + m.r];
  }
  // The velocity it had before it was pushed out.
  let vx = m.x - m.px;
  let vy = m.y - m.py;
  m.x += nx * depth;
  m.y += ny * depth;
  const into = vx * nx + vy * ny;
  if (into < 0) {
    vx -= nx * into;
    vy -= ny * into;
  }
  const friction = m.ball.friction;
  if (friction > 0) {
    const along = vx * nx + vy * ny;
    vx = nx * along + (vx - nx * along) * (1 - friction);
    vy = ny * along + (vy - ny * along) * (1 - friction);
  }
  m.px = m.x - vx;
  m.py = m.y - vy;
}

/** Do two balls, in world space, touch (within the tolerance)? */
export function ballsTouch(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const reach = ar + br + BALL_TOUCH_TOLERANCE;
  return dx * dx + dy * dy <= reach * reach;
}
