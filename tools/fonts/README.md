# Built-in fonts

`make-fonts.py` makes the fonts built into libtse (`tse:small`, `tse:m5x7` and the rest) from their originals. It writes
two files, which are checked in and not edited by hand:

- `native/src/fonts_data.h`: each font's sheet, one bit a pixel, which `native/src/fonts.c` turns into a texture.
- `packages/player/src/fonts.ts`: each sheet's size and each character's advance, which the player lays text out by.

What each font is and its license are in [native/FONTS.md](../../native/FONTS.md), which ships with libtse.

## Running it

It needs Python 3 and Pillow (`pip install pillow`), and a folder holding the originals under these names:

| File | Where it comes from |
| --- | --- |
| `tomthumb.go` | the Go module `tinygo.org/x/tinyfont` (v0.4.0), `tomthumb.go`: Tom Thumb in Adafruit GFX form |
| `unscii_8.py`, `unscii_8_thin.py`, `unscii_16.py` | the PyPI package `unscii` (0.1.1), `unscii/raw_unscii/`: each a table of glyph rows |
| `m5x7.ttf` | the crate `m5x7` (1.0.0), `src/m5x7.ttf` |
| `tiny5.woff`, `micro-5.woff`, `silkscreen.woff`, `jersey-10.woff`, `press-start-2p.woff` | the npm packages `@fontsource/<name>` (5.3), `files/<name>-latin-400-normal.woff` |

`tse:caps` is read from `games/kite/assets/font.png`. Then:

    python3 tools/fonts/make-fonts.py <folder> [<preview folder>]

and rebuild libtse (`npm run native:build`). With a preview folder it also writes each sheet there, enlarged, to look at.
`tse preview games/demo` shows every font on a game screen at 320 × 180, 480 × 270 and 640 × 360; after changing a font,
store those again with `tse preview games/demo --screenshot`.

## How a font is made

Each font is a sheet of the characters 32 to 127 in 16 columns and 6 rows of equal cells, as `<Text font>` takes, and an
advance for each character. A font made as outlines (the `.ttf` and `.woff` ones) is drawn without smoothing at the size where
one of its pixels is one pixel. Its cell is as tall as the characters 33 to 126 reach, plus a row of space under them (the
grave accent, higher than the rest in some fonts, is moved down instead), and as wide as its widest advance. The digits are
given one advance, the widest of theirs, a narrow one in the middle of it, so a number that counts does not shift.

To add a font: add it to `build()` in the script, add its name to `BUILTIN_FONTS` (packages/runtime/src/components/Text.ts)
and to the table in native/FONTS.md, and bump `TSE_ABI_VERSION` (libtse makes a sheet an older one does not have).
