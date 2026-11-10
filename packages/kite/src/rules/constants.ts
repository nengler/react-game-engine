/**
 * Every number that sets how the character moves and how the rooms are laid out, in one place. Units: pixels, seconds,
 * pixels per second. Each group says where its values come from; a person tunes them by playing (the design note lists
 * what to try first), and `test/movement.test.ts` checks the properties that must keep holding when they change.
 *
 * The starting values are the usual ranges for this kind of platformer (a run of about 90 px/s, a jump of about 28 px,
 * a dash of about 36 px, gravity of 900 px/s², coyote and buffer windows of 0.1 s). None has been felt yet.
 */

// -- the world: a room is one screen ---------------------------------------------------------------------------------

export const TILE = 10;
export const ROOM_COLS = 32;
export const ROOM_ROWS = 18;
export const ROOM_W = TILE * ROOM_COLS; // 320
export const ROOM_H = TILE * ROOM_ROWS; // 180

// -- the body ------------------------------------------------------------------------------------------------------

/** The hitbox: a little under a tile wide and a tile and a bit tall, so 1-tile gaps are walkable and 1-tile ceilings are not. */
export const BODY_W = 8;
export const BODY_H = 11;

// -- running -------------------------------------------------------------------------------------------------------

export const RUN_SPEED = 90;
export const RUN_ACCEL = 1000;
/** Slowing down with nothing held, on the ground. */
export const GROUND_FRICTION = 1000;
/** Turning and speeding up in the air is a little less sharp than on the ground. */
export const AIR_CONTROL = 0.65;
/** Slowing down toward the run speed when something (a wall jump, a dash) left the body faster than it. */
export const OVER_SPEED_DECEL = 400;

// -- falling and jumping -------------------------------------------------------------------------------------------

export const GRAVITY = 900;
/** Near the top of a jump with the button held, gravity is halved below this vertical speed: a floaty apex. */
export const APEX_SPEED = 40;
export const MAX_FALL = 160;
export const FAST_FALL = 240;
export const JUMP_SPEED = 105;
/** Speed added in the direction held, at the start of a jump on the ground. */
export const JUMP_BOOST = 40;
/** While the button is held, the jump speed is kept this long: the longest, highest jump. Let go sooner for a lower one. */
export const JUMP_HOLD = 0.2;
/** A jump pressed this long before landing still happens when the body lands. */
export const JUMP_BUFFER = 0.1;
/** A jump pressed this long after walking off a ledge still happens. */
export const COYOTE = 0.1;
/** Moving up into a ceiling corner this many pixels from clear slides the body past it, so a jump does not stop on a corner. */
export const CORNER_FORGIVENESS = 3;

// -- the dash ------------------------------------------------------------------------------------------------------

export const DASH_SPEED = 240;
export const DASH_TIME = 0.15;
/** Speed in the dash's direction when it ends (an upward dash ends slower, so it does not rocket). */
export const DASH_END_SPEED = 160;
export const DASH_END_UP = 0.75;
/** Dashes available between touching the ground. */
export const DASH_COUNT = 1;
/** After a dash starts, the next cannot start for this long. */
export const DASH_COOLDOWN = 0.2;
/** The world pauses this many fixed steps when a dash starts: the game's feel hook, see `Player.tsx`. */
export const DASH_FREEZE_STEPS = 3;

// -- walls ---------------------------------------------------------------------------------------------------------

/** Sliding down a wall while holding toward it. */
export const WALL_SLIDE_SPEED = 40;
/** A wall this many pixels from the body counts as touching it, for sliding and jumping. */
export const WALL_REACH = 3;
export const WALL_JUMP_SPEED = 130;
/** After a wall jump, input pushing back toward the wall is ignored for this long. */
export const WALL_JUMP_LOCK = 0.16;

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
