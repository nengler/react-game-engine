#!/usr/bin/env python3
"""
Make the fonts built into libtse (`tse:small`, `tse:m5x7`, ...) from their sources: the glyph sheets go to native/src/fonts_data.h,
each character's advance to packages/player/src/fonts.ts. Both files are generated: change this script, not them.

    python3 tools/fonts/make-fonts.py <sources>

needs Pillow (`pip install pillow`) and a folder of the source files, by these names (where each comes from is in
tools/fonts/README.md):

    tomthumb.go                          tinygo.org/x/tinyfont, tomthumb.go (Tom Thumb in Adafruit GFX form)
    unscii_8.py unscii_8_thin.py unscii_16.py   the py-unscii wheel, unscii/raw_unscii/ (a dict literal each)
    m5x7.ttf                             the m5x7 crate, src/m5x7.ttf
    tiny5.woff micro-5.woff silkscreen.woff jersey-10.woff press-start-2p.woff   @fontsource/<name>, files/<name>-latin-400-normal.woff

The source files are read, never run: the unscii tables are parsed with ast.literal_eval.

A font is a sheet of the characters 32 to 127 in 16 columns and 6 rows of equal cells, white on transparent, as `<Text font>`
takes, plus each character's advance (how far the next one starts), which can be less than the cell: the player lays text out
by the advances, so a font drawn with letters of different widths keeps them.
"""
import ast
import os
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CHARS = [chr(c) for c in range(32, 128)]
PRINTABLE = CHARS[1:-1]  # 33 to 126: what sets a font's height (space and DEL draw nothing)


class Font:
    def __init__(self, name, source, license, glyphs, advances, cell_w=None, cell_h=None):
        self.name, self.source, self.license = name, source, license
        self.glyphs, self.advances = glyphs, advances  # a '1' image each, all the same height; an int each
        self.cell_w = cell_w or max(max(advances.values()), max(ink_width(g) for g in glyphs.values()))
        self.cell_h = cell_h or max(g.height for g in glyphs.values())

    def sheet(self):
        """The 16 x 6 sheet, as rows of 0/1."""
        w, h = self.cell_w * 16, self.cell_h * 6
        rows = [[0] * w for _ in range(h)]
        for i, ch in enumerate(CHARS):
            g = self.glyphs[ch]
            ox, oy = (i % 16) * self.cell_w, (i // 16) * self.cell_h
            for y in range(min(g.height, self.cell_h)):
                for x in range(min(g.width, self.cell_w)):
                    if g.getpixel((x, y)):
                        rows[oy + y][ox + x] = 1
        return rows


def ink_width(g):
    box = g.getbbox()
    return box[2] if box else 0


def from_rows(rows_of, w, h):
    """Glyphs from bit rows: rows_of(ch) is a list of ints, bit w-1 the left column."""
    glyphs = {}
    for ch in CHARS:
        g = Image.new("1", (w, h), 0)
        for y, r in enumerate((rows_of(ch) or [])[:h]):
            for x in range(w):
                if r & (1 << (w - 1 - x)):
                    g.putpixel((x, y), 1)
        glyphs[ch] = g
    return glyphs


def tom_thumb(src):
    """Tom Thumb: 3x5 glyphs on a baseline 5 rows down, descenders in a sixth; the advance is the GFX XAdvance."""
    text = open(os.path.join(src, "tomthumb.go")).read()
    found = {}
    for m in re.finditer(
        r"Rune: (\d+), Width: 0x\w+, Height: 0x(\w+), XAdvance: 0x(\w+), XOffset: (-?\d+), YOffset: (-?\d+), Bitmaps: \[\]uint8\{([^}]*)\}",
        text,
    ):
        found[chr(int(m[1]))] = (int(m[3], 16), int(m[4]), int(m[5]), [int(b, 16) for b in m[6].split(",") if b.strip()])
    glyphs, advances = {}, {}
    for ch in CHARS:
        g = Image.new("1", (4, 6), 0)
        advance, dx, dy, bits = found.get(ch, (4, 0, -5, []))
        for y, row in enumerate(bits):
            for x in range(4):
                if row & (0x80 >> x) and 0 <= 5 + dy + y < 6 and 0 <= dx + x < 4:
                    g.putpixel((dx + x, 5 + dy + y), 1)
        glyphs[ch], advances[ch] = g, advance
    # Digits keep one width (4), so a counting number does not shift.
    return glyphs, advances


def unscii(src, table):
    text = open(os.path.join(src, table + ".py")).read()
    data = ast.literal_eval(text[text.index("{") :])
    h = len(data[ord("A")])
    glyphs = from_rows(lambda ch: data.get(ord(ch), []), 8, h)
    # A row of space under each line: unscii's glyphs reach the cell's edges.
    spaced = {}
    for ch, g in glyphs.items():
        s = Image.new("1", (8, h + 1), 0)
        s.paste(g, (0, 0))
        spaced[ch] = s
    return spaced, {ch: 8 for ch in CHARS}


def outline_font(path, size):
    """A pixel font made as outlines, drawn at the size where one of its pixels is one pixel, without smoothing. The cell is as
    tall as the characters 33 to 126 reach, plus a row of space; a glyph that starts left of its origin is moved right to it, and
    one that starts above the cell down into it."""
    font = ImageFont.truetype(path, size)
    boxes = {ch: font.getbbox(ch) for ch in PRINTABLE}
    # The grave accent sits higher than anything else in some of them: it is moved down into the cell, not given rows of its own.
    top = min(b[1] for ch, b in boxes.items() if b[2] > b[0] and ch != "`")
    bottom = max(b[3] for b in boxes.values() if b[2] > b[0])
    h = bottom - top + 1
    glyphs, advances = {}, {}
    for ch in CHARS:
        im = Image.new("L", (int(size * 2), h), 0)
        draw = ImageDraw.Draw(im)
        draw.fontmode = "1"
        left = min(0, boxes[ch][0]) if ch in boxes else 0
        if ch != chr(127):
            draw.text((-left, -top + (max(0, top - boxes[ch][1]) if ch in boxes else 0)), ch, font=font, fill=255)
        glyphs[ch] = im.point(lambda p: 255 if p > 127 else 0).convert("1")
        advances[ch] = round(font.getlength(ch)) if ch != chr(127) else 0
    return glyphs, advances


def caps():
    """Kite's 5x7 capitals (games/kite/assets/font.png, 5x8 cells), with a column of space after each."""
    sheet = Image.open(os.path.join(ROOT, "games/kite/assets/font.png")).convert("RGBA")
    cw, ch_h = sheet.width // 16, sheet.height // 6
    glyphs = {}
    for i, ch in enumerate(CHARS):
        cell = sheet.crop(((i % 16) * cw, (i // 16) * ch_h, (i % 16 + 1) * cw, (i // 16 + 1) * ch_h))
        glyphs[ch] = cell.split()[3].point(lambda a: 255 if a > 127 else 0).convert("1")
    return glyphs, {ch: cw + 1 for ch in CHARS}


def tabular_digits(glyphs, advances):
    """Give the digits one advance, the widest of theirs, each narrower one moved to the middle of it, so a number that counts
    up or down does not shift (a score, a timer)."""
    digits = "0123456789"
    widest = max(advances[d] for d in digits)
    glyphs, advances = dict(glyphs), dict(advances)
    for d in digits:
        shift = (widest - advances[d]) // 2
        if shift:
            g = glyphs[d]
            moved = Image.new("1", (g.width + shift, g.height), 0)
            moved.paste(g, (shift, 0))
            glyphs[d] = moved
        advances[d] = widest
    return glyphs, advances


def build(src):
    def woff(name):
        return os.path.join(src, name + ".woff")

    fonts = []

    def add(name, source, license, made, **cell):
        glyphs, advances = tabular_digits(*made)
        fonts.append(Font(name, source, license, glyphs, advances, **cell))

    add("tse:small", "Tom Thumb (Brian Swetland, Robey Pointer)", "CC0", tom_thumb(src), cell_w=4, cell_h=6)
    add("tse:tiny5", "Tiny5 (The Tiny5 Project Authors)", "OFL-1.1", outline_font(woff("tiny5"), 8))
    add("tse:micro5", "Micro 5 (The Soft Type Project Authors)", "OFL-1.1", outline_font(woff("micro-5"), 11))
    add("tse:m5x7", "m5x7 (Daniel Linssen)", "CC0", outline_font(os.path.join(src, "m5x7.ttf"), 16))
    add("tse:silkscreen", "Silkscreen (The Silkscreen Project Authors)", "OFL-1.1", outline_font(woff("silkscreen"), 8))
    add("tse:caps", "Kite's capitals (this repository)", "MIT", caps())
    add("tse:arcade", "Press Start 2P (The Press Start 2P Project Authors)", "OFL-1.1", outline_font(woff("press-start-2p"), 8))
    add("tse:unscii", "unscii-8 (Viznut)", "public domain", unscii(src, "unscii_8"))
    add("tse:unscii-thin", "unscii-8-thin (Viznut)", "public domain", unscii(src, "unscii_8_thin"))
    add("tse:jersey10", "Jersey 10 (The Soft Type Project Authors)", "OFL-1.1", outline_font(woff("jersey-10"), 1000 / 53.5714))
    add("tse:unscii-tall", "unscii-16 (Viznut)", "public domain", unscii(src, "unscii_16"))
    return fonts


def c_ident(name):
    return re.sub(r"[^A-Z0-9]+", "_", name.split(":", 1)[1].upper())


def write_c(fonts, path):
    out = [
        "/* Generated by tools/fonts/make-fonts.py: do not edit. The fonts built into libtse (fonts.c), each a sheet of the characters",
        " * 32 to 127 in 16 columns and 6 rows of cells, one bit a pixel, rows top first, the left pixel in a byte's top bit, each row",
        " * starting on a byte. Where each comes from and its license: tools/fonts/README.md. */",
        "",
    ]
    for f in fonts:
        rows = f.sheet()
        w, h = f.cell_w * 16, f.cell_h * 6
        stride = (w + 7) // 8
        data = []
        for row in rows:
            for b in range(stride):
                byte = 0
                for bit in range(8):
                    x = b * 8 + bit
                    if x < w and row[x]:
                        byte |= 0x80 >> bit
                data.append(byte)
        out.append(f"/* {f.name}: {f.source}, {f.license}. {f.cell_w}x{f.cell_h} cells, a {w}x{h} sheet. */")
        out.append(f"static const unsigned char FONT_{c_ident(f.name)}[{len(data)}] = {{")
        for i in range(0, len(data), 24):
            out.append("  " + ", ".join(f"0x{b:02x}" for b in data[i : i + 24]) + ",")
        out.append("};")
        out.append("")
    out.append("static const BuiltinFont BUILTIN_FONTS[] = {")
    for f in fonts:
        out.append(f'  {{ "{f.name}", {f.cell_w}, {f.cell_h}, FONT_{c_ident(f.name)} }},')
    out.append("};")
    out.append("")
    open(path, "w").write("\n".join(out))


def write_ts(fonts, path):
    out = [
        "// Generated by tools/fonts/make-fonts.py: do not edit. Where each font comes from and its license: tools/fonts/README.md.",
        "",
        "/** A font built into libtse: its sheet's size (16 × 6 cells), and how far each of the characters 32 to 127 moves the next one on. */",
        "export interface BuiltinFontMetrics {",
        "  readonly width: number;",
        "  readonly height: number;",
        "  readonly advances: readonly number[];",
        "}",
        "",
        "/** The fonts libtse builds, by name: the same as `BUILTIN_FONTS` in @tsengine/runtime. */",
        "export const BUILTIN_FONT_METRICS: Readonly<Record<string, BuiltinFontMetrics>> = {",
    ]
    for f in fonts:
        advances = ", ".join(str(f.advances[ch]) for ch in CHARS)
        out.append(f'  // {f.source}, {f.license}: {f.cell_w} × {f.cell_h} cells.')
        out.append(f'  "{f.name}": {{ width: {f.cell_w * 16}, height: {f.cell_h * 6}, advances: [{advances}] }},')
    out.append("};")
    out.append("")
    open(path, "w").write("\n".join(out))


def write_previews(fonts, folder):
    """A sheet of each font, enlarged, to look at (not used by the engine)."""
    os.makedirs(folder, exist_ok=True)
    for f in fonts:
        rows = f.sheet()
        im = Image.new("RGB", (len(rows[0]), len(rows)), (24, 26, 44))
        for y, row in enumerate(rows):
            for x, v in enumerate(row):
                if v:
                    im.putpixel((x, y), (255, 255, 255))
        im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(os.path.join(folder, c_ident(f.name).lower() + ".png"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    fonts = build(sys.argv[1])
    write_c(fonts, os.path.join(ROOT, "native/src/fonts_data.h"))
    write_ts(fonts, os.path.join(ROOT, "packages/player/src/fonts.ts"))
    # Formatted as the repository's own TypeScript is, so running this again changes nothing that did not change.
    subprocess.run(["npx", "oxfmt", "--write", "packages/player/src/fonts.ts"], cwd=ROOT, check=True, capture_output=True)
    if len(sys.argv) > 2:
        write_previews(fonts, sys.argv[2])
    for f in fonts:
        print(f"{f.name:16} {f.cell_w:2} x {f.cell_h:<2}  {f.source}, {f.license}")
