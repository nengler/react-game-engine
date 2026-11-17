/* Fonts built into libtse, loaded by name like a texture: tse_load_texture("tse:small"). No file is read or shipped. */
#include <string.h>
#include "internal.h"

/* A built-in font: its name, its cell, and its 16 x 6 sheet of the characters 32 to 127, one bit a pixel (fonts_data.h). */
typedef struct {
  const char *name;
  int cell_w, cell_h;
  const unsigned char *bits;
} BuiltinFont;

/* The fonts and their sheets, made by tools/fonts/make-fonts.py from Tom Thumb, m5x7, unscii and others (tools/fonts/README.md,
 * which has where each comes from and its license; docs/PLAYER.md, "Built-in fonts"). Each character's advance, which the player
 * lays text out by, is in packages/player/src/fonts.ts, made by the same script. */
#include "fonts_data.h"

bool builtin_font_image(const char *name, Image *out) {
  if (name == NULL) return false;
  for (size_t i = 0; i < sizeof BUILTIN_FONTS / sizeof BUILTIN_FONTS[0]; i++) {
    const BuiltinFont *font = &BUILTIN_FONTS[i];
    if (strcmp(name, font->name) != 0) continue;
    int width = 16 * font->cell_w, height = 6 * font->cell_h, stride = (width + 7) / 8;
    Image image = GenImageColor(width, height, BLANK);
    ImageFormat(&image, PIXELFORMAT_UNCOMPRESSED_R8G8B8A8);
    unsigned char *pixels = image.data;
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        if (!(font->bits[y * stride + x / 8] & (0x80 >> (x % 8)))) continue;
        unsigned char *p = pixels + (y * width + x) * 4;
        p[0] = p[1] = p[2] = p[3] = 255;
      }
    }
    *out = image;
    return true;
  }
  return false;
}
