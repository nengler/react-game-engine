/* Smoke test for librge: opens a hidden window, draws records, and checks pixels. Runs on the
 * software renderer (RGE_PLATFORM=Memory) in CI, and on the real OpenGL path on a desktop. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "raylib.h"
#include "rge.h"
#include "internal.h"

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
static void region(double x, double y, int32_t texture, double sx, double sy, double sw, double sh, double ox, double oy, int flags, uint32_t tint) {
  header(RGE_OP_SPRITE_REGION, x, y, 0, 1, 1); push(texture); push(sx); push(sy); push(sw); push(sh); push(ox); push(oy); push(flags); push(tint);
}
static void text(double x, double y, int32_t index, double size, uint32_t color) {
  header(RGE_OP_TEXT, x, y, 0, 1, 1); push(index); push(size); push(color);
}

static void scissor(double x, double y, double w, double h) { push(RGE_OP_SCISSOR); push(x); push(y); push(w); push(h); }
static void scissor_end(void) { push(RGE_OP_SCISSOR_END); }
static void canvas(double w, double h, double dx, double dy, double dw, double dh, uint32_t border) {
  push(RGE_OP_CANVAS); push(w); push(h); push(dx); push(dy); push(dw); push(dh); push(border);
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

/* ---- rge_overlaps ---- */
static uint32_t lcg_state;
static double lcg(void) { lcg_state = lcg_state * 1664525u + 1013904223u; return (lcg_state >> 8) / 16777216.0; }

/* Boxes the way games lay them out, each awkward for the sweep in its own way. */
static void fill_boxes(double *boxes, int count, int layout) {
  for (int i = 0; i < count; i++) {
    double x = 0, y = 0, w = 10, h = 10;
    switch (layout) {
      case 0: x = lcg() * 300 - 50; y = lcg() * 300 - 150; w = 4 + lcg() * 20; h = lcg() < 0.08 ? 150 + lcg() * 300 : 4 + lcg() * 20; break; /* mixed, some very tall */
      case 1: x = floor(lcg() * 12) * 16; y = floor(lcg() * 12) * 16 + (lcg() < 0.2 ? 8 : 0); w = 16; h = 16; break; /* tiles: edges on band edges */
      case 2: x = lcg() * 40; y = lcg() * 9000; w = 6; h = 1 + lcg() * 3; break; /* deeper than the most bands */
      case 3: x = lcg() * 120; y = lcg() < 0.02 ? 1e9 : lcg() * 120; break; /* one far away */
      case 4: x = lcg() * 2000; y = 5; break; /* a row */
      case 5: x = lcg() * 6; y = lcg() * 6; break; /* a pile */
      case 6: x = 7; y = i * 3.0; break; /* a column: every left edge the same */
    }
    boxes[i * 4] = x; boxes[i * 4 + 1] = y; boxes[i * 4 + 2] = x + w; boxes[i * 4 + 3] = y + h;
  }
}

static int pair_compare(const void *a, const void *b) {
  const int32_t *p = (const int32_t *)a, *q = (const int32_t *)b;
  return p[0] != q[0] ? (p[0] < q[0] ? -1 : 1) : (p[1] < q[1] ? -1 : p[1] > q[1]);
}

static void test_overlaps(void) {
  enum { N = 400, ROOM = N * N };
  static double boxes[N * 4];
  static int32_t order[N], pairs[ROOM * 2], expected[ROOM * 2];

  /* Two that overlap, one that only shares an edge with the first (and is above the second), one inside both, one far away. */
  const double five[] = { 0, 0, 10, 10,   5, 5, 15, 15,   10, 0, 20, 4,   6, 6, 7, 7,   100, 100, 101, 101 };
  for (int i = 0; i < 5; i++) order[i] = 0; /* not a permutation: it is put right */
  int32_t found = rge_overlaps(five, 5, order, pairs, ROOM);
  for (int i = 0; i < found; i++) if (pairs[i * 2] > pairs[i * 2 + 1]) { int32_t t = pairs[i * 2]; pairs[i * 2] = pairs[i * 2 + 1]; pairs[i * 2 + 1] = t; }
  qsort(pairs, (size_t)found, 2 * sizeof(int32_t), pair_compare);
  CHECK(found == 3, "five boxes: %d pairs", found);
  CHECK(pairs[0] == 0 && pairs[1] == 1 && pairs[2] == 0 && pairs[3] == 3 && pairs[4] == 1 && pairs[5] == 3, "five boxes: which pairs");
  CHECK(order[0] == 0 && order[1] == 1 && order[2] == 3 && order[3] == 2 && order[4] == 4, "order is by left edge: %d %d %d %d %d", order[0], order[1], order[2], order[3], order[4]);

  /* Against testing every pair, over layouts and frames; the order is kept from frame to frame as the player keeps it. */
  for (int layout = 0; layout <= 6; layout++) {
    lcg_state = 12345u + (uint32_t)layout;
    for (int frame = 0; frame < 12; frame++) {
      const int count = frame == 5 ? 37 : frame == 9 ? 1 : N; /* fewer boxes than the order was left for, then more again */
      if (frame % 4 == 0) fill_boxes(boxes, N, layout);
      else for (int i = 0; i < N * 4; i += 4) { const double dx = lcg() * 6 - 3, dy = lcg() * 6 - 3; boxes[i] += dx; boxes[i + 2] += dx; boxes[i + 1] += dy; boxes[i + 3] += dy; }
      int32_t want = 0;
      for (int a = 0; a < count; a++) {
        for (int b = a + 1; b < count; b++) {
          const double *p = boxes + a * 4, *q = boxes + b * 4;
          if (p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1]) { expected[want * 2] = a; expected[want * 2 + 1] = b; want++; }
        }
      }
      found = rge_overlaps(boxes, count, order, pairs, ROOM);
      CHECK(found == want, "layout %d frame %d: %d pairs, expected %d", layout, frame, found, want);
      if (found != want) continue;
      for (int i = 0; i < found; i++) if (pairs[i * 2] > pairs[i * 2 + 1]) { int32_t t = pairs[i * 2]; pairs[i * 2] = pairs[i * 2 + 1]; pairs[i * 2 + 1] = t; }
      qsort(pairs, (size_t)found, 2 * sizeof(int32_t), pair_compare);
      CHECK(memcmp(pairs, expected, (size_t)found * 2 * sizeof(int32_t)) == 0, "layout %d frame %d: which pairs", layout, frame);
      int sorted = 1;
      for (int i = 1; i < count; i++) {
        const double before = boxes[order[i - 1] * 4], here = boxes[order[i] * 4];
        if (before > here || (before == here && order[i - 1] > order[i])) sorted = 0;
      }
      CHECK(sorted, "layout %d frame %d: order is by left edge, ties by index", layout, frame);
    }
  }

  /* With less room than there are pairs, only what fits is written, and the count is still all of them. */
  fill_boxes(boxes, 60, 5);
  const int32_t all = rge_overlaps(boxes, 60, order, pairs, ROOM);
  memset(pairs, 0xff, 64 * sizeof(int32_t));
  CHECK(all == 60 * 59 / 2, "a pile of 60: %d pairs", all);
  CHECK(rge_overlaps(boxes, 60, order, pairs, 10) == all, "the count does not depend on the room");
  CHECK(pairs[19] >= 0 && pairs[20] == -1 && pairs[21] == -1, "nothing is written past the room given");
  CHECK(rge_overlaps(boxes, 60, order, NULL, 0) == all && rge_overlaps(boxes, 60, order, pairs, -3) == all, "no room at all still counts");

  /* Nothing to do, and arguments it cannot use. */
  CHECK(rge_overlaps(boxes, 0, order, pairs, ROOM) == 0 && rge_overlaps(boxes, -5, order, pairs, ROOM) == 0, "no boxes");
  CHECK(rge_overlaps(NULL, 10, order, pairs, ROOM) == 0 && rge_overlaps(boxes, 10, NULL, pairs, ROOM) == 0, "NULL boxes or order");

  /* Boxes it was not promised (not finite, inside out, absurdly tall) and an order full of rubbish: it returns, and
   * writes only box indices. */
  for (int round = 0; round < 4; round++) {
    fill_boxes(boxes, N, round);
    for (int i = 0; i < N; i += 7) boxes[i * 4 + (i % 4)] = i % 3 == 0 ? NAN : i % 3 == 1 ? INFINITY : -INFINITY;
    for (int i = 3; i < N; i += 11) { boxes[i * 4 + 1] = -1e300; boxes[i * 4 + 3] = 1e300; }
    for (int i = 0; i < N; i++) order[i] = round == 0 ? -1 : round == 1 ? N + i : round == 2 ? 3 : N - 1 - i;
    found = rge_overlaps(boxes, N, order, pairs, ROOM);
    int valid = found >= 0;
    for (int i = 0; i < found && i < ROOM; i++) if (pairs[i * 2] < 0 || pairs[i * 2] >= N || pairs[i * 2 + 1] < 0 || pairs[i * 2 + 1] >= N) valid = 0;
    static uint8_t seen[N];
    memset(seen, 0, sizeof(seen));
    for (int i = 0; i < N; i++) { if (order[i] < 0 || order[i] >= N || seen[order[i]]) valid = 0; else seen[order[i]] = 1; }
    CHECK(valid, "round %d: bad boxes and a bad order still give valid indices and a permutation", round);
  }
}

int main(void) {
  test_overlaps(); /* needs no window */
  CHECK(rge_abi_version() == RGE_ABI_VERSION, "abi version");
#define COUNT(kind, code, name) +1
  CHECK(rge_key_count() == (0 RGE_KEYS(COUNT)), "key count %d", rge_key_count());
#undef COUNT

  CHECK(rge_open(0, 10, "bad", RGE_OPEN_HIDDEN) != 0, "a zero width is refused");
  CHECK(rge_open(W, H, "rge smoke", RGE_OPEN_HIDDEN) == 0, "open");
  CHECK(rge_open(W, H, "twice", RGE_OPEN_HIDDEN) != 0, "a second open is refused");
  CHECK(rge_set_fullscreen(1) != 0 && rge_set_fullscreen(0) != 0, "full screen is refused in a hidden window");

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
  {
    double size[2] = { -1, -1 };
    CHECK(rge_texture_size(tex, size) == 0 && size[0] == 8 && size[1] == 8, "texture size %g x %g", size[0], size[1]);
  }
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 10, 1, 1, 9999); frame();
  expect(24, 14, CLEAR, "an invalid texture handle draws nothing");

  /* A region of a texture: an 8 x 8 sheet, left half red and right half green, drawn a frame at a time. */
  {
    Image sheet = GenImageColor(8, 8, (Color){ 0, 255, 0, 255 });
    ImageDrawRectangle(&sheet, 0, 0, 4, 8, (Color){ 255, 0, 0, 255 });
    CHECK(ExportImage(sheet, "rge_smoke_sheet.png"), "write the sheet");
    UnloadImage(sheet);
    int32_t sheet_tex = rge_load_texture("rge_smoke_sheet.png");
    CHECK(sheet_tex >= 0, "load the sheet");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 0, 0, 4, 8, 0, 0, 0, WHITE_RGBA); frame();
    expect(21, 14, C_RED, "the red region");
    expect(25, 14, CLEAR, "only the region, not the rest of the sheet");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 4, 0, 4, 8, 0, 0, 0, WHITE_RGBA); frame();
    expect(21, 14, C_GREEN, "the green region, drawn where the red one was");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 0, 0, 8, 8, 4, 4, 0, WHITE_RGBA); frame();
    expect(17, 11, C_RED, "the origin moves the region: its left is 4 pixels left of the record's position");
    expect(23, 11, C_GREEN, "and its right half is on the other side of it");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 0, 0, 8, 8, 0, 0, RGE_SPRITE_FLIP_X, WHITE_RGBA); frame();
    expect(14, 14, C_GREEN, "mirrored about the origin: the picture is on the left of it, green half first");
    expect(18, 14, C_RED, "and the red half next to the origin");
    expect(22, 14, CLEAR, "nothing on the right of it");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 0, 0, 4, 8, 0, 0, 0, 0xffffff00u); frame();
    expect(21, 14, CLEAR, "a tint with no alpha draws nothing");
    reset(); view(1, 0, 0, 1, 0, 0); region(20, 10, sheet_tex, 0, 0, 0, 8, 0, 0, 0, WHITE_RGBA); region(30, 10, 9999, 0, 0, 4, 4, 0, 0, 0, WHITE_RGBA); frame();
    expect(21, 14, CLEAR, "an empty region and an invalid texture draw nothing");
    remove("rge_smoke_sheet.png");
  }

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

  /* A second view replaces the first (it does not compose with it): the HUD ignores the camera. */
  reset(); view(1, 0, 0, 1, 20, 20); rect(0, 0, 0, 1, 1, 6, 6, C_RED); view(1, 0, 0, 1, 0, 0); rect(2, 2, 0, 1, 1, 6, 6, C_GREEN); frame();
  expect(23, 23, C_RED, "drawn through the first view");
  expect(4, 4, C_GREEN, "drawn through the second view, at its own origin");
  expect(27, 27, CLEAR, "the second view did not stack on the first");
  reset(); view(2, 0, 0, 2, 0, 0); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); frame();
  expect(8, 8, C_RED, "a second view of scale 1 after a zoom of 2");
  expect(15, 15, CLEAR, "...is not zoomed");

  /* Scissor clips to a rectangle in target pixels, whatever the view, until SCISSOR_END. */
  reset(); view(1, 0, 0, 1, 0, 0); scissor(10, 10, 10, 10); rect(0, 0, 0, 1, 1, 40, 40, C_RED); scissor_end(); rect(30, 30, 0, 1, 1, 10, 10, C_GREEN); frame();
  expect(15, 15, C_RED, "inside the scissor");
  expect(9, 15, CLEAR, "left of the scissor");
  expect(20, 15, CLEAR, "right of the scissor");
  expect(15, 9, CLEAR, "above the scissor");
  expect(15, 20, CLEAR, "below the scissor");
  expect(35, 35, C_GREEN, "drawn after SCISSOR_END");
  reset(); view(2, 0, 0, 2, 5, 0); scissor(10, 10, 10, 10); rect(0, 0, 0, 1, 1, 40, 40, C_RED); frame();
  expect(15, 15, C_RED, "the scissor is in target pixels, not world units");
  expect(25, 15, CLEAR, "...so a zoomed view does not move it");
  reset(); view(1, 0, 0, 1, 0, 0); scissor(0, 0, 0, 0); rect(0, 0, 0, 1, 1, 40, 40, C_RED); frame();
  expect(5, 5, CLEAR, "an empty scissor clips everything");
  reset(); view(1, 0, 0, 1, 0, 0); scissor(10, 10, 10, 10); scissor(30, 30, 10, 10); rect(0, 0, 0, 1, 1, 64, 48, C_RED); frame();
  expect(15, 15, CLEAR, "a second scissor replaces the first");
  expect(35, 35, C_RED, "...and clips to its own rectangle");
  reset(); view(1, 0, 0, 1, 0, 0); scissor(10, 10, 10, 10); rect(0, 0, 0, 1, 1, 40, 40, C_RED); frame();
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 40, 40, C_GREEN); frame();
  expect(5, 5, C_GREEN, "a scissor left open does not leak into the next frame");

  /* A canvas: a 16 x 9 texture drawn into a 64 x 36 box at (0, 6), 4 x, with a border colour around it. */
  reset(); canvas(16, 9, 0, 6, 64, 36, C_GREEN); view(1, 0, 0, 1, 0, 0); rect(1, 1, 0, 1, 1, 2, 2, C_RED); frame();
  expect(4, 6 + 4, C_RED, "a canvas pixel is 4 x 4 window pixels (top-left of the rect)");
  expect(11, 6 + 11, C_RED, "...and its far corner");
  expect(12, 6 + 12, CLEAR, "the canvas clear colour next to it");
  expect(3, 6 + 4, CLEAR, "left of the rect, inside the canvas");
  expect(5, 2, C_GREEN, "the border above the canvas");
  expect(5, 44, C_GREEN, "the border below the canvas");
  reset(); canvas(16, 9, 0, 6, 64, 36, C_GREEN); view(1, 0, 0, 1, 0, 0); rect(0, 7, 0, 1, 1, 2, 2, C_RED); frame();
  expect(4, 6 + 7 * 4 + 4, C_RED, "the canvas is the right way up (a rect near its bottom is near the bottom)");
  expect(4, 6 + 4, CLEAR, "...and not near its top");
  reset(); canvas(16, 9, 0, 6, 64, 36, C_GREEN); view(1, 0, 0, 1, 0, 0); scissor(0, 0, 4, 4); rect(0, 0, 0, 1, 1, 16, 9, C_RED); scissor_end(); frame();
  expect(3, 6 + 3, C_RED, "a scissor inside a canvas is in canvas pixels");
  expect(16, 6 + 3, CLEAR, "...so it ends at canvas pixel 4 (window pixel 16)");
  expect(3, 6 + 4 * 4, CLEAR, "...and below it");
  reset(); canvas(32, 18, 0, 6, 64, 36, C_GREEN); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 2, 2, C_RED); frame();
  expect(1, 6 + 1, C_RED, "a canvas of another size is made again");
  expect(5, 6 + 5, CLEAR, "...and drawn at its own scale");
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 64, 48, C_RED); frame();
  expect(63, 47, C_RED, "a frame without a canvas goes to the window again");
  reset(); canvas(0, 9, 0, 6, 64, 36, C_GREEN); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); frame();
  expect(5, 5, CLEAR, "a bad canvas size draws nothing but the clear colour");
  reset(); view(1, 0, 0, 1, 0, 0); canvas(16, 9, 0, 6, 64, 36, C_GREEN); frame();
  expect(5, 5, CLEAR, "a canvas that is not first is refused");

  /* Measuring. */
  {
    double out[2] = { -1, -1 };
    CHECK(rge_measure_text("Hello", 20, out) == 0, "measure text");
    CHECK(out[0] > 20 && out[0] < 200, "width of Hello at 20 is %g", out[0]);
    CHECK(out[1] >= 20 && out[1] < 30, "line height at 20 is %g", out[1]);
    double wide[2], narrow[2], empty[2] = { -1, -1 };
    CHECK(rge_measure_text("Hello Hello", 20, wide) == 0 && rge_measure_text("Hello", 20, narrow) == 0 && wide[0] > narrow[0], "longer text is wider");
    CHECK(rge_measure_text("Hello", 40, wide) == 0 && wide[0] > 1.9 * narrow[0], "twice the size is about twice the width");
    CHECK(rge_measure_text("", 20, empty) == 0 && empty[0] == 0, "empty text has no width");
    CHECK(rge_measure_text(NULL, 20, out) != 0, "NULL text is refused");
    CHECK(rge_measure_text("x", 20, NULL) != 0, "a NULL out is refused");
    CHECK(rge_measure_text("x", NAN, out) != 0, "a NaN size is refused");
    CHECK(rge_texture_size(9999, out) != 0 && rge_texture_size(-1, out) != 0, "a bad texture handle is refused");
  }

  /* Malformed records never crash, and what came before the bad record is still drawn. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); push(99); frame();
  expect(5, 5, C_RED, "records before an unknown op");
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); push(RGE_OP_RECT); push(1); push(2); frame();
  expect(5, 5, C_RED, "records before a truncated record");
  reset(); frame();
  expect(5, 5, CLEAR, "no records at all");
  /* Values no cast may take (UB in C): a NaN op stops the frame, a NaN texture or string index draws nothing,
   * and a NaN colour is magenta. */
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); push(NAN); push(1); frame();
  expect(5, 5, C_RED, "records before a NaN op");
  reset(); view(1, 0, 0, 1, 0, 0); sprite(20, 10, 1, 1, 0); rec[len - 1] = NAN; text(4, 4, 0, 20, WHITE_RGBA); rec[len - 3] = 1e300; frame();
  expect(24, 14, CLEAR, "a NaN texture handle draws nothing");
  reset(); view(1, 0, 0, 1, 0, 0); rect(0, 0, 0, 1, 1, 10, 10, C_RED); rec[len - 1] = NAN; frame();
  expect(5, 5, 0xff00ffffu, "a NaN colour is magenta");

  /* Input: the window size is reported, nothing asks to quit, key flags use only the three bits. */
  reset(); view(1, 0, 0, 1, 0, 0); frame();
  CHECK(input[RGE_IN_WIDTH] == W && input[RGE_IN_HEIGHT] == H, "window size %g x %g", input[RGE_IN_WIDTH], input[RGE_IN_HEIGHT]);
  CHECK(input[RGE_IN_QUIT] == 0, "quit");
  CHECK(input[RGE_IN_DT] >= 0, "dt");
  for (int i = 0; i < rge_key_count(); i++) CHECK((keys[i] & ~(RGE_KEY_DOWN | RGE_KEY_PRESSED | RGE_KEY_RELEASED)) == 0, "key %d flags %d", i, keys[i]);

  /* Shift, Control and Alt read both sides as one key: holding one side and pressing the other is not a new press,
   * and letting go of one side while the other is held is not a release. */
  {
    const uint8_t up = 0, down = RGE_KEY_DOWN, pressed = RGE_KEY_DOWN | RGE_KEY_PRESSED, released = RGE_KEY_RELEASED;
    CHECK(keys_combine(up, up) == 0, "both up");
    CHECK(keys_combine(pressed, up) == pressed, "left pressed");
    CHECK(keys_combine(up, pressed) == pressed, "right pressed");
    CHECK(keys_combine(pressed, pressed) == pressed, "both pressed in the same frame: one press");
    CHECK(keys_combine(down, pressed) == down, "right pressed while left is held: still down, not pressed again");
    CHECK(keys_combine(released, down) == down, "left released while right is held: still down, not released");
    CHECK(keys_combine(released, up) == released, "the last one released");
    CHECK(keys_combine(released, released) == released, "both released in the same frame: one release");
    CHECK(keys_combine(released, pressed) == down, "one side let go as the other went down: held throughout");
  }

  /* Sounds: a missing file is -1, and playing a bad handle is harmless. */
  CHECK(rge_load_sound("does-not-exist.wav") == -1, "missing sound is -1");
  rge_play_sound(-1);
  rge_play_sound(12345);
  rge_play_sound_ex(-1, 0.5);
  rge_play_sound_ex(12345, NAN);
  /* Music: a missing file is -1, and everything ignores a bad handle. */
  CHECK(rge_load_music("does-not-exist.ogg") == -1 && rge_load_music(NULL) == -1, "missing music is -1");
  rge_music_play(-1, 1.0, 1);
  rge_music_set_volume(7, 0.5);
  rge_music_stop(99);
  /* The gamepad: nothing is connected in a test, so no gamepad key is ever down, whatever the dead zone. */
  rge_set_gamepad_deadzone(0.5);
  rge_set_gamepad_deadzone(NAN);
  reset(); view(1, 0, 0, 1, 0, 0); frame();
  for (int i = 0; i < rge_key_count(); i++) CHECK(keys[i] == 0, "key %d is idle with no input device (flags %d)", i, keys[i]);

  rge_close();
  rge_close(); /* closing twice is harmless */
  rge_frame(CLEAR, rec, 0, NULL, NULL, 0, input, keys); /* a frame with no window is harmless */
  remove("rge_smoke_red.png");

  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
