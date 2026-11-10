import {
  AIR_CONTROL, APEX_SPEED, BODY_H, BODY_W, COYOTE, CORNER_FORGIVENESS, DASH_COOLDOWN, DASH_COUNT, DASH_END_SPEED, DASH_END_UP, DASH_SPEED, DASH_TIME,
  FAST_FALL, GRAVITY, GROUND_FRICTION, JUMP_BOOST, JUMP_BUFFER, JUMP_HOLD, JUMP_SPEED, MAX_FALL, OVER_SPEED_DECEL, RUN_ACCEL, RUN_SPEED,
  WALL_JUMP_LOCK, WALL_JUMP_SPEED, WALL_REACH, WALL_SLIDE_SPEED,
} from "./constants.ts";

/**
 * The character's body: the whole of how it moves, as a plain function of its state, the buttons held, the room's solid
 * cells and the time step. It draws nothing and imports nothing from the engine, so a test steps it directly, and the
 * game state keeps a `Body` as numbers and booleans (every field is one) so a component can show it.
 *
 * Position is a whole number of pixels (`x`, `y`: the hitbox's top left, in the room) plus a sub-pixel remainder
 * (`rx`, `ry`), and moves one axis at a time one pixel at a time against the solid cells, so a body never ends a step
 * inside a wall however fast it goes and pixel art stays on the pixel grid.
 */
export interface Body {
  x: number;
  y: number;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  /** 1 facing right, -1 left. */
  facing: number;
  onGround: boolean;
  /** -1 a wall on the left within reach, 1 on the right, 0 none. */
  wall: number;
  /** True while sliding down a wall (holding toward it, falling). */
  sliding: boolean;
  dashing: boolean;
  dashes: number;
  dashX: number;
  dashY: number;
  // Timers, in seconds left.
  coyote: number;
  buffer: number;
  jumpHold: number;
  dashTime: number;
  dashCooldown: number;
  wallLock: number;
  // Counters of what happened, only ever going up: what sound, dust and shake read (a change is an event).
  jumps: number;
  wallJumps: number;
  dashCount: number;
  lands: number;
}

/** The buttons for one step. `jumpPressed` and `dashPressed` are true only on the step the button went down. */
export interface Controls {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
}

export const NO_CONTROLS: Controls = { left: false, right: false, up: false, down: false, jumpHeld: false, jumpPressed: false, dashPressed: false };

/** The controls as one number, so a compiled handler can pass them to the game state in one argument. */
export function packControls(c: Controls): number {
  return (c.left ? 1 : 0) | (c.right ? 2 : 0) | (c.up ? 4 : 0) | (c.down ? 8 : 0) | (c.jumpHeld ? 16 : 0) | (c.jumpPressed ? 32 : 0) | (c.dashPressed ? 64 : 0);
}

export function unpackControls(bits: number): Controls {
  return { left: (bits & 1) !== 0, right: (bits & 2) !== 0, up: (bits & 4) !== 0, down: (bits & 8) !== 0, jumpHeld: (bits & 16) !== 0, jumpPressed: (bits & 32) !== 0, dashPressed: (bits & 64) !== 0 };
}

/** Whether the pixel at (x, y), in the room, is solid. */
export type SolidAt = (x: number, y: number) => boolean;

/** A body standing still at (x, y) with a dash ready. */
export function newBody(x: number, y: number): Body {
  return {
    x, y, rx: 0, ry: 0, vx: 0, vy: 0, facing: 1, onGround: false, wall: 0, sliding: false, dashing: false, dashes: DASH_COUNT, dashX: 0, dashY: 0,
    coyote: 0, buffer: 0, jumpHold: 0, dashTime: 0, dashCooldown: 0, wallLock: 0, jumps: 0, wallJumps: 0, dashCount: 0, lands: 0,
  };
}

/** Is any pixel of the hitbox, with its top left at (x, y), in a solid cell? */
export function hits(solid: SolidAt, x: number, y: number): boolean {
  // The hitbox is smaller than a cell on one axis and spans at most two cells on the other, so testing the corners and the middle edges is enough.
  const right = x + BODY_W - 1;
  const bottom = y + BODY_H - 1;
  const midY = y + (BODY_H >> 1);
  const midX = x + (BODY_W >> 1);
  return (
    solid(x, y) || solid(right, y) || solid(x, bottom) || solid(right, bottom) || solid(x, midY) || solid(right, midY) || solid(midX, y) || solid(midX, bottom)
  );
}

function approach(value: number, target: number, amount: number): number {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

/** Move along x by `amount` pixels (sub-pixels carried in `rx`), stopping at a wall. Returns whether it stopped. */
function moveX(b: Body, amount: number, solid: SolidAt): boolean {
  b.rx += amount;
  let steps = Math.round(b.rx);
  b.rx -= steps;
  const sign = steps < 0 ? -1 : 1;
  while (steps !== 0) {
    if (hits(solid, b.x + sign, b.y)) {
      b.rx = 0;
      b.vx = 0;
      return true;
    }
    b.x += sign;
    steps -= sign;
  }
  return false;
}

/** Move along y by `amount` pixels, stopping at a floor or ceiling; moving up past a ceiling corner slides around it. */
function moveY(b: Body, amount: number, solid: SolidAt): boolean {
  b.ry += amount;
  let steps = Math.round(b.ry);
  b.ry -= steps;
  const sign = steps < 0 ? -1 : 1;
  while (steps !== 0) {
    if (hits(solid, b.x, b.y + sign)) {
      if (sign < 0 && nudgeAround(b, solid)) {
        b.y += sign;
        steps -= sign;
        continue;
      }
      b.ry = 0;
      b.vy = 0;
      return true;
    }
    b.y += sign;
    steps -= sign;
  }
  return false;
}

/** Moving up and blocked: if a step of a few pixels sideways clears the way, take it. */
function nudgeAround(b: Body, solid: SolidAt): boolean {
  for (let d = 1; d <= CORNER_FORGIVENESS; d++) {
    for (const side of [-1, 1]) {
      if (!hits(solid, b.x + side * d, b.y - 1) && !hits(solid, b.x + side * d, b.y)) {
        b.x += side * d;
        return true;
      }
    }
  }
  return false;
}

/** The wall within reach on the side held (or either side): -1 left, 1 right, 0 none. */
function wallSide(b: Body, c: Controls, solid: SolidAt): number {
  const touching = (side: number): boolean => {
    for (let d = 1; d <= WALL_REACH; d++) if (hits(solid, b.x + side * d, b.y)) return true;
    return false;
  };
  const order = c.right && !c.left ? [1, -1] : c.left && !c.right ? [-1, 1] : [b.facing, -b.facing];
  for (const side of order) if (touching(side)) return side;
  return 0;
}

/** One step of `dt` seconds. Returns the next body; `body` is not changed. */
export function stepBody(body: Body, c: Controls, solid: SolidAt, dt: number): Body {
  const b = { ...body };
  const wasOnGround = b.onGround;
  const fallingSpeed = b.vy;
  const inputX = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  const inputY = (c.down ? 1 : 0) - (c.up ? 1 : 0);

  // Timers.
  b.coyote -= dt;
  b.buffer -= dt;
  b.dashCooldown -= dt;
  b.wallLock -= dt;
  if (c.jumpPressed) b.buffer = JUMP_BUFFER;

  // Where the body stands.
  b.onGround = b.vy >= 0 && hits(solid, b.x, b.y + 1);
  b.wall = b.onGround ? 0 : wallSide(b, c, solid);
  if (b.onGround) {
    b.coyote = COYOTE;
    if (b.dashTime <= 0) b.dashes = DASH_COUNT;
  }

  // Starting a dash: eight directions from what is held, the way it faces when nothing is.
  if (c.dashPressed && b.dashes > 0 && b.dashCooldown <= 0 && b.dashTime <= 0) {
    let dx = inputX;
    let dy = inputY;
    if (dx === 0 && dy === 0) dx = b.facing;
    const length = Math.hypot(dx, dy);
    b.dashX = dx / length;
    b.dashY = dy / length;
    b.dashes--;
    b.dashTime = DASH_TIME;
    b.dashCooldown = DASH_COOLDOWN;
    b.dashCount++;
    b.vx = b.dashX * DASH_SPEED;
    b.vy = b.dashY * DASH_SPEED;
    b.jumpHold = 0;
    if (dx !== 0) b.facing = dx;
  }

  // A jump, from the ground or just after it (coyote), or off a wall. It also cancels a dash, which keeps the dash's speed up to a limit.
  if (b.buffer > 0) {
    const wall = b.onGround || b.coyote > 0 ? 0 : wallSide(b, c, solid);
    if (b.onGround || b.coyote > 0) {
      if (b.dashTime > 0) endDash(b, false);
      b.vy = -JUMP_SPEED;
      b.vx += inputX * JUMP_BOOST;
      b.jumpHold = JUMP_HOLD;
      b.coyote = 0;
      b.buffer = 0;
      b.onGround = false;
      b.jumps++;
    } else if (wall !== 0) {
      if (b.dashTime > 0) endDash(b, false);
      b.vx = -wall * WALL_JUMP_SPEED;
      b.vy = -JUMP_SPEED;
      b.facing = -wall;
      b.jumpHold = JUMP_HOLD;
      b.wallLock = WALL_JUMP_LOCK;
      b.buffer = 0;
      b.wallJumps++;
    }
  }

  if (b.dashTime > 0) {
    // Dashing: the velocity set at the start holds, with no gravity and no steering.
    b.dashTime -= dt;
    if (b.dashTime <= 0) endDash(b, true);
  } else {
    // Running. Input toward a wall just after a wall jump is ignored, so one cannot climb a single wall by mashing.
    const locked = b.wallLock > 0 && inputX === -Math.sign(b.vx);
    const want = locked ? 0 : inputX;
    const control = b.onGround ? 1 : AIR_CONTROL;
    if (Math.abs(b.vx) > RUN_SPEED && Math.sign(b.vx) === want) b.vx = approach(b.vx, want * RUN_SPEED, OVER_SPEED_DECEL * dt);
    else if (want !== 0) b.vx = approach(b.vx, want * RUN_SPEED, RUN_ACCEL * control * dt);
    else if (b.onGround) b.vx = approach(b.vx, 0, GROUND_FRICTION * dt);
    else b.vx = approach(b.vx, 0, RUN_ACCEL * 0.3 * dt);
    if (inputX !== 0 && b.wallLock <= 0) b.facing = inputX;

    // Falling: gravity, lighter near the top of a held jump, capped (slower on a wall held toward, faster holding down).
    b.sliding = false;
    if (!b.onGround) {
      let gravity = GRAVITY;
      if (Math.abs(b.vy) < APEX_SPEED && c.jumpHeld) gravity *= 0.5;
      let cap = inputY > 0 ? FAST_FALL : MAX_FALL;
      if (b.wall !== 0 && inputX === b.wall && b.vy >= 0) {
        cap = WALL_SLIDE_SPEED;
        b.sliding = true;
      }
      b.vy = approach(b.vy, cap, gravity * dt);
    }
    // A held jump keeps its speed for a while; letting go ends that.
    if (b.jumpHold > 0) {
      b.jumpHold -= dt;
      if (c.jumpHeld) b.vy = Math.min(b.vy, -JUMP_SPEED);
      else b.jumpHold = 0;
    }
  }

  b.dashing = b.dashTime > 0;
  moveX(b, b.vx * dt, solid);
  moveY(b, b.vy * dt, solid);

  // Landing, and where the body stands now (what is drawn and what the next step starts from).
  b.onGround = b.vy >= 0 && hits(solid, b.x, b.y + 1);
  if (b.onGround && !wasOnGround && fallingSpeed > 60) b.lands++;
  if (b.onGround) b.sliding = false;
  return b;
}

/** A dash is over (it ran out, or a jump cut it off): leave it moving at the end speed in its direction. */
function endDash(b: Body, ran: boolean): void {
  b.dashTime = 0;
  b.dashing = false;
  if (ran) {
    b.vx = b.dashX * DASH_END_SPEED;
    b.vy = b.dashY * DASH_END_SPEED * (b.dashY < 0 ? DASH_END_UP : 1);
  } else {
    b.vx = Math.max(-DASH_END_SPEED, Math.min(DASH_END_SPEED, b.vx));
  }
}
