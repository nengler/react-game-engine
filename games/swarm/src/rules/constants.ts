/** The numbers the run is tuned by. Distances are in world pixels, times in seconds. */

/** The game's canvas. */
export const SCREEN_WIDTH = 480;
export const SCREEN_HEIGHT = 270;

/** How long a run lasts if the player lives through it. */
export const RUN_LENGTH = 600;

export const PLAYER_SPEED = 75;
export const PLAYER_HP = 100;
/** Seconds the player cannot be hurt again after a hit. */
export const INVULN = 0.5;
/** How close an enemy's box must come to the player's middle to hurt them. */
export const TOUCH = 5;

/** Gems this close fly to the player; this close they are taken. */
export const MAGNET = 36;
export const PICKUP = 6;
/** At most this many gems lie on the ground; what more would drop goes into one already there. */
export const MAX_GEMS = 600;

/** Enemies come in on a ring this far from the player, just outside the view (its half diagonal is about 275). */
export const SPAWN_RADIUS = 290;
/** An enemy left this far behind comes back on the other side of the player, as in the genre. */
export const DESPAWN_RADIUS = 380;
/** At most this many enemies come in one step, so a jump in the target fills over a few steps. */
export const SPAWN_PER_STEP = 40;
/** The most enemies alive at once, unless a run is given another cap. */
export const ENEMY_CAP = 2500;

/**
 * Enemies keep apart: each pushes away from those whose boxes come within `SPACING` of its middle (`nearby` measures to the box,
 * not its middle, so a small number already reaches the ones touching it). Wider costs more than it shows: in a crowd of 2,000,
 * a reach of 7 found eleven neighbours a query and cost a third of the step.
 */
export const SPACING = 2;
/** How hard they push apart, in pixels a second at full overlap. */
export const PUSH = 40;

/** Seconds an enemy shows white after a hit. */
export const FLASH = 0.08;
/** How fast knockback dies away (a fraction kept per second). */
export const KNOCK_DECAY = 0.002;
