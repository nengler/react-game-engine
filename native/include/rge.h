#ifndef RGE_H
#define RGE_H
/*
 * The boundary between the TypeScript player and the native library. This header is the single
 * source of truth: packages/player/src/protocol.ts mirrors it, and a test fails if they differ.
 * Change this file first, bump RGE_ABI_VERSION, then update protocol.ts. See docs/NATIVE_PLAN.md.
 */
#include <stdint.h>

#define RGE_ABI_VERSION 9

/* ---------- Draw records ----------
 * A frame is a flat array of doubles: records back to back, each starting with its op.
 * Every drawable record then has a common header: x, y, rotation (radians), scaleX, scaleY
 * (the element's resolved world transform), followed by its payload.
 * The C side draws each drawable at the local origin under translate(x, y), rotate, scale(sx, sy).
 * Colours are packed 0xRRGGBBAA stored in a double (exact).
 *
 *   RGE_OP_VIEW     op, a, b, c, d, e, f         world -> screen affine, already including the
 *                                                viewport-centre offset. It applies to the drawables after it,
 *                                                and a later VIEW record replaces it (it does not compose with it):
 *                                                the HUD is drawn through a second view that ignores the camera.
 *                                                Drawables before the first VIEW are drawn in target pixels.
 *   RGE_OP_SPRITE   op, x, y, rot, sx, sy, texture
 *   RGE_OP_RECT     op, x, y, rot, sx, sy, width, height, color
 *   RGE_OP_ELLIPSE  op, x, y, rot, sx, sy, width, height, color   (fills the width x height box)
 *   RGE_OP_TEXT     op, x, y, rot, sx, sy, textIndex, size, color
 *   RGE_OP_SCISSOR  op, x, y, width, height      clip what follows to this rectangle, in target pixels (the window,
 *                                                or the canvas when there is one), top-left origin, ignoring the view.
 *                                                A later SCISSOR replaces it; they do not nest.
 *   RGE_OP_SCISSOR_END  op                       stop clipping
 *   RGE_OP_SPRITE_REGION  op, x, y, rot, sx, sy, texture, srcX, srcY, srcW, srcH, originX, originY, flags, tint
 *                                                one srcW x srcH region of a texture (a frame of a sheet), drawn with
 *                                                its origin (originX, originY, in region pixels) at the record's local
 *                                                origin; flags: RGE_SPRITE_FLIP_X, RGE_SPRITE_FLIP_Y, mirroring the
 *                                                region about the origin; tint is packed 0xRRGGBBAA, which multiplies
 *                                                the texel colours (alpha included, so it is also opacity).
 *   RGE_OP_BOX      op, x, y, rot, sx, sy, width, height, fill, borderColor, borderWidth, radius
 *                                                A width x height box at the local origin: filled with `fill`, then an
 *                                                outline of `borderWidth` drawn inside its edge in `borderColor`, with
 *                                                corners rounded by `radius` pixels (clamped to half the shorter side).
 *                                                A fill or border colour with alpha 0, or a borderWidth <= 0, draws
 *                                                nothing for that part; a radius <= 0 is square.
 *   RGE_OP_CANVAS   op, width, height, destX, destY, destW, destH, borderColor
 *                                                Only as the first record of a frame. Everything after it is drawn
 *                                                into an off-screen width x height texture (point filtered, cleared to
 *                                                the frame's clear colour); the window is cleared to borderColor and
 *                                                the texture is copied into the dest rectangle, right way up.
 */
#define RGE_OP_VIEW     1
#define RGE_OP_SPRITE   2
#define RGE_OP_RECT     3
#define RGE_OP_ELLIPSE  4
#define RGE_OP_TEXT     5
#define RGE_OP_SCISSOR      6
#define RGE_OP_SCISSOR_END  7
#define RGE_OP_CANVAS       8
#define RGE_OP_SPRITE_REGION 9
#define RGE_OP_BOX          10

/* Record lengths in doubles, op included. */
#define RGE_OP_VIEW_LEN    7
#define RGE_OP_SPRITE_LEN  7
#define RGE_OP_RECT_LEN    9
#define RGE_OP_ELLIPSE_LEN 9
#define RGE_OP_TEXT_LEN    9
#define RGE_OP_SCISSOR_LEN     5
#define RGE_OP_SCISSOR_END_LEN 1
#define RGE_OP_CANVAS_LEN      8
#define RGE_OP_SPRITE_REGION_LEN 15
#define RGE_OP_BOX_LEN     12

/* RGE_OP_SPRITE_REGION flags. */
#define RGE_SPRITE_FLIP_X 1
#define RGE_SPRITE_FLIP_Y 2

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

/* The key table: X(kind, raylib code, name). Kind K is a keyboard key, M a mouse button, G a button of the first
 * gamepad, S a direction (code 0 left, 1 right, 2 up, 3 down) that is down for the d-pad or the left stick beyond the
 * dead zone (see rge_set_gamepad_deadzone). A gamepad that is not connected reads as nothing held.
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
  X(M, MOUSE_BUTTON_LEFT, "MouseLeft") X(M, MOUSE_BUTTON_RIGHT, "MouseRight") X(M, MOUSE_BUTTON_MIDDLE, "MouseMiddle") \
  X(G, GAMEPAD_BUTTON_RIGHT_FACE_DOWN, "PadA") X(G, GAMEPAD_BUTTON_RIGHT_FACE_RIGHT, "PadB") \
  X(G, GAMEPAD_BUTTON_RIGHT_FACE_LEFT, "PadX") X(G, GAMEPAD_BUTTON_RIGHT_FACE_UP, "PadY") \
  X(G, GAMEPAD_BUTTON_LEFT_TRIGGER_1, "PadLB") X(G, GAMEPAD_BUTTON_RIGHT_TRIGGER_1, "PadRB") \
  X(G, GAMEPAD_BUTTON_MIDDLE_LEFT, "PadBack") X(G, GAMEPAD_BUTTON_MIDDLE_RIGHT, "PadStart") \
  X(S, 0, "PadLeft") X(S, 1, "PadRight") X(S, 2, "PadUp") X(S, 3, "PadDown")

/* ---------- Window options for rge_open ---------- */
#define RGE_OPEN_RESIZABLE 1
#define RGE_OPEN_VSYNC     2
#define RGE_OPEN_HIDDEN    4  /* no visible window and no audio device: tests and CI. Frames are captured for rge_read_pixels */
#define RGE_OPEN_SMOOTH    8  /* bilinear texture filtering; the default is nearest (pixel art) */
#define RGE_OPEN_SHARP    16  /* a canvas shown at a scale that is not a whole number is scaled up by the next whole number with nearest filtering, then down to size with bilinear: edges stay crisp and no pixel is uneven */

/* ---------- Functions ---------- */
int32_t rge_abi_version(void);
int32_t rge_key_count(void);
int32_t rge_open(int32_t width, int32_t height, const char *title, uint32_t options); /* 0 ok, nonzero error */
void    rge_close(void);
/* Full screen on (nonzero) or off (0), as a borderless window at the desktop's size, so the video mode never changes.
 * Returns 0, or nonzero when there is no window or it is hidden (tests, CI). The next rge_frame reports the new size. */
int32_t rge_set_fullscreen(int32_t on);

int32_t rge_load_texture(const char *path); /* handle >= 0, or -1 if it could not be loaded */
int32_t rge_load_sound(const char *path);   /* handle >= 0, or -1 */
void    rge_play_sound(int32_t handle);     /* ignores -1 */
/* Play a sound at `volume` (0 to 1, clamped) over any plays of it still going: up to RGE_SOUND_VOICES at once, then the
 * oldest is cut off. Ignores -1. */
void    rge_play_sound_ex(int32_t handle, double volume);
#define RGE_SOUND_VOICES 4

/* Music streams from the file and loops; one `handle` can play at a time per stream, and it keeps playing between
 * frames (rge_frame feeds the stream) until stopped. Without an audio device these load and play silently. */
int32_t rge_load_music(const char *path);                           /* handle >= 0, or -1 */
void    rge_music_play(int32_t handle, double volume, int32_t loop); /* from the start; loop nonzero repeats */
void    rge_music_set_volume(int32_t handle, double volume);        /* 0 to 1, takes effect at once */
void    rge_music_stop(int32_t handle);                             /* stops it; a later play starts again from the start */
/* The stick's dead zone for the PadLeft/Right/Up/Down keys: a stick pushed less than this far (0 to 1) reads as
 * centred. Default 0.35. */
void    rge_set_gamepad_deadzone(double deadzone);

/* Layout needs sizes. Both return 0 and write two doubles to `out`, or return nonzero (and write nothing) when
 * they cannot answer: no window is open, the handle is invalid, or an argument is NULL. */
int32_t rge_measure_text(const char *text, double size, double *out); /* out: width, line height, as RGE_OP_TEXT draws it */
int32_t rge_texture_size(int32_t handle, double *out);                /* out: width, height in pixels */

/* Draw one frame and present it, then poll devices and fill `input` (RGE_IN_LEN doubles) and
 * `keys` (rge_key_count() bytes). `text` holds `textCount` NUL-terminated UTF-8 strings back to
 * back; `textOffsets[i]` is the byte offset of string i, which RGE_OP_TEXT's textIndex refers to. */
void rge_frame(uint32_t clearColor,
               const double *records, int32_t recordsLength,
               const char *text, const int32_t *textOffsets, int32_t textCount,
               double *input, uint8_t *keys);

/* Text typed in the last rge_frame, for text fields: the characters the keyboard layout made (Unicode code points, with the
 * system's key repeat), not keys, and RGE_TYPED_BACKSPACE for each press or repeat of Backspace. Copies up to `capacity` of
 * them to `out` and returns how many there were (at most RGE_TYPED_MAX; more in one frame are dropped). Since ABI v9. */
int32_t rge_typed(uint32_t *out, int32_t capacity);
#define RGE_TYPED_BACKSPACE 8
#define RGE_TYPED_MAX 64

/* Collisions: which boxes overlap. `boxes` holds `count` boxes of four doubles each (minX, minY, maxX, maxY), all
 * finite, with maxX > minX and maxY > minY. Two boxes overlap when they share an area: boxes that only share an edge
 * or a corner do not. Each overlapping pair is found once and written to `pairs` as two box indices, in no promised
 * order except that the pairs of one first index come together; at most `capacity` pairs are written (`pairs` holds
 * 2 * capacity entries), and the return value is how many there are, which may be more: call again with more room.
 *
 * `order` is `count` entries the caller keeps from one call to the next: on return it is the box indices by minX
 * (ties by index), and a call that finds last frame's order there sorts it in about linear time. It may hold anything
 * on entry. Needs no window. With boxes that are not finite it still returns and writes only valid indices, but
 * which pairs it finds is not defined. */
int32_t rge_overlaps(const double *boxes, int32_t count, int32_t *order, int32_t *pairs, int32_t capacity);

/* Saved data: small named entries in the platform's user data folder, each written whole and atomically. Needs no window.
 *
 * The folder is $RGE_DATA_DIR if that is set (tests and CI), else $XDG_DATA_HOME/<game_id>, else ~/.local/share/<game_id>
 * (the macOS and Windows folders are written but unverified). `game_id` and every entry name are 1 to 64 of A-Z a-z 0-9 _ -,
 * so neither can become a path; anything else is refused. An entry is the file <name>.dat. A write goes to <name>.tmp, is
 * flushed to disk and renamed over the old file, so a crash leaves the old entry or the new one, never half of one. */
int32_t rge_storage_open(const char *game_id);                               /* 0 ok (makes the folder if it is missing), else nonzero; before any other storage call */
int32_t rge_storage_read(const char *name, uint8_t *out, int32_t capacity);  /* the bytes the entry holds, or -1 if there is none (or the call is refused); copies only when they fit in `capacity` */
int32_t rge_storage_write(const char *name, const uint8_t *data, int32_t length); /* 0 ok, nonzero if refused or it could not be written */
int32_t rge_storage_remove(const char *name);                                /* 0 ok, also when the entry did not exist */

/* Tests only: copy the last presented frame as RGBA8, top row first. Returns the bytes needed
 * (0 when there is no frame to read); copies only when capacity is enough. Frames are captured only
 * when the window was opened with RGE_OPEN_HIDDEN, so ordinary windows pay nothing for it. */
int32_t rge_read_pixels(uint8_t *rgba, int32_t capacity);

#endif
