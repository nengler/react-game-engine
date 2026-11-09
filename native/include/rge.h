#ifndef RGE_H
#define RGE_H
/*
 * The boundary between the TypeScript player and the native library. This header is the single
 * source of truth: packages/player/src/protocol.ts mirrors it, and a test fails if they differ.
 * Change this file first, bump RGE_ABI_VERSION, then update protocol.ts. See docs/NATIVE_PLAN.md.
 */
#include <stdint.h>

#define RGE_ABI_VERSION 1

/* ---------- Draw records ----------
 * A frame is a flat array of doubles: records back to back, each starting with its op.
 * Every drawable record then has a common header: x, y, rotation (radians), scaleX, scaleY
 * (the element's resolved world transform), followed by its payload.
 * The C side draws each drawable at the local origin under translate(x, y), rotate, scale(sx, sy).
 * Colours are packed 0xRRGGBBAA stored in a double (exact).
 *
 *   RGE_OP_VIEW     op, a, b, c, d, e, f         world -> screen affine, already including the
 *                                                viewport-centre offset. Always the first record.
 *   RGE_OP_SPRITE   op, x, y, rot, sx, sy, texture
 *   RGE_OP_RECT     op, x, y, rot, sx, sy, width, height, color
 *   RGE_OP_ELLIPSE  op, x, y, rot, sx, sy, width, height, color   (fills the width x height box)
 *   RGE_OP_TEXT     op, x, y, rot, sx, sy, textIndex, size, color
 */
#define RGE_OP_VIEW     1
#define RGE_OP_SPRITE   2
#define RGE_OP_RECT     3
#define RGE_OP_ELLIPSE  4
#define RGE_OP_TEXT     5

/* Record lengths in doubles, op included. */
#define RGE_OP_VIEW_LEN    7
#define RGE_OP_SPRITE_LEN  7
#define RGE_OP_RECT_LEN    9
#define RGE_OP_ELLIPSE_LEN 9
#define RGE_OP_TEXT_LEN    9

/* ---------- Input, written by rge_frame ---------- */
#define RGE_IN_DT       0  /* seconds since the previous frame */
#define RGE_IN_WIDTH    1  /* window size in logical pixels */
#define RGE_IN_HEIGHT   2
#define RGE_IN_MOUSE_X  3  /* window coordinates, origin top-left */
#define RGE_IN_MOUSE_Y  4
#define RGE_IN_WHEEL    5
#define RGE_IN_QUIT     6  /* 1 when the window was asked to close */
#define RGE_IN_LEN      7

/* Per-key flags in the keys buffer (one byte per entry of RGE_KEYS, in order). */
#define RGE_KEY_DOWN     1
#define RGE_KEY_PRESSED  2
#define RGE_KEY_RELEASED 4

/* The key table: X(kind, raylib code, name). Kind K is a keyboard key, M a mouse button.
 * The order here is the order of the keys buffer. Append only.
 * "Shift", "Control" and "Alt" are down when either the left or the right key is. */
#define RGE_KEYS(X) \
  X(K, KEY_SPACE, "Space") X(K, KEY_ENTER, "Enter") X(K, KEY_ESCAPE, "Escape") X(K, KEY_TAB, "Tab") \
  X(K, KEY_BACKSPACE, "Backspace") X(K, KEY_LEFT_SHIFT, "Shift") X(K, KEY_LEFT_CONTROL, "Control") X(K, KEY_LEFT_ALT, "Alt") \
  X(K, KEY_UP, "ArrowUp") X(K, KEY_DOWN, "ArrowDown") X(K, KEY_LEFT, "ArrowLeft") X(K, KEY_RIGHT, "ArrowRight") \
  X(K, KEY_A, "A") X(K, KEY_B, "B") X(K, KEY_C, "C") X(K, KEY_D, "D") \
  X(K, KEY_E, "E") X(K, KEY_F, "F") X(K, KEY_G, "G") X(K, KEY_H, "H") \
  X(K, KEY_I, "I") X(K, KEY_J, "J") X(K, KEY_K, "K") X(K, KEY_L, "L") \
  X(K, KEY_M, "M") X(K, KEY_N, "N") X(K, KEY_O, "O") X(K, KEY_P, "P") \
  X(K, KEY_Q, "Q") X(K, KEY_R, "R") X(K, KEY_S, "S") X(K, KEY_T, "T") \
  X(K, KEY_U, "U") X(K, KEY_V, "V") X(K, KEY_W, "W") X(K, KEY_X, "X") \
  X(K, KEY_Y, "Y") X(K, KEY_Z, "Z") X(K, KEY_ZERO, "0") X(K, KEY_ONE, "1") \
  X(K, KEY_TWO, "2") X(K, KEY_THREE, "3") X(K, KEY_FOUR, "4") X(K, KEY_FIVE, "5") \
  X(K, KEY_SIX, "6") X(K, KEY_SEVEN, "7") X(K, KEY_EIGHT, "8") X(K, KEY_NINE, "9") \
  X(K, KEY_F1, "F1") X(K, KEY_F2, "F2") X(K, KEY_F3, "F3") X(K, KEY_F4, "F4") \
  X(K, KEY_F5, "F5") X(K, KEY_F6, "F6") X(K, KEY_F7, "F7") X(K, KEY_F8, "F8") \
  X(K, KEY_F9, "F9") X(K, KEY_F10, "F10") X(K, KEY_F11, "F11") X(K, KEY_F12, "F12") \
  X(M, MOUSE_BUTTON_LEFT, "MouseLeft") X(M, MOUSE_BUTTON_RIGHT, "MouseRight") X(M, MOUSE_BUTTON_MIDDLE, "MouseMiddle")

/* ---------- Window options for rge_open ---------- */
#define RGE_OPEN_RESIZABLE 1
#define RGE_OPEN_VSYNC     2
#define RGE_OPEN_HIDDEN    4  /* no visible window: tests and CI */
#define RGE_OPEN_SMOOTH    8  /* bilinear texture filtering; the default is nearest (pixel art) */

/* ---------- Functions ---------- */
int32_t rge_abi_version(void);
int32_t rge_key_count(void);
int32_t rge_open(int32_t width, int32_t height, const char *title, uint32_t options); /* 0 ok, nonzero error */
void    rge_close(void);

int32_t rge_load_texture(const char *path); /* handle >= 0, or -1 if it could not be loaded */
int32_t rge_load_sound(const char *path);   /* handle >= 0, or -1 */
void    rge_play_sound(int32_t handle);     /* ignores -1 */

/* Draw one frame and present it, then poll devices and fill `input` (RGE_IN_LEN doubles) and
 * `keys` (rge_key_count() bytes). `text` holds `textCount` NUL-terminated UTF-8 strings back to
 * back; `textOffsets[i]` is the byte offset of string i, which RGE_OP_TEXT's textIndex refers to. */
void rge_frame(uint32_t clearColor,
               const double *records, int32_t recordsLength,
               const char *text, const int32_t *textOffsets, int32_t textCount,
               double *input, uint8_t *keys);

/* Tests only: copy the last presented frame as RGBA8, top row first. Returns the bytes needed;
 * copies only when capacity is enough. */
int32_t rge_read_pixels(uint8_t *rgba, int32_t capacity);

#endif
