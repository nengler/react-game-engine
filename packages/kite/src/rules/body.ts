import { moveActorX, moveActorY } from "@rge/runtime";
import * as K from "./constants.ts";
import { BODY_H, BODY_W, DUCK_H } from "./constants.ts";
import type { GameEvent } from "./events.ts";

/**
 * The character's body: the whole of how it moves, as a plain function of its state, the buttons held, the room's solid
 * pixels and the time step. It draws nothing and imports nothing from the engine, so a test steps it directly. What happens
 * in a step (a jump, a landing) is pushed onto the `events` the caller passes, for sound and dust to answer.
 *
 * It follows Celeste's player (`Player.cs`, Maddy Thorson and Noel Berry): the same numbers (`constants.ts`) and the same
 * order each step: timers, then the state the body is in (normal, dashing or climbing), then moving one pixel at a time
 * against the solid pixels with Celeste's collision rules (corner corrections, keeping speed into a wall for a moment).
 * Left out: everything that needs things Kite's rooms do not have (springs, moving blocks, water, wind, holdables).
 *
 * Position is whole pixels (`x`, `y`: the hitbox's top left, in the room) plus a sub-pixel remainder (`rx`, `ry`).
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
  /** The hitbox is the short one (8 × 6); `y` is its top, so ducking moves `y` down and standing moves it back. */
  ducking: boolean;
  /** Sliding down a wall this step (holding toward it, falling). */
  sliding: boolean;
  /** In the dash state. */
  dashing: boolean;
  /** The first step of a dash, which only reads the direction (Celeste's one frame between starting and moving). */
  dashStarting: boolean;
  climbing: boolean;
  dashes: number;
  /** The dash's direction, a unit vector (0, 0 before it is known). */
  dashX: number;
  dashY: number;
  /** Horizontal speed when the dash started: kept if it was faster in the dash's direction. */
  beforeDashX: number;
  /** Started on the ground: a landing then does not correct around a ledge. */
  dashStartedOnGround: boolean;
  /** After a dash ends, until landing or jumping, gravity is halved near the top as if jump were held. */
  autoJump: boolean;
  /** The fall cap now: MAX_FALL, raised toward FAST_MAX_FALL while holding down. */
  maxFall: number;
  /** The speed a held jump keeps, while `varJump` lasts. */
  varJumpSpeed: number;
  stamina: number;
  /** The speed a wall stopped, kept for `wallSpeedTimer` in case the way clears. */
  wallSpeedRetained: number;
  /** After a wall jump, the horizontal input is this (away from the wall) for `forceMoveTime`. */
  forceMoveX: number;
  /** After a climb jump with nothing held: pushing this way within `wallBoostTimer` makes it a wall jump. */
  wallBoostDir: number;
  /** After a hop over a wall's top: the speed to take once the wall is passed, and which way (0 none). */
  hopWaitX: number;
  hopWaitXSpeed: number;
  /** -1 climbing up, 1 down, 0 still: what stamina is spent on. */
  lastClimbMove: number;
  // Timers, in seconds left.
  coyote: number;
  buffer: number;
  dashBuffer: number;
  varJump: number;
  dashTime: number;
  dashCooldown: number;
  dashRefillCooldown: number;
  dashAttack: number;
  forceMoveTime: number;
  wallSlideTimer: number;
  wallSpeedTimer: number;
  wallBoostTimer: number;
  climbNoMove: number;
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
  /** Held to hold onto a wall. */
  grab: boolean;
}

export const NO_CONTROLS: Controls = { left: false, right: false, up: false, down: false, jumpHeld: false, jumpPressed: false, dashPressed: false, grab: false };

/** Whether the pixel at (x, y), in the room, is solid. */
export type SolidAt = (x: number, y: number) => boolean;

/** A body standing still at (x, y) (the standing hitbox's top left) with a dash ready. */
export function newBody(x: number, y: number): Body {
  return {
    x, y, rx: 0, ry: 0, vx: 0, vy: 0, facing: 1, onGround: false, ducking: false, sliding: false, dashing: false, dashStarting: false, climbing: false,
    dashes: K.DASH_COUNT, dashX: 0, dashY: 0, beforeDashX: 0, dashStartedOnGround: false, autoJump: false, maxFall: K.MAX_FALL, varJumpSpeed: 0,
    stamina: K.CLIMB_MAX_STAMINA, wallSpeedRetained: 0, forceMoveX: 0, wallBoostDir: 0, hopWaitX: 0, hopWaitXSpeed: 0, lastClimbMove: 0,
    coyote: 0, buffer: 0, dashBuffer: 0, varJump: 0, dashTime: 0, dashCooldown: 0, dashRefillCooldown: 0, dashAttack: 0, forceMoveTime: 0,
    wallSlideTimer: K.WALL_SLIDE_TIME, wallSpeedTimer: 0, wallBoostTimer: 0, climbNoMove: 0,
  };
}

/** The hitbox's height now. */
export function heightOf(b: Body): number {
  return b.ducking ? DUCK_H : BODY_H;
}

/** Which animation of the character's sheet shows this body (`dead`: the run's, not the body's). */
export function animationOf(b: Body, dead: boolean): string {
  if (dead) return "die";
  if (b.dashing) return "dash";
  if (b.climbing || b.sliding) return "wall";
  if (!b.onGround) return b.vy < 0 ? "jump" : "fall";
  return Math.abs(b.vx) > 12 && !b.ducking ? "run" : "idle";
}

/** Is any pixel of a hitbox `h` tall with its top left at (x, y) solid? */
export function hits(solid: SolidAt, x: number, y: number, h: number = BODY_H): boolean {
  // The hitbox is smaller than a tile on both axes, so its corners and the middles of its edges are enough.
  const right = x + BODY_W - 1;
  const bottom = y + h - 1;
  const midY = y + (h >> 1);
  const midX = x + (BODY_W >> 1);
  return (
    solid(x, y) || solid(right, y) || solid(x, bottom) || solid(right, bottom) || solid(x, midY) || solid(right, midY) || solid(midX, y) || solid(midX, bottom)
  );
}

function approach(value: number, target: number, amount: number): number {
  return value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
}

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** One step of `dt` seconds. Returns the next body; `body` is not changed. What happened is pushed onto `events`. */
export function stepBody(body: Body, c: Controls, solid: SolidAt, dt: number, events: GameEvent[] = []): Body {
  return new Stepper({ ...body }, c, solid, dt, events).step();
}

/** One step's work, on a copy of the body. A class only so the many small parts share the step's inputs. */
class Stepper {
  readonly b: Body;
  readonly c: Controls;
  readonly solid: SolidAt;
  readonly dt: number;
  readonly events: GameEvent[];
  readonly moveY: number;
  moveX: number;

  constructor(b: Body, c: Controls, solid: SolidAt, dt: number, events: GameEvent[]) {
    this.b = b;
    this.c = c;
    this.solid = solid;
    this.dt = dt;
    this.events = events;
    this.moveX = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    this.moveY = (c.down ? 1 : 0) - (c.up ? 1 : 0);
  }

  // -- what the hitbox touches --------------------------------------------------------------------------------------

  hitsAt(dx: number, dy: number, h: number = heightOf(this.b)): boolean {
    return hits(this.solid, this.b.x + dx, this.b.y + dy, h);
  }

  get canUnDuck(): boolean {
    return !this.b.ducking || !hits(this.solid, this.b.x, this.b.y + DUCK_H - BODY_H, BODY_H);
  }

  get tired(): boolean {
    return this.b.stamina < K.CLIMB_TIRED_THRESHOLD;
  }

  get canDash(): boolean {
    return this.b.dashBuffer > 0 && this.b.dashCooldown <= 0 && this.b.dashes > 0;
  }

  duck(): void {
    if (this.b.ducking) return;
    this.b.ducking = true;
    this.b.y += BODY_H - DUCK_H;
  }

  unDuck(): void {
    if (!this.b.ducking) return;
    this.b.ducking = false;
    this.b.y -= BODY_H - DUCK_H;
  }

  wallJumpCheck(dir: number): boolean {
    return this.hitsAt(dir * K.WALL_JUMP_CHECK_DIST, 0);
  }

  climbCheck(dir: number, yAdd = 0): boolean {
    return this.hitsAt(dir * K.CLIMB_CHECK_DIST, yAdd);
  }

  /** Is the wall's top beside the body clear, so a climb up there would go over it? */
  slipCheck(addY = 0): boolean {
    const b = this.b;
    const px = b.facing > 0 ? b.x + BODY_W : b.x - 1;
    const py = b.y + 4 + addY;
    return !this.solid(px, py) && !this.solid(px, py - 4 + addY);
  }

  // -- the step -----------------------------------------------------------------------------------------------------

  step(): Body {
    const { b, c, dt } = this;
    // Timers and buffers.
    b.buffer = c.jumpPressed ? K.JUMP_BUFFER : b.buffer - dt;
    b.dashBuffer = c.dashPressed ? K.DASH_BUFFER : b.dashBuffer - dt;
    if (b.varJump > 0) b.varJump -= dt;
    b.dashCooldown -= dt;
    b.dashRefillCooldown -= dt;
    b.dashAttack -= dt;

    // The ground: refills the jump's grace, stamina and the dash.
    const wasOnGround = b.onGround;
    b.onGround = b.vy >= 0 && this.hitsAt(0, 1);
    if (b.onGround) {
      b.coyote = K.COYOTE;
      if (!b.climbing) {
        b.autoJump = false;
        b.stamina = K.CLIMB_MAX_STAMINA;
        b.wallSlideTimer = K.WALL_SLIDE_TIME;
      }
    } else b.coyote -= dt;
    if (b.dashRefillCooldown <= 0 && b.onGround) b.dashes = K.DASH_COUNT;

    // Input held away from a wall after a wall jump.
    if (b.forceMoveTime > 0) {
      b.forceMoveTime -= dt;
      this.moveX = b.forceMoveX;
    }
    // A climb jump turned into a wall jump by pushing away.
    if (b.wallBoostTimer > 0) {
      b.wallBoostTimer -= dt;
      if (this.moveX === b.wallBoostDir) {
        b.vx = K.WALL_JUMP_H_SPEED * this.moveX;
        b.stamina += K.CLIMB_JUMP_COST;
        b.wallBoostTimer = 0;
      }
    }
    if (b.sliding) b.wallSlideTimer = Math.max(b.wallSlideTimer - dt, 0);
    b.sliding = false;
    if (this.moveX !== 0 && !b.climbing) b.facing = this.moveX;
    // Speed into a wall kept a moment, and the hop over a wall's top waiting for the top to pass.
    if (b.wallSpeedTimer > 0) {
      if (sign(b.vx) === -sign(b.wallSpeedRetained)) b.wallSpeedTimer = 0;
      else if (!this.hitsAt(sign(b.wallSpeedRetained), 0)) {
        b.vx = b.wallSpeedRetained;
        b.wallSpeedTimer = 0;
      } else b.wallSpeedTimer -= dt;
    }
    if (b.hopWaitX !== 0) {
      if (sign(b.vx) === -b.hopWaitX || b.vy > 0) b.hopWaitX = 0;
      else if (!this.hitsAt(b.hopWaitX, 0)) {
        b.vx = b.hopWaitXSpeed;
        b.hopWaitX = 0;
      }
    }

    if (b.dashing) this.dashUpdate();
    else if (b.climbing) this.climbUpdate();
    else this.normalUpdate();

    // Before moving: a horizontal dash just above the floor meets it; a falling duck stands up where there is room.
    if (!b.onGround && b.dashAttack > 0 && b.dashing && b.dashY === 0 && !b.dashStarting) {
      if (this.hitsAt(0, K.DASH_V_FLOOR_SNAP_DIST)) for (let i = 0; i < K.DASH_V_FLOOR_SNAP_DIST && !this.hitsAt(0, 1); i++) b.y++;
    }
    if (b.vy > 0 && b.ducking && this.canUnDuck && !b.onGround) this.unDuck();

    const fall = b.vy;
    this.moveH(b.vx * dt);
    this.moveV(b.vy * dt, fall, wasOnGround);
    return b;
  }

  // -- the normal state: running, falling, jumping, grabbing ----------------------------------------------------------

  normalUpdate(): void {
    const { b, c, dt, moveX, moveY } = this;
    // Grab a wall: beside it now, or just below its edge.
    if (c.grab && !this.tired && !b.ducking) {
      if (b.vy >= 0 && sign(b.vx) !== -b.facing) {
        if (this.climbCheck(b.facing)) return this.climbBegin();
        if (moveY < 1) {
          for (let i = 1; i <= K.CLIMB_UP_CHECK_DIST; i++) {
            if (!this.hitsAt(0, -i) && this.climbCheck(b.facing, -i)) {
              b.y -= i;
              return this.climbBegin();
            }
          }
        }
      }
    }
    if (this.canDash) return this.startDash();

    // Ducking.
    if (b.ducking) {
      if (b.onGround && moveY !== 1 && this.canUnDuck) {
        this.unDuck();
        this.events.push({ type: "stand", x: b.x + BODY_W / 2, y: b.y + BODY_H });
      }
    } else if (b.onGround && moveY === 1 && b.vy >= 0) {
      this.duck();
      this.events.push({ type: "duck", x: b.x + BODY_W / 2, y: b.y + DUCK_H });
    }

    // Running, and slowing toward the run speed when faster (a super jump, a dash) in the direction held.
    if (b.ducking && b.onGround) b.vx = approach(b.vx, 0, K.DUCK_FRICTION * dt);
    else {
      const mult = b.onGround ? 1 : K.AIR_MULT;
      if (Math.abs(b.vx) > K.RUN_SPEED && sign(b.vx) === moveX) b.vx = approach(b.vx, K.RUN_SPEED * moveX, K.RUN_REDUCE * mult * dt);
      else b.vx = approach(b.vx, K.RUN_SPEED * moveX, K.RUN_ACCEL * mult * dt);
    }

    // The fall cap: holding down raises it gradually.
    if (moveY === 1 && b.vy >= K.MAX_FALL) b.maxFall = approach(b.maxFall, K.FAST_MAX_FALL, K.FAST_MAX_ACCEL * dt);
    else b.maxFall = approach(b.maxFall, K.MAX_FALL, K.FAST_MAX_ACCEL * dt);

    // Gravity, halved near the top of a held jump; a wall slide starts slow and speeds up the longer it lasts.
    if (!b.onGround) {
      let max = b.maxFall;
      if ((moveX === b.facing || (moveX === 0 && c.grab)) && moveY !== 1) {
        if (b.vy >= 0 && b.wallSlideTimer > 0 && this.hitsAt(b.facing, 0) && this.canUnDuck) {
          this.unDuck();
          b.sliding = true;
        }
      }
      if (b.sliding) max = K.MAX_FALL + (K.WALL_SLIDE_START_MAX - K.MAX_FALL) * (b.wallSlideTimer / K.WALL_SLIDE_TIME);
      const mult = Math.abs(b.vy) < K.HALF_GRAV_THRESHOLD && (c.jumpHeld || b.autoJump) ? 0.5 : 1;
      b.vy = approach(b.vy, max, K.GRAVITY * mult * dt);
    }

    // A held jump keeps its speed for a while; letting go ends that.
    if (b.varJump > 0) {
      if (b.autoJump || c.jumpHeld) b.vy = Math.min(b.vy, b.varJumpSpeed);
      else b.varJump = 0;
    }

    // Jumping: from the ground (or just after leaving it), else off a wall within reach.
    if (b.buffer > 0) {
      if (b.coyote > 0) this.jump();
      else if (this.canUnDuck) {
        for (const side of [1, -1]) {
          if (!this.wallJumpCheck(side)) continue;
          if (b.facing === side && c.grab && b.stamina > 0) this.climbJump();
          else if (b.dashAttack > 0 && b.dashX === 0 && b.dashY === -1) this.superWallJump(-side);
          else this.wallJump(-side);
          break;
        }
      }
    }
  }

  /** What every jump resets. */
  jumpResets(varJump: number): void {
    const b = this.b;
    b.buffer = 0;
    b.coyote = 0;
    b.varJump = varJump;
    b.autoJump = false;
    b.dashAttack = 0;
    b.wallSlideTimer = K.WALL_SLIDE_TIME;
    b.wallBoostTimer = 0;
  }

  jump(): void {
    const b = this.b;
    this.jumpResets(K.VAR_JUMP_TIME);
    b.vx += K.JUMP_H_BOOST * this.moveX;
    b.vy = -K.JUMP_SPEED;
    b.varJumpSpeed = b.vy;
    this.events.push({ type: "jump", x: b.x + BODY_W / 2, y: b.y + heightOf(b) });
  }

  /** A jump during a horizontal dash on the ground: long and low, longer and lower ducking (a hyper). */
  superJump(): void {
    const b = this.b;
    this.jumpResets(K.VAR_JUMP_TIME);
    b.vx = K.SUPER_JUMP_H * b.facing;
    b.vy = -K.JUMP_SPEED;
    if (b.ducking) {
      this.unDuck();
      b.vx *= K.DUCK_SUPER_JUMP_X_MULT;
      b.vy *= K.DUCK_SUPER_JUMP_Y_MULT;
    }
    b.varJumpSpeed = b.vy;
    this.events.push({ type: "jump", x: b.x + BODY_W / 2, y: b.y + heightOf(b) });
  }

  /** Off a wall: `dir` is away from it. With a direction held, it is held away for a moment. */
  wallJump(dir: number): void {
    const b = this.b;
    this.unDuck();
    this.jumpResets(K.VAR_JUMP_TIME);
    if (this.moveX !== 0) {
      b.forceMoveX = dir;
      b.forceMoveTime = K.WALL_JUMP_FORCE_TIME;
    }
    b.vx = K.WALL_JUMP_H_SPEED * dir;
    b.vy = -K.JUMP_SPEED;
    b.varJumpSpeed = b.vy;
    this.events.push({ type: "wallJump", x: dir > 0 ? b.x : b.x + BODY_W, y: b.y + heightOf(b), wall: -dir });
  }

  /** A jump off a wall during a dash straight up: the wall bounce. */
  superWallJump(dir: number): void {
    const b = this.b;
    this.unDuck();
    this.jumpResets(K.SUPER_WALL_JUMP_VAR_TIME);
    b.vx = K.SUPER_WALL_JUMP_H * dir;
    b.vy = -K.SUPER_WALL_JUMP_SPEED;
    b.varJumpSpeed = b.vy;
    this.events.push({ type: "wallJump", x: dir > 0 ? b.x : b.x + BODY_W, y: b.y + heightOf(b), wall: -dir });
  }

  /** A jump straight up a wall held onto. Costs stamina in the air; push away just after to make it a wall jump. */
  climbJump(): void {
    const b = this.b;
    if (!b.onGround) b.stamina -= K.CLIMB_JUMP_COST;
    this.jump();
    if (this.moveX === 0) {
      b.wallBoostDir = -b.facing;
      b.wallBoostTimer = K.CLIMB_JUMP_BOOST_TIME;
    }
  }

  // -- the dash -----------------------------------------------------------------------------------------------------

  startDash(): void {
    const b = this.b;
    b.dashes = Math.max(0, b.dashes - 1);
    b.dashBuffer = 0;
    b.climbing = false;
    b.dashing = true;
    b.dashStarting = true;
    b.dashStartedOnGround = b.onGround;
    b.dashCooldown = K.DASH_COOLDOWN;
    b.dashRefillCooldown = K.DASH_REFILL_COOLDOWN;
    b.wallSlideTimer = K.WALL_SLIDE_TIME;
    b.dashAttack = K.DASH_ATTACK_TIME;
    b.beforeDashX = b.vx;
    b.vx = 0;
    b.vy = 0;
    b.dashX = 0;
    b.dashY = 0;
    if (!b.onGround && b.ducking && this.canUnDuck) this.unDuck();
    this.events.push({ type: "dash", x: b.x + BODY_W / 2, y: b.y + heightOf(b) / 2 });
  }

  dashUpdate(): void {
    const { b, dt } = this;
    // Jumps out of a dash: a super jump on the ground, a wall bounce going straight up, a wall jump otherwise.
    if (b.buffer > 0 && this.canUnDuck) {
      if (b.dashY === 0) {
        if (b.coyote > 0) {
          this.superJump();
          return this.endDashState();
        }
      } else {
        const up = b.dashX === 0 && b.dashY === -1;
        for (const side of [1, -1]) {
          if (!this.wallJumpCheck(side)) continue;
          if (up) this.superWallJump(-side);
          else this.wallJump(-side);
          return this.endDashState();
        }
      }
    }

    if (b.dashStarting) {
      // The direction is read now, after the freeze: eight ways from what is held, the way the body faces when nothing is.
      b.dashStarting = false;
      let dx = this.moveX;
      let dy = this.moveY;
      if (dx === 0 && dy === 0) dx = b.facing;
      const length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
      b.vx = dx * K.DASH_SPEED;
      b.vy = dy * K.DASH_SPEED;
      if (sign(b.vx) === sign(b.beforeDashX) && Math.abs(b.beforeDashX) > Math.abs(b.vx)) b.vx = b.beforeDashX;
      b.dashX = dx;
      b.dashY = dy;
      if (dx !== 0) b.facing = sign(dx);
      // Dashing down at an angle on the ground slides along it, ducked: the start of a wavedash.
      if (b.onGround && dx !== 0 && dy > 0 && b.vy > 0) this.dashSlide();
      b.dashTime = K.DASH_TIME;
      return;
    }
    b.dashTime -= dt;
    if (b.dashTime <= 0) {
      // The dash ends: up or sideways it slows to END_DASH_SPEED (less going up); down it keeps its speed.
      b.autoJump = true;
      if (b.dashY <= 0) {
        b.vx = b.dashX * K.END_DASH_SPEED;
        b.vy = b.dashY * K.END_DASH_SPEED;
        if (b.vy < 0) b.vy *= K.END_DASH_UP_MULT;
      }
      this.endDashState();
    }
  }

  dashSlide(): void {
    const b = this.b;
    b.dashX = sign(b.dashX);
    b.dashY = 0;
    b.vy = 0;
    b.vx *= 1.2;
    this.duck();
  }

  endDashState(): void {
    this.b.dashing = false;
    this.b.dashStarting = false;
    this.b.dashTime = 0;
  }

  // -- climbing -----------------------------------------------------------------------------------------------------

  climbBegin(): void {
    const b = this.b;
    b.climbing = true;
    b.autoJump = false;
    b.vx = 0;
    b.vy *= K.CLIMB_GRAB_Y_MULT;
    b.wallSlideTimer = K.WALL_SLIDE_TIME;
    b.climbNoMove = K.CLIMB_NO_MOVE_TIME;
    b.wallBoostTimer = 0;
    b.lastClimbMove = 0;
    for (let i = 0; i < K.CLIMB_CHECK_DIST; i++) {
      if (!this.hitsAt(b.facing, 0)) b.x += b.facing;
      else break;
    }
  }

  climbUpdate(): void {
    const { b, c, dt, moveY } = this;
    b.climbNoMove -= dt;
    if (b.onGround) b.stamina = K.CLIMB_MAX_STAMINA;
    if (b.buffer > 0 && this.canUnDuck) {
      b.climbing = false;
      if (this.moveX === -b.facing) this.wallJump(-b.facing);
      else this.climbJump();
      return;
    }
    if (this.canDash) return this.startDash();
    if (!c.grab) {
      b.climbing = false;
      return;
    }
    if (!this.hitsAt(b.facing, 0)) {
      // The wall ended beside the body: going up, hop over its top.
      if (b.vy < 0) this.climbHop();
      b.climbing = false;
      return;
    }
    let target = 0;
    let trySlip = false;
    if (b.climbNoMove <= 0) {
      if (moveY === -1) {
        target = -K.CLIMB_UP_SPEED;
        if (this.hitsAt(0, -1) || (this.hitsAt(0, -6) && this.slipCheck(-1))) {
          if (b.vy < 0) b.vy = 0;
          target = 0;
          trySlip = true;
        } else if (this.slipCheck()) {
          this.climbHop();
          b.climbing = false;
          return;
        }
      } else if (moveY === 1) {
        target = K.CLIMB_DOWN_SPEED;
        if (b.onGround) {
          if (b.vy > 0) b.vy = 0;
          target = 0;
        }
      } else trySlip = true;
    } else trySlip = true;
    b.lastClimbMove = sign(target);
    // Holding on where the wall's top is beside the hands: the hands slip down to it.
    if (trySlip && this.slipCheck()) target = K.CLIMB_SLIP_SPEED;
    b.vy = approach(b.vy, target, K.CLIMB_ACCEL * dt);
    // Not climbing down off the bottom of a wall.
    if (moveY !== 1 && b.vy > 0 && !this.hitsAt(b.facing, 1)) b.vy = 0;
    if (b.climbNoMove <= 0) {
      if (b.lastClimbMove === -1) b.stamina -= K.CLIMB_UP_COST * dt;
      else if (b.lastClimbMove === 0) b.stamina -= K.CLIMB_STILL_COST * dt;
    }
    if (b.stamina <= 0) b.climbing = false;
  }

  /** Over the top of a wall: up first, and across once the top is passed. */
  climbHop(): void {
    const b = this.b;
    if (this.hitsAt(b.facing, 0)) {
      b.hopWaitX = b.facing;
      b.hopWaitXSpeed = b.facing * K.CLIMB_HOP_X;
    } else {
      b.hopWaitX = 0;
      b.vx = b.facing * K.CLIMB_HOP_X;
    }
    b.vy = Math.min(b.vy, -K.CLIMB_HOP_Y);
    b.forceMoveX = 0;
    b.forceMoveTime = K.CLIMB_HOP_FORCE_TIME;
  }

  // -- moving, a pixel at a time (the engine's mover), with Celeste's collision rules as its callbacks ----------------

  readonly blocked = (x: number, y: number): boolean => hits(this.solid, x, y, heightOf(this.b));

  moveH(amount: number): void {
    moveActorX(this.b, amount, this.blocked, (dir) => this.onCollideH(dir));
  }

  /** Blocked moving sideways: a dash may duck into a low gap or slide past a corner; otherwise the speed stops (and is kept a moment). */
  onCollideH(dir: number): void {
    const b = this.b;
    if (b.dashing) {
      if (b.onGround && !b.ducking && !hits(this.solid, b.x + dir, b.y + BODY_H - DUCK_H, DUCK_H)) {
        this.duck();
        return;
      }
      if (b.vy === 0 && b.vx !== 0) {
        for (let i = 1; i <= K.DASH_CORNER_CORRECTION; i++) {
          for (const j of [1, -1]) {
            if (!this.hitsAt(dir, i * j)) {
              b.y += i * j;
              b.x += dir;
              return;
            }
          }
        }
      }
    }
    if (b.wallSpeedTimer <= 0) {
      b.wallSpeedRetained = b.vx;
      b.wallSpeedTimer = K.WALL_SPEED_RETENTION_TIME;
    }
    b.vx = 0;
    b.dashAttack = 0;
  }

  moveV(amount: number, fall: number, wasOnGround: boolean): void {
    const b = this.b;
    moveActorY(b, amount, this.blocked, (dir) => this.onCollideV(dir));
    // Where the body stands now, and a landing.
    b.onGround = b.vy >= 0 && this.hitsAt(0, 1);
    if (b.onGround && !wasOnGround && fall > 0 && !b.climbing) this.events.push({ type: "land", x: b.x + BODY_W / 2, y: b.y + heightOf(b), speed: fall });
    if (b.onGround) b.sliding = false;
  }

  /** Blocked moving up or down: a dash landing by a ledge slides off it, a jump into a corner slides past it; otherwise the speed stops. */
  onCollideV(dir: number): void {
    const b = this.b;
    if (dir > 0) {
      // A dash landing just past a ledge slides off it instead of landing on its corner.
      if (b.dashing && !b.dashStartedOnGround) {
        for (const side of b.vx <= 0 ? [-1] : b.vx > 0 ? [1] : []) {
          for (let i = 1; i <= K.DASH_CORNER_CORRECTION; i++) {
            if (!this.hitsAt(side * i, 1) && !this.hitsAt(side * i, 0)) {
              b.x += side * i;
              b.y += 1;
              return;
            }
          }
        }
      }
      // Landing in a dash down at an angle: slide along the ground, ducked (a wavedash).
      if (b.dashing && b.dashX !== 0 && b.dashY > 0) this.dashSlide();
    } else {
      // Moving up into a corner: slide past it, the way the body is moving.
      const sides = b.vx < 0 ? [-1] : b.vx > 0 ? [1] : [-1, 1];
      for (const side of sides) {
        for (let i = 1; i <= K.UPWARD_CORNER_CORRECTION; i++) {
          if (!this.hitsAt(side * i, -1)) {
            b.x += side * i;
            b.y -= 1;
            return;
          }
        }
      }
      if (b.varJump < K.VAR_JUMP_TIME - K.CEILING_VAR_JUMP_GRACE) b.varJump = 0;
    }
    b.vy = 0;
    b.dashAttack = 0;
  }
}
