/**
 * Every number the rules use, in one place. A number marked "(guess)" has not been played yet; it is a first value to tune.
 */
export const SCREEN_W = 320;
export const SCREEN_H = 180;
export const TILE = 16;

/** The character's hitbox, in pixels, and where it sits in a tile when placed on one (centred). */
export const BODY = 10;
export const BODY_OFFSET = (TILE - BODY) / 2;
/** Walking speed in pixels a second, the same in every direction (diagonals are normalised). (guess) */
export const SPEED = 56;
/** How far in front of the character's centre the action reaches, in pixels. (guess) */
export const REACH = 12;

export const MAX_HEARTS = 5;
export const INVENTORY_SLOTS = 8;
/** How long a notice ("Got the lantern") stays up, in seconds. (guess) */
export const NOTICE_SECONDS = 2.5;
/** Bells that open the gate. */
export const BELLS_NEEDED = 3;
/** The save format's version: a save of another version is ignored. */
export const SAVE_VERSION = 1;
