/**
 * Every number that sets how the character moves and how the rooms are laid out, in one place. Units: pixels, seconds,
 * pixels per second. The movement values are Celeste's (Maddy Thorson and Noel Berry's `Player.cs`, released as source),
 * by the same names where they have one, since Kite's pixel scale is close to Celeste's (an 8 × 11 hitbox in a 320 × 180
 * view; Kite's tiles are 10 pixels, Celeste's 8). `test/movement.test.ts` checks the properties that must keep holding.
 */

// -- the world: a room is one screen ---------------------------------------------------------------------------------

export const TILE = 10;
export const ROOM_COLS = 32;
export const ROOM_ROWS = 18;
export const ROOM_W = TILE * ROOM_COLS; // 320
export const ROOM_H = TILE * ROOM_ROWS; // 180

// -- the body ------------------------------------------------------------------------------------------------------

/** The hitbox: 8 × 11 standing, 8 × 6 ducking (its bottom stays put). */
export const BODY_W = 8;
export const BODY_H = 11;
export const DUCK_H = 6;

// -- running -------------------------------------------------------------------------------------------------------

/** MaxRun, RunAccel, RunReduce (slowing toward the run speed when moving faster, the way held), AirMult. */
export const RUN_SPEED = 90;
export const RUN_ACCEL = 1000;
export const RUN_REDUCE = 400;
export const AIR_MULT = 0.65;
/** Slowing down while ducking on the ground. */
export const DUCK_FRICTION = 500;

// -- falling and jumping -------------------------------------------------------------------------------------------

export const GRAVITY = 900;
/** Below this vertical speed, with jump held (or after a dash), gravity is halved: the floaty apex. */
export const HALF_GRAV_THRESHOLD = 40;
export const MAX_FALL = 160;
/** Holding down while falling raises the fall cap toward this, at FAST_MAX_ACCEL a second. */
export const FAST_MAX_FALL = 240;
export const FAST_MAX_ACCEL = 300;
export const JUMP_SPEED = 105;
/** Speed added in the direction held when a jump starts. */
export const JUMP_H_BOOST = 40;
/** While jump is held, the jump's speed is kept this long. Let go sooner for a lower jump. */
export const VAR_JUMP_TIME = 0.2;
/** Hitting a ceiling this soon after a jump keeps the held jump going (the corner may have been corrected). */
export const CEILING_VAR_JUMP_GRACE = 0.05;
/** A press this long before it can act still acts (Celeste's input buffer, for jump and dash alike). */
export const JUMP_BUFFER = 0.08;
export const DASH_BUFFER = 0.08;
/** A jump pressed this long after walking off a ledge still happens (jumpGraceTime, "coyote time"). */
export const COYOTE = 0.1;
/** Moving up into a ceiling corner this many pixels from clear slides the body past it. */
export const UPWARD_CORNER_CORRECTION = 4;

// -- super jumps ---------------------------------------------------------------------------------------------------

/** A jump during a horizontal dash on the ground: a long, low jump. Ducking (a hyper) makes it longer and flatter. */
export const SUPER_JUMP_H = 260;
export const DUCK_SUPER_JUMP_X_MULT = 1.25;
export const DUCK_SUPER_JUMP_Y_MULT = 0.5;
/** A jump off a wall during a dash straight up: the wall bounce. */
export const SUPER_WALL_JUMP_SPEED = 160;
export const SUPER_WALL_JUMP_H = 170;
export const SUPER_WALL_JUMP_VAR_TIME = 0.25;

// -- the dash ------------------------------------------------------------------------------------------------------

export const DASH_SPEED = 240;
export const DASH_TIME = 0.15;
/** Speed in the dash's direction when it ends, unless it went down; upward, times END_DASH_UP_MULT. */
export const END_DASH_SPEED = 160;
export const END_DASH_UP_MULT = 0.75;
/** Dashes available between touching the ground. */
export const DASH_COUNT = 1;
/** After a dash starts, the next cannot start for this long, and the ground cannot refill it for DASH_REFILL_COOLDOWN. */
export const DASH_COOLDOWN = 0.2;
export const DASH_REFILL_COOLDOWN = 0.1;
/** How long after a dash starts it counts as a dash for a wall bounce. */
export const DASH_ATTACK_TIME = 0.3;
/** A horizontal dash into a corner this many pixels from clear slides past it; a dash landing near a ledge too. */
export const DASH_CORNER_CORRECTION = 4;
/** A horizontal dash this close above the floor is snapped down to it. */
export const DASH_V_FLOOR_SNAP_DIST = 3;
/** The world pauses this many fixed steps when a dash starts (Celeste's 0.05 s freeze). */
export const DASH_FREEZE_STEPS = 3;

// -- walls ---------------------------------------------------------------------------------------------------------

/** A wall this many pixels away counts for a wall jump. */
export const WALL_JUMP_CHECK_DIST = 3;
/** After a wall jump with a direction held, the direction is held away from the wall for this long. */
export const WALL_JUMP_FORCE_TIME = 0.16;
export const WALL_JUMP_H_SPEED = RUN_SPEED + JUMP_H_BOOST; // 130
/** A wall slide starts this slow and speeds up to MAX_FALL over WALL_SLIDE_TIME of sliding. */
export const WALL_SLIDE_START_MAX = 20;
export const WALL_SLIDE_TIME = 1.2;
/** Hitting a wall keeps the speed this long: if the way clears (a corner), the body carries on at it. */
export const WALL_SPEED_RETENTION_TIME = 0.06;

// -- climbing ------------------------------------------------------------------------------------------------------

export const CLIMB_MAX_STAMINA = 110;
/** Stamina a second climbing up, and holding still; a climb jump costs CLIMB_JUMP_COST at once. */
export const CLIMB_UP_COST = 100 / 2.2;
export const CLIMB_STILL_COST = 100 / 10;
export const CLIMB_JUMP_COST = 110 / 4;
/** Below this the character is tired and cannot start a climb. */
export const CLIMB_TIRED_THRESHOLD = 20;
/** A wall this many pixels away can be grabbed. */
export const CLIMB_CHECK_DIST = 2;
export const CLIMB_UP_CHECK_DIST = 2;
/** After grabbing, the character holds still this long. */
export const CLIMB_NO_MOVE_TIME = 0.1;
export const CLIMB_UP_SPEED = 45;
export const CLIMB_DOWN_SPEED = 80;
export const CLIMB_SLIP_SPEED = 30;
export const CLIMB_ACCEL = 900;
/** Grabbing keeps this much of the vertical speed. */
export const CLIMB_GRAB_Y_MULT = 0.2;
/** Climbing over the top of a wall: a hop up and over. */
export const CLIMB_HOP_Y = 120;
export const CLIMB_HOP_X = 100;
export const CLIMB_HOP_FORCE_TIME = 0.2;
/** After a climb jump with nothing held, pushing away within this long turns it into a wall jump (stamina back). */
export const CLIMB_JUMP_BOOST_TIME = 0.2;

// -- dying and moving on -------------------------------------------------------------------------------------------

/** From dying to being back at the room's start. Short: dying should cost little. */
export const RESPAWN_DELAY = 0.45;
/** Falling this far below the room, or this far past its sides, is a death. */
export const VOID_MARGIN = 24;
/** The world waits this long after a room exit while the camera slides to the next room. */
export const TRANSITION_TIME = 0.4;
/** Coming up into a room from below, the body arrives this far above the room's bottom edge, standing on its floor. */
export const ENTRY_LIFT = 20;

/** Steps the world stands still for when the character dies. */
export const DEATH_FREEZE_STEPS = 5;
