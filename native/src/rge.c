#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "internal.h"
#include "raylib.h"
#include "rlgl.h"
#include "rge.h"

/* librge: opens a window and executes the draw records described in include/rge.h. It does no
 * game logic and no maths beyond applying the transform each record carries. */

#define RAD_TO_DEG (180.0f / 3.14159265358979323846f)

static struct {
  bool open;
  bool hidden;       /* opened with RGE_OPEN_HIDDEN: frames are captured for rge_read_pixels */
  uint8_t *pixels;   /* the last captured frame, RGBA8, top row first */
  int32_t pixels_size;
  int32_t pixels_width;
  int32_t pixels_height;
  bool bad_frame_reported;
} state;

int32_t rge_abi_version(void) {
  return RGE_ABI_VERSION;
}

int32_t rge_key_count(void) {
  return keys_count();
}

int32_t rge_open(int32_t width, int32_t height, const char *title, uint32_t options) {
  if (state.open) return 2;
  if (width <= 0 || height <= 0) return 3;

  unsigned int flags = 0;
  if (options & RGE_OPEN_RESIZABLE) flags |= FLAG_WINDOW_RESIZABLE;
  if (options & RGE_OPEN_VSYNC) flags |= FLAG_VSYNC_HINT;
  if (options & RGE_OPEN_HIDDEN) flags |= FLAG_WINDOW_HIDDEN;
  SetConfigFlags(flags);
  SetTraceLogLevel(LOG_WARNING);

  InitWindow(width, height, title != NULL ? title : "");
  if (!IsWindowReady()) return 1;

  /* A flipped sprite has a negative scale, which reverses its triangles' winding: do not cull it. */
  rlDisableBackfaceCulling();
  SetExitKey(KEY_NULL); /* Escape belongs to the game, not to the window */
  /* Without vsync, cap at 60 fps; a hidden window (tests, CI) runs flat out. */
  if (!(options & RGE_OPEN_VSYNC) && !(options & RGE_OPEN_HIDDEN)) SetTargetFPS(60);

  /* A hidden window is for tests and CI: no audio device, so no noise from machines without a sound card. */
  assets_init((options & RGE_OPEN_SMOOTH) != 0, (options & RGE_OPEN_HIDDEN) == 0);
  state.open = true;
  state.hidden = (options & RGE_OPEN_HIDDEN) != 0;
  state.bad_frame_reported = false;
  return 0;
}

void rge_close(void) {
  if (!state.open) return;
  assets_shutdown();
  CloseWindow();
  free(state.pixels);
  memset(&state, 0, sizeof(state));
}

static Color unpack_color(uint32_t rgba) {
  return (Color){ (unsigned char)(rgba >> 24), (unsigned char)(rgba >> 16), (unsigned char)(rgba >> 8), (unsigned char)rgba };
}

static void report_bad_frame(const char *why, int32_t at) {
  if (state.bad_frame_reported) return;
  state.bad_frame_reported = true;
  TraceLog(LOG_ERROR, "RGE: malformed draw records (%s at %d): the rest of the frame is not drawn", why, at);
}

/* translate, rotate, scale: the record's world transform, applied to a drawable at the local origin. */
static void push_transform(const double *r) {
  rlPushMatrix();
  rlTranslatef((float)r[1], (float)r[2], 0.0f);
  rlRotatef((float)r[3] * RAD_TO_DEG, 0.0f, 0.0f, 1.0f);
  rlScalef((float)r[4], (float)r[5], 1.0f);
}

static void execute_records(const double *records, int32_t length, const char *text, const int32_t *text_offsets, int32_t text_count) {
  bool view_pushed = false;
  int32_t at = 0;
  while (at < length) {
    const double *r = records + at;
    int32_t op = (int32_t)r[0];
    int32_t need = 0;
    switch (op) {
      case RGE_OP_VIEW: need = RGE_OP_VIEW_LEN; break;
      case RGE_OP_SPRITE: need = RGE_OP_SPRITE_LEN; break;
      case RGE_OP_RECT: need = RGE_OP_RECT_LEN; break;
      case RGE_OP_ELLIPSE: need = RGE_OP_ELLIPSE_LEN; break;
      case RGE_OP_TEXT: need = RGE_OP_TEXT_LEN; break;
      default: report_bad_frame("unknown op", at); goto done;
    }
    if (at + need > length) {
      report_bad_frame("record runs past the end", at);
      goto done;
    }

    switch (op) {
      case RGE_OP_VIEW: {
        if (view_pushed) {
          report_bad_frame("second view record", at);
          goto done;
        }
        /* x' = a x + c y + e, y' = b x + d y + f, as a column-major 4x4. */
        const float m[16] = {
          (float)r[1], (float)r[2], 0.0f, 0.0f,
          (float)r[3], (float)r[4], 0.0f, 0.0f,
          0.0f, 0.0f, 1.0f, 0.0f,
          (float)r[5], (float)r[6], 0.0f, 1.0f,
        };
        rlPushMatrix();
        rlMultMatrixf(m);
        view_pushed = true;
        break;
      }
      case RGE_OP_SPRITE: {
        Texture2D texture;
        if (assets_texture((int32_t)r[6], &texture)) {
          push_transform(r);
          DrawTexture(texture, 0, 0, WHITE);
          rlPopMatrix();
        }
        break;
      }
      case RGE_OP_RECT: {
        push_transform(r);
        DrawRectangleV((Vector2){ 0.0f, 0.0f }, (Vector2){ (float)r[6], (float)r[7] }, unpack_color((uint32_t)r[8]));
        rlPopMatrix();
        break;
      }
      case RGE_OP_ELLIPSE: {
        push_transform(r);
        float w = (float)r[6], h = (float)r[7];
        DrawEllipseV((Vector2){ w / 2.0f, h / 2.0f }, w / 2.0f, h / 2.0f, unpack_color((uint32_t)r[8]));
        rlPopMatrix();
        break;
      }
      case RGE_OP_TEXT: {
        int32_t index = (int32_t)r[6];
        if (index >= 0 && index < text_count && text != NULL && text_offsets != NULL) {
          float size = (float)r[7];
          push_transform(r);
          /* The spacing DrawText uses: a tenth of the size. */
          DrawTextEx(GetFontDefault(), text + text_offsets[index], (Vector2){ 0.0f, 0.0f }, size, size / 10.0f, unpack_color((uint32_t)r[8]));
          rlPopMatrix();
        }
        break;
      }
    }
    at += need;
  }
done:
  if (view_pushed) rlPopMatrix();
}

/* Keep the frame about to be presented, for rge_read_pixels: RGBA8, top row first. */
static void capture_frame(void) {
  rlDrawRenderBatchActive(); /* flush, so the framebuffer holds everything drawn so far */
  int32_t width = GetRenderWidth();
  int32_t height = GetRenderHeight();
  int32_t size = width * height * 4;
  if (width <= 0 || height <= 0) return;
  if (state.pixels_size != size) {
    free(state.pixels);
    state.pixels = malloc((size_t)size);
    state.pixels_size = state.pixels ? size : 0;
  }
  if (state.pixels == NULL) return;
  state.pixels_width = width;
  state.pixels_height = height;
#if defined(GRAPHICS_API_OPENGL_SOFTWARE)
  /* raylib 6.0's software renderer reads the framebuffer back top row first and as BGRA, whatever
   * format is asked for, and LoadImageFromScreen would then flip it again. Read it raw and swap. */
  rlCopyFramebuffer(0, 0, width, height, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8, state.pixels);
  for (int32_t i = 0; i < size; i += 4) {
    uint8_t blue = state.pixels[i];
    state.pixels[i] = state.pixels[i + 2];
    state.pixels[i + 2] = blue;
  }
#else
  Image image = LoadImageFromScreen(); /* flipped to top row first, alpha forced to 255 */
  if (image.data == NULL) return;
  if (image.format == PIXELFORMAT_UNCOMPRESSED_R8G8B8A8) memcpy(state.pixels, image.data, (size_t)size);
  UnloadImage(image);
#endif
}

void rge_frame(uint32_t clear_color, const double *records, int32_t records_length,
               const char *text, const int32_t *text_offsets, int32_t text_count,
               double *input, uint8_t *keys) {
  if (!state.open) return;

  BeginDrawing();
  ClearBackground(unpack_color(clear_color));
  if (records != NULL && records_length > 0) execute_records(records, records_length, text, text_offsets, text_count);
  if (state.hidden) capture_frame();
  EndDrawing(); /* presents, waits for vsync or the frame cap, and polls devices */

  if (input != NULL) {
    Vector2 mouse = GetMousePosition();
    input[RGE_IN_DT] = (double)GetFrameTime();
    input[RGE_IN_WIDTH] = (double)GetScreenWidth();
    input[RGE_IN_HEIGHT] = (double)GetScreenHeight();
    input[RGE_IN_MOUSE_X] = (double)mouse.x;
    input[RGE_IN_MOUSE_Y] = (double)mouse.y;
    input[RGE_IN_WHEEL] = (double)GetMouseWheelMove();
    input[RGE_IN_QUIT] = WindowShouldClose() ? 1.0 : 0.0;
  }
  if (keys != NULL) {
    int32_t count = keys_count();
    for (int32_t i = 0; i < count; i++) keys[i] = keys_flags(i);
  }
}

int32_t rge_read_pixels(uint8_t *rgba, int32_t capacity) {
  if (state.pixels == NULL) return 0;
  if (rgba != NULL && capacity >= state.pixels_size) memcpy(rgba, state.pixels, (size_t)state.pixels_size);
  return state.pixels_size;
}
