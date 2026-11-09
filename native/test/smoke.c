/* Smoke test for librge: opens a hidden window, draws records, and checks pixels. Runs on the
 * software renderer (RGE_PLATFORM=Memory) in CI, and on the real OpenGL path on a desktop. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "raylib.h"
#include "rge.h"

#define W 64
#define H 48
#define CLEAR 0x102030ffu
#define C_RED 0xff0000ffu
#define C_GREEN 0x00ff00ffu
#define WHITE_RGBA 0xffffffffu

static int failures = 0;
static int checks = 0;
#define CHECK(cond, ...) do { checks++; if (!(cond)) { failures++; printf("FAIL %s:%d: ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } } while (0)

static uint8_t pixels[W * H * 4];
static double input[RGE_IN_LEN];
static uint8_t keys[256];

/* ---- a tiny record writer ---- */
static double rec[512];
static int32_t len;
static void reset(void) { len = 0; }
static void push(double v) { rec[len++] = v; }
static void view(double a, double b, double c, double d, double e, double f) {
  push(RGE_OP_VIEW); push(a); push(b); push(c); push(d); push(e); push(f);
}
static void header(int op, double x, double y, double rot, double sx, double sy) {
  push(op); push(x); push(y); push(rot); push(sx); push(sy);
}
static void rect(double x, double y, double rot, double sx, double sy, double w, double h, uint32_t color) {
  header(RGE_OP_RECT, x, y, rot, sx, sy); push(w); push(h); push(color);
}
static void ellipse(double x, double y, double w, double h, uint32_t color) {
  header(RGE_OP_ELLIPSE, x, y, 0, 1, 1); push(w); push(h); push(color);
}
static void sprite(double x, double y, double sx, double sy, int32_t texture) {
  header(RGE_OP_SPRITE, x, y, 0, sx, sy); push(texture);
}
static void text(double x, double y, int32_t index, double size, uint32_t color) {
  header(RGE_OP_TEXT, x, y, 0, 1, 1); push(index); push(size); push(color);
}

static void present(const char *strings, const int32_t *offsets, int32_t count) {
  memset(input, 0, sizeof(input));
  memset(keys, 0, sizeof(keys));
  rge_frame(CLEAR, rec, len, strings, offsets, count, input, keys);
  int32_t size = rge_read_pixels(pixels, sizeof(pixels));
  CHECK(size == W * H * 4, "frame is %d bytes, expected %d", size, W * H * 4);
}

static void frame(void) { present(NULL, NULL, 0); }

static int is_color(int x, int y, uint32_t rgba) {
  const uint8_t *p = &pixels[(y * W + x) * 4];
  return p[0] == (rgba >> 24 & 255) && p[1] == (rgba >> 16 & 255) && p[2] == (rgba >> 8 & 255) && p[3] == (rgba & 255);
}
static void expect(int x, int y, uint32_t rgba, const char *what) {
  const uint8_t *p = &pixels[(y * W + x) * 4];
  CHECK(is_color(x, y, rgba), "%s: pixel (%d,%d) is %02x%02x%02x%02x, expected %08x", what, x, y, p[0], p[1], p[2], p[3], rgba);
}

int main(void) {
  CHECK(rge_abi_version() == RGE_ABI_VERSION, "abi version");
#define COUNT(kind, code, name) +1
  CHECK(rge_key_count() == (0 RGE_KEYS(COUNT)), "key count %d", rge_key_count());
#undef COUNT

  CHECK(rge_open(0, 10, "bad", RGE_OPEN_HIDDEN) != 0, "a zero width is refused");
  CHECK(rge_open(W, H, "rge smoke", RGE_OPEN_HIDDEN) == 0, "open");
  CHECK(rge_open(W, H, "twice", RGE_OPEN_HIDDEN) != 0, "a second open is refused");

  /* An empty frame is the clear colour everywhere. */
  reset(); view(1, 0, 0, 1, 0, 0); frame();
  expect(0, 0, CLEAR, "clear top-left");
  expect(W - 1, H - 1, CLEAR, "clear bottom-right");

  /* A red rect lands where it should and nowhere else. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(10, 5, 0, 1, 1, 20, 10, C_RED); frame();
  expect(15, 8, C_RED, "inside the rect");
  expect(10, 5, C_RED, "rect top-left corner pixel");
  expect(29, 14, C_RED, "rect bottom-right corner pixel");
  expect(9, 8, CLEAR, "left of the rect");
  expect(30, 8, CLEAR, "right of the rect");
  expect(15, 4, CLEAR, "above the rect");
  expect(15, 15, CLEAR, "below the rect");

  /* The view moves everything: e = 10 shifts a rect 10 pixels right (this also checks the matrix layout). */
  reset(); view(1, 0, 0, 1, 10, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); frame();
  expect(15, 5, C_RED, "shifted rect");
  expect(5, 5, CLEAR, "where the unshifted rect would be");
  reset(); view(1, 0, 0, 1, 0, 7); rect(0, 0, 0, 1, 1, 10, 10, C_RED); frame();
  expect(5, 10, C_RED, "rect shifted down by f");
  expect(5, 3, CLEAR, "above the shifted rect");

  /* A zoom of 2 doubles the size. */
  reset(); view(2, 0, 0, 2, 0, 0); rect(5, 5, 0, 1, 1, 10, 10, C_RED); frame();
  expect(25, 25, C_RED, "zoomed rect");
  expect(9, 9, CLEAR, "before the zoomed rect");

  /* Scale and rotation: a quarter turn is clockwise on a y-down screen. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(30, 10, M_PI / 2, 1, 1, 20, 10, C_RED); frame();
  expect(25, 20, C_RED, "rotated rect body");
  expect(35, 12, CLEAR, "right of a rotated rect");
  expect(25, 5, CLEAR, "above a rotated rect");
  reset(); view(1, 0, 0, 1, 0, 0); rect(10, 10, 0, 2, 3, 5, 4, C_GREEN); frame();
  expect(19, 21, C_GREEN, "scaled rect");
  expect(21, 10, CLEAR, "right of a scaled rect");

  /* Later records draw over earlier ones. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 20, 20, C_RED); rect(10, 10, 0, 1, 1, 20, 20, C_GREEN); frame();
  expect(5, 5, C_RED, "bottom rect");
  expect(15, 15, C_GREEN, "top rect over the bottom one");

  /* An ellipse fills its box's middle but not the corners. */
  reset(); view(1, 0, 0, 1, 0, 0); ellipse(10, 10, 30, 20, C_RED); frame();
  expect(25, 20, C_RED, "ellipse centre");
  expect(11, 11, CLEAR, "ellipse corner");
  expect(25, 11, C_RED, "ellipse top middle");

  /* Textures: a missing file is -1; a real one draws, and a negative scale flips it. */
  CHECK(rge_load_texture("does-not-exist.png") == -1, "missing texture is -1");
  CHECK(rge_load_texture(NULL) == -1, "null texture path is -1");
  Image red = GenImageColor(8, 8, (Color){ 255, 0, 0, 255 });
  CHECK(ExportImage(red, "rge_smoke_red.png"), "write the test texture");
  UnloadImage(red);
  int32_t tex = rge_load_texture("rge_smoke_red.png");
  CHECK(tex >= 0, "load the test texture");
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 10, 1, 1, tex); frame();
  expect(24, 14, C_RED, "sprite body");
  expect(19, 14, CLEAR, "left of the sprite");
  expect(28, 14, CLEAR, "right of the sprite");
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 10, -1, 1, tex); frame();
  expect(16, 14, C_RED, "flipped sprite is drawn to the left of its origin");
  expect(24, 14, CLEAR, "nothing where an unflipped sprite would be");
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 18, 1, -1, tex); frame();
  expect(24, 14, C_RED, "vertically flipped sprite");
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 10, 1, 1, 9999); frame();
  expect(24, 14, CLEAR, "an invalid texture handle draws nothing");

  /* Text: white pixels appear in the text's box, and an out-of-range string index draws nothing. */
  {
    const char strings[] = "HI\0second";
    const int32_t offsets[] = { 0, 3 };
    reset(); view(1, 0, 0, 1, 0, 0); text(4, 4, 0, 20, WHITE_RGBA); present(strings, offsets, 2);
    int white = 0;
    for (int y = 4; y < 24; y++) for (int x = 4; x < 30; x++) if (is_color(x, y, WHITE_RGBA)) white++;
    CHECK(white > 10, "text drew %d white pixels", white);
    reset(); view(1, 0, 0, 1, 0, 0); text(4, 4, 7, 20, WHITE_RGBA); present(strings, offsets, 2);
    white = 0;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (is_color(x, y, WHITE_RGBA)) white++;
    CHECK(white == 0, "a bad string index drew %d white pixels", white);
  }

  /* Malformed records never crash, and what came before the bad record is still drawn. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); push(99); frame();
  expect(5, 5, C_RED, "records before an unknown op");
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); push(RGE_OP_RECT); push(1); push(2); frame();
  expect(5, 5, C_RED, "records before a truncated record");
  reset(); frame();
  expect(5, 5, CLEAR, "no records at all");

  /* Input: the window size is reported, nothing asks to quit, key flags use only the three bits. */
  reset(); view(1, 0, 0, 1, 0, 0); frame();
  CHECK(input[RGE_IN_WIDTH] == W && input[RGE_IN_HEIGHT] == H, "window size %g x %g", input[RGE_IN_WIDTH], input[RGE_IN_HEIGHT]);
  CHECK(input[RGE_IN_QUIT] == 0, "quit");
  CHECK(input[RGE_IN_DT] >= 0, "dt");
  for (int i = 0; i < rge_key_count(); i++) CHECK((keys[i] & ~(RGE_KEY_DOWN | RGE_KEY_PRESSED | RGE_KEY_RELEASED)) == 0, "key %d flags %d", i, keys[i]);

  /* Sounds: a missing file is -1, and playing a bad handle is harmless. */
  CHECK(rge_load_sound("does-not-exist.wav") == -1, "missing sound is -1");
  rge_play_sound(-1);
  rge_play_sound(12345);

  rge_close();
  rge_close(); /* closing twice is harmless */
  rge_frame(CLEAR, rec, 0, NULL, NULL, 0, input, keys); /* a frame with no window is harmless */
  remove("rge_smoke_red.png");

  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
