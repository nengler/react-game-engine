import * as K from "../constants.ts";

/**
 * What the body is doing, which decides how a step moves it:
 * - `"normal"`: running, falling, jumping (`normal.ts`).
 * - `"dash"`: a dash, from the press to its end (`dash.ts`).
 * - `"climb"`: holding onto a wall (`climb.ts`).
 */
export type BodyState = "normal" | "dash" | "climb";

/**
 * The character's body, as numbers and flags: where it is and how fast it goes, what it is doing, and the timers that make
 * Celeste's movement forgiving (a jump pressed a little early or late still happens). A plain object, so the game state holds
 * it, components read it and tests build one.
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
  state: BodyState;
  onGround: boolean;
  /** The hitbox is the short one (8 × 6); `y` is its top, so ducking moves `y` down and standing moves it back. */
  ducking: boolean;
  /** Sliding down a wall this step (holding toward it, falling). */
  sliding: boolean;

  // -- the dash ------------------------------------------------------------------------------------------------------
  /** Dashes left before touching the ground again. */
  dashes: number;
  /** The first step of a dash, which only reads the direction (Celeste's one frame between starting and moving). */
  dashStarting: boolean;
  /** The dash's direction, a unit vector (0, 0 before it is known). */
  dashX: number;
  dashY: number;
  /** Horizontal speed when the dash started: kept if it was faster in the dash's direction. */
  beforeDashX: number;
  /** Started on the ground: a landing then does not correct around a ledge. */
  dashStartedOnGround: boolean;
  /** After a dash ends, until landing or jumping, gravity is halved near the top as if jump were held. */
  autoJump: boolean;

  // -- falling and jumping -------------------------------------------------------------------------------------------
  /** The fall cap now: MAX_FALL, raised toward FAST_MAX_FALL while holding down. */
  maxFall: number;
  /** The speed a held jump keeps, while `varJump` lasts. */
  varJumpSpeed: number;
  /** After a wall jump, the horizontal input is this (away from the wall) for `forceMoveTime`. */
  forceMoveX: number;
  /** The speed a wall stopped, kept for `wallSpeedTimer` in case the way clears. */
  wallSpeedRetained: number;

  // -- climbing ------------------------------------------------------------------------------------------------------
  stamina: number;
  /** After a climb jump with nothing held: pushing this way within `wallBoostTimer` makes it a wall jump. */
  wallBoostDir: number;
  /** After a hop over a wall's top: the speed to take once the wall is passed, and which way (0 none). */
  hopWaitX: number;
  hopWaitXSpeed: number;
  /** -1 climbing up, 1 down, 0 still: what stamina is spent on. */
  lastClimbMove: number;

  // -- timers, in seconds left ---------------------------------------------------------------------------------------
  /** Since leaving the ground: a jump still happens while this lasts. */
  coyote: number;
  /** Since jump or dash was pressed: it still happens while this lasts. */
  buffer: number;
  dashBuffer: number;
  /** A held jump keeps its speed while this lasts. */
  varJump: number;
  dashTime: number;
  dashCooldown: number;
  dashRefillCooldown: number;
  /** Counts as dashing for a wall bounce while this lasts. */
  dashAttack: number;
  forceMoveTime: number;
  /** How much wall slide is left before it is a fall: it starts slow and speeds up as this runs down. */
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
    x, y, rx: 0, ry: 0, vx: 0, vy: 0, facing: 1, state: "normal", onGround: false, ducking: false, sliding: false,
    dashes: K.DASH_COUNT, dashStarting: false, dashX: 0, dashY: 0, beforeDashX: 0, dashStartedOnGround: false, autoJump: false,
    maxFall: K.MAX_FALL, varJumpSpeed: 0, forceMoveX: 0, wallSpeedRetained: 0,
    stamina: K.CLIMB_MAX_STAMINA, wallBoostDir: 0, hopWaitX: 0, hopWaitXSpeed: 0, lastClimbMove: 0,
    coyote: 0, buffer: 0, dashBuffer: 0, varJump: 0, dashTime: 0, dashCooldown: 0, dashRefillCooldown: 0, dashAttack: 0, forceMoveTime: 0,
    wallSlideTimer: K.WALL_SLIDE_TIME, wallSpeedTimer: 0, wallBoostTimer: 0, climbNoMove: 0,
  };
}
