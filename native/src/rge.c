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
  RenderTexture2D canvas; /* the off-screen target of RGE_OP_CANVAS; id 0 when there is none */
  RenderTexture2D upscaled; /* RGE_OPEN_SHARP: the canvas scaled up by a whole number, before the bilinear step down to the window */
  bool sharp;
} state;

#define MAX_CANVAS 16384

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
  state.sharp = (options & RGE_OPEN_SHARP) != 0;
  state.bad_frame_reported = false;
  return 0;
}

void rge_close(void) {
  if (!state.open) return;
  if (state.canvas.id != 0) UnloadRenderTexture(state.canvas);
  if (state.upscaled.id != 0) UnloadRenderTexture(state.upscaled);
  assets_shutdown();
  CloseWindow();
  free(state.pixels);
  memset(&state, 0, sizeof(state));
}

int32_t rge_set_fullscreen(int32_t on) {
  if (!state.open || state.hidden) return 1;
  bool wanted = on != 0;
  if (IsWindowState(FLAG_BORDERLESS_WINDOWED_MODE) != wanted) ToggleBorderlessWindowed();
  return 0;
}

int32_t rge_measure_text(const char *text, double size, double *out) {
  if (!state.open || text == NULL || out == NULL || !(size >= 0.0 && size <= 100000.0)) return 1;
  /* The font and spacing RGE_OP_TEXT draws with. */
  Vector2 measured = MeasureTextEx(GetFontDefault(), text, (float)size, (float)size / 10.0f);
  out[0] = (double)measured.x;
  out[1] = (double)measured.y;
  return 0;
}

int32_t rge_texture_size(int32_t handle, double *out) {
  Texture2D texture;
  if (!state.open || out == NULL || !assets_texture(handle, &texture)) return 1;
  out[0] = (double)texture.width;
  out[1] = (double)texture.height;
  return 0;
}

/* A record field as an index or an op: -1 unless it is a whole number in range. Casting NaN or an out-of-range
 * double to an integer is undefined behaviour in C, so a malformed buffer must not reach a plain cast. */
static int32_t to_index(double value) {
  return value >= 0.0 && value <= 2147483647.0 ? (int32_t)value : -1;
}

/* A packed 0xRRGGBBAA colour; anything that is not one is magenta, as the TypeScript side uses for a bad colour. */
static uint32_t to_color(double value) {
  return value >= 0.0 && value <= 4294967295.0 ? (uint32_t)value : 0xff00ffffu;
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

/* Clip to a rectangle in target pixels, top-left origin. raylib's BeginScissorMode flips y for OpenGL, whose scissor
 * origin is bottom-left; its software renderer takes the rectangle top-left already, so there it goes through unflipped. */
static void begin_scissor(int x, int y, int width, int height) {
#if defined(GRAPHICS_API_OPENGL_SOFTWARE)
  rlDrawRenderBatchActive();
  rlEnableScissorTest();
  rlScissor(x, y, width, height);
#else
  BeginScissorMode(x, y, width, height);
#endif
}

static void execute_records(const double *records, int32_t length, const char *text, const int32_t *text_offsets, int32_t text_count) {
  bool view_pushed = false;
  bool scissor_on = false;
  int32_t at = 0;
  while (at < length) {
    const double *r = records + at;
    int32_t op = to_index(r[0]);
    int32_t need = 0;
    switch (op) {
      case RGE_OP_VIEW: need = RGE_OP_VIEW_LEN; break;
      case RGE_OP_SPRITE: need = RGE_OP_SPRITE_LEN; break;
      case RGE_OP_RECT: need = RGE_OP_RECT_LEN; break;
      case RGE_OP_ELLIPSE: need = RGE_OP_ELLIPSE_LEN; break;
      case RGE_OP_TEXT: need = RGE_OP_TEXT_LEN; break;
      case RGE_OP_SPRITE_REGION: need = RGE_OP_SPRITE_REGION_LEN; break;
      case RGE_OP_SCISSOR: need = RGE_OP_SCISSOR_LEN; break;
      case RGE_OP_SCISSOR_END: need = RGE_OP_SCISSOR_END_LEN; break;
      case RGE_OP_CANVAS: report_bad_frame("canvas record that is not first", at); goto done;
      default: report_bad_frame("unknown op", at); goto done;
    }
    if (at + need > length) {
      report_bad_frame("record runs past the end", at);
      goto done;
    }

    switch (op) {
      case RGE_OP_VIEW: {
        /* A later view replaces the earlier one. */
        if (view_pushed) rlPopMatrix();
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
      case RGE_OP_SCISSOR: {
        /* NaN or negative sizes clip everything, which is what an empty rectangle means. */
        double w = r[3] > 0.0 && r[3] <= 1e9 ? r[3] : 0.0, h = r[4] > 0.0 && r[4] <= 1e9 ? r[4] : 0.0;
        double x = r[1] >= -1e9 && r[1] <= 1e9 ? r[1] : 0.0, y = r[2] >= -1e9 && r[2] <= 1e9 ? r[2] : 0.0;
        if (scissor_on) EndScissorMode();
        begin_scissor((int)x, (int)y, (int)w, (int)h);
        scissor_on = true;
        break;
      }
      case RGE_OP_SCISSOR_END:
        if (scissor_on) EndScissorMode();
        scissor_on = false;
        break;
      case RGE_OP_SPRITE: {
        Texture2D texture;
        if (assets_texture(to_index(r[6]), &texture)) {
          push_transform(r);
          DrawTexture(texture, 0, 0, WHITE);
          rlPopMatrix();
        }
        break;
      }
      case RGE_OP_SPRITE_REGION: {
        Texture2D texture;
        if (assets_texture(to_index(r[6]), &texture)) {
          int32_t flags = to_index(r[13]);
          float w = (float)r[9], h = (float)r[10];
          if (!(w > 0.0f && h > 0.0f)) break;
          /* A negative source size mirrors the region; the destination always starts at minus the origin. */
          Rectangle source = { (float)r[7], (float)r[8], (flags & RGE_SPRITE_FLIP_X) ? -w : w, (flags & RGE_SPRITE_FLIP_Y) ? -h : h };
          float ox = (float)r[11], oy = (float)r[12];
          if (flags & RGE_SPRITE_FLIP_X) ox = w - ox;
          if (flags & RGE_SPRITE_FLIP_Y) oy = h - oy;
          Rectangle dest = { -ox, -oy, w, h };
          push_transform(r);
          DrawTexturePro(texture, source, dest, (Vector2){ 0.0f, 0.0f }, 0.0f, unpack_color(to_color(r[14])));
          rlPopMatrix();
        }
        break;
      }
      case RGE_OP_RECT: {
        push_transform(r);
        DrawRectangleV((Vector2){ 0.0f, 0.0f }, (Vector2){ (float)r[6], (float)r[7] }, unpack_color(to_color(r[8])));
        rlPopMatrix();
        break;
      }
      case RGE_OP_ELLIPSE: {
        push_transform(r);
        float w = (float)r[6], h = (float)r[7];
        DrawEllipseV((Vector2){ w / 2.0f, h / 2.0f }, w / 2.0f, h / 2.0f, unpack_color(to_color(r[8])));
        rlPopMatrix();
        break;
      }
      case RGE_OP_TEXT: {
        int32_t index = to_index(r[6]);
        if (index >= 0 && index < text_count && text != NULL && text_offsets != NULL) {
          float size = (float)r[7];
          push_transform(r);
          /* The spacing DrawText uses: a tenth of the size. */
          DrawTextEx(GetFontDefault(), text + text_offsets[index], (Vector2){ 0.0f, 0.0f }, size, size / 10.0f, unpack_color(to_color(r[8])));
          rlPopMatrix();
        }
        break;
      }
    }
    at += need;
  }
done:
  if (scissor_on) EndScissorMode();
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
  /* LoadImageFromScreen sizes the image from the screen size and the DPI scale, which need not be the render size
   * (a high-DPI display): copy only an image of exactly the size the buffer was made for. */
  if (image.format == PIXELFORMAT_UNCOMPRESSED_R8G8B8A8 && image.width == width && image.height == height) {
    memcpy(state.pixels, image.data, (size_t)size);
  }
  UnloadImage(image);
#endif
}

/* A frame that starts with RGE_OP_CANVAS: draw the rest into the off-screen texture, then copy it into the window. */
static void draw_canvas_frame(uint32_t clear_color, const double *r, int32_t length, const char *text, const int32_t *text_offsets, int32_t text_count) {
  int32_t width = to_index(r[1]), height = to_index(r[2]);
  if (length < RGE_OP_CANVAS_LEN || width <= 0 || height <= 0 || width > MAX_CANVAS || height > MAX_CANVAS) {
    report_bad_frame("bad canvas record", 0);
    ClearBackground(unpack_color(clear_color));
    return;
  }
  if (state.canvas.id != 0 && (state.canvas.texture.width != width || state.canvas.texture.height != height)) {
    UnloadRenderTexture(state.canvas);
    state.canvas.id = 0;
  }
  if (state.canvas.id == 0) {
    state.canvas = LoadRenderTexture(width, height);
    if (state.canvas.id != 0) SetTextureFilter(state.canvas.texture, TEXTURE_FILTER_POINT);
  }
  if (state.canvas.id == 0) {
    report_bad_frame("could not make the canvas texture", 0);
    ClearBackground(unpack_color(clear_color));
    return;
  }
  BeginTextureMode(state.canvas);
  ClearBackground(unpack_color(clear_color));
  execute_records(r + RGE_OP_CANVAS_LEN, length - RGE_OP_CANVAS_LEN, text, text_offsets, text_count);
  EndTextureMode();

  ClearBackground(unpack_color(to_color(r[7])));
  /* Render textures are upside down: a negative source height flips it. */
  Rectangle source = { 0.0f, 0.0f, (float)width, -(float)height };
  Rectangle dest = { (float)r[3], (float)r[4], (float)r[5], (float)r[6] };
  Texture2D shown = state.canvas.texture;
  /* Sharp scaling: at a scale between two whole numbers, first blow the canvas up by the whole number above it with nearest
   * filtering (so every texel is a crisp block), then let bilinear filtering take that down to the exact size. */
  float scale = (float)(r[5] / (double)width);
  if (state.sharp && scale > 1.0f && fabsf(scale - roundf(scale)) > 1e-3f) {
    int32_t k = (int32_t)ceilf(scale);
    int32_t uw = width * k, uh = height * k;
    if (uw <= MAX_CANVAS && uh <= MAX_CANVAS) {
      if (state.upscaled.id != 0 && (state.upscaled.texture.width != uw || state.upscaled.texture.height != uh)) {
        UnloadRenderTexture(state.upscaled);
        state.upscaled.id = 0;
      }
      if (state.upscaled.id == 0) state.upscaled = LoadRenderTexture(uw, uh);
      if (state.upscaled.id != 0) {
        BeginTextureMode(state.upscaled);
        /* Stored upside down like the canvas, so it is copied as it is (no flip) and flipped once, when it is drawn to the window. */
        DrawTexturePro(state.canvas.texture, (Rectangle){ 0.0f, 0.0f, (float)width, (float)height }, (Rectangle){ 0.0f, 0.0f, (float)uw, (float)uh }, (Vector2){ 0.0f, 0.0f }, 0.0f, WHITE);
        EndTextureMode();
        SetTextureFilter(state.upscaled.texture, TEXTURE_FILTER_BILINEAR);
        shown = state.upscaled.texture;
        source = (Rectangle){ 0.0f, 0.0f, (float)uw, -(float)uh };
      }
    }
  }
  DrawTexturePro(shown, source, dest, (Vector2){ 0.0f, 0.0f }, 0.0f, WHITE);
}

void rge_frame(uint32_t clear_color, const double *records, int32_t records_length,
               const char *text, const int32_t *text_offsets, int32_t text_count,
               double *input, uint8_t *keys) {
  if (!state.open) return;

  assets_update_music();
  BeginDrawing();
  bool has_records = records != NULL && records_length > 0;
  if (has_records && to_index(records[0]) == RGE_OP_CANVAS) {
    draw_canvas_frame(clear_color, records, records_length, text, text_offsets, text_count);
  } else {
    ClearBackground(unpack_color(clear_color));
    if (has_records) execute_records(records, records_length, text, text_offsets, text_count);
  }
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
