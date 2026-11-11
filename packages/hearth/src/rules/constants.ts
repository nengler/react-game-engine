/** The playfield is 24 × 18 tiles of 10 pixels (240 × 180); the side panel takes the right 80 pixels of the 320 × 180 screen. */
export const TILE = 10;
export const FIELD_COLS = 24;
export const FIELD_ROWS = 18;
export const FIELD_W = FIELD_COLS * TILE;
export const FIELD_H = FIELD_ROWS * TILE;
export const SCREEN_W = 320;
export const SCREEN_H = 180;
export const PANEL_W = SCREEN_W - FIELD_W;

/** The rules run in fixed steps of this many seconds (2× speed is two of them per engine step). */
export const STEP = 1 / 60;

export const START_GOLD = 120;
export const START_LIVES = 20;
/** HP of every enemy grows by this fraction per wave (0.15 in the first plan; the balance table asked for more): wave 1 is 1×, wave 10 is 2.8×. */
export const HP_PER_WAVE = 0.2;
/** Gold for clearing a wave. */
export const WAVE_BONUS = 15;
/** A tower sells for this share of everything spent on it. */
export const SELL_SHARE = 0.7;
/** How far an enemy is pushed sideways of the path, at most, so a crowd is not one line. */
export const LANE_SPREAD = 3;
/** Seconds an enemy shows its hit flash. */
export const FLASH = 0.12;
/** How long a shot's picture stays (a bolt's tracer, a frost ring). */
export const TRACER = 0.12;
