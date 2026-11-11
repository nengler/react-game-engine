/**
 * The boundary between the player and a native library, mirroring
 * `native/include/rge.h`, which is the source of truth: change the header first.
 * `test/protocol.test.ts` parses the header and fails if anything here differs.
 */

export const RGE_ABI_VERSION = 6;

// Draw records: a flat array of doubles, each record starting with its op.
export const RGE_OP_VIEW = 1;
export const RGE_OP_SPRITE = 2;
export const RGE_OP_RECT = 3;
export const RGE_OP_ELLIPSE = 4;
export const RGE_OP_TEXT = 5;
export const RGE_OP_SCISSOR = 6;
export const RGE_OP_SCISSOR_END = 7;
export const RGE_OP_CANVAS = 8;
export const RGE_OP_SPRITE_REGION = 9;

// Record lengths in doubles, op included.
export const RGE_OP_VIEW_LEN = 7;
export const RGE_OP_SPRITE_LEN = 7;
export const RGE_OP_RECT_LEN = 9;
export const RGE_OP_ELLIPSE_LEN = 9;
export const RGE_OP_TEXT_LEN = 9;
export const RGE_OP_SCISSOR_LEN = 5;
export const RGE_OP_SCISSOR_END_LEN = 1;
export const RGE_OP_CANVAS_LEN = 8;
export const RGE_OP_SPRITE_REGION_LEN = 15;

// Flags of a sprite region record.
export const RGE_SPRITE_FLIP_X = 1;
export const RGE_SPRITE_FLIP_Y = 2;

/** Voices a sound can play on at once: the native side's `RGE_SOUND_VOICES`. */
export const RGE_SOUND_VOICES = 4;

// Input buffer, written by the backend's `frame`.
export const RGE_IN_DT = 0;
export const RGE_IN_WIDTH = 1;
export const RGE_IN_HEIGHT = 2;
export const RGE_IN_MOUSE_X = 3;
export const RGE_IN_MOUSE_Y = 4;
export const RGE_IN_WHEEL = 5;
export const RGE_IN_QUIT = 6;
export const RGE_IN_LEN = 7;

// Per-key flags in the keys buffer.
export const RGE_KEY_DOWN = 1;
export const RGE_KEY_PRESSED = 2;
export const RGE_KEY_RELEASED = 4;

// Window options for `open`.
export const RGE_OPEN_RESIZABLE = 1;
export const RGE_OPEN_VSYNC = 2;
export const RGE_OPEN_HIDDEN = 4;
export const RGE_OPEN_SMOOTH = 8;
export const RGE_OPEN_SHARP = 16;

/** Every numeric `#define RGE_*` in the header, by its name there. The parity test walks this. */
export const PROTOCOL = {
  RGE_ABI_VERSION,
  RGE_OP_VIEW,
  RGE_OP_SPRITE,
  RGE_OP_RECT,
  RGE_OP_ELLIPSE,
  RGE_OP_TEXT,
  RGE_OP_SCISSOR,
  RGE_OP_SCISSOR_END,
  RGE_OP_CANVAS,
  RGE_OP_SPRITE_REGION,
  RGE_OP_VIEW_LEN,
  RGE_OP_SPRITE_LEN,
  RGE_OP_RECT_LEN,
  RGE_OP_ELLIPSE_LEN,
  RGE_OP_TEXT_LEN,
  RGE_OP_SCISSOR_LEN,
  RGE_OP_SCISSOR_END_LEN,
  RGE_OP_CANVAS_LEN,
  RGE_OP_SPRITE_REGION_LEN,
  RGE_SPRITE_FLIP_X,
  RGE_SPRITE_FLIP_Y,
  RGE_SOUND_VOICES,
  RGE_IN_DT,
  RGE_IN_WIDTH,
  RGE_IN_HEIGHT,
  RGE_IN_MOUSE_X,
  RGE_IN_MOUSE_Y,
  RGE_IN_WHEEL,
  RGE_IN_QUIT,
  RGE_IN_LEN,
  RGE_KEY_DOWN,
  RGE_KEY_PRESSED,
  RGE_KEY_RELEASED,
  RGE_OPEN_RESIZABLE,
  RGE_OPEN_VSYNC,
  RGE_OPEN_HIDDEN,
  RGE_OPEN_SMOOTH,
  RGE_OPEN_SHARP,
} as const;

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
const DIGITS = Array.from({ length: 10 }, (_, i) => String(i));
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `F${i + 1}`);

/**
 * Key names, in the order of the keys buffer (the header's `RGE_KEYS`, which is append only).
 * What `input.pressed("Space")` accepts. Mouse buttons are keys too.
 */
export const KEYS: readonly string[] = [
  "Space", "Enter", "Escape", "Tab", "Backspace", "Shift", "Control", "Alt",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  ...LETTERS,
  ...DIGITS,
  ...FUNCTION_KEYS,
  "MouseLeft", "MouseRight", "MouseMiddle",
  // The first gamepad: its buttons, and the d-pad or left stick as four directions (down past the dead zone).
  "PadA", "PadB", "PadX", "PadY", "PadLB", "PadRB", "PadBack", "PadStart", "PadLeft", "PadRight", "PadUp", "PadDown",
];

/** Index of each key name in the keys buffer. */
export const KEY_INDEX: ReadonlyMap<string, number> = new Map(KEYS.map((name, index) => [name, index]));
