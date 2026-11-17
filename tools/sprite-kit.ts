/**
 * A few helpers the games' asset scripts share to lay Kenney's CC0 sprites (kenney.nl) out as the sheets the games read: load a
 * PNG, shrink it, turn, mirror or tint it, and draw it into a frame. Each game copies the Kenney tiles it uses into its own
 * `tools/kenney/` folder, named after the pack and the tile's number (`tiny-dungeon-0120.png` is Tiny Dungeon's `tile_0120.png`),
 * so the scripts run offline and say exactly which tile each frame came from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodePng, encodePng } from "@tsengine/player-node";

export interface Image {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** An empty (transparent) image. */
export function blank(width: number, height: number): Image {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

/** A loader for one folder of Kenney tiles: `kenney("tiny-dungeon-0120")`. */
export function kenneyFolder(dir: string): (name: string) => Image {
  return (name) => decodePng(readFileSync(join(dir, `${name}.png`)));
}

export function save(dir: string, name: string, image: Image): void {
  writeFileSync(join(dir, name), encodePng(image));
}

/** Pixel art made smaller (or larger) by taking the source pixel under each new pixel's centre: edges stay hard. */
export function nearest(src: Image, width: number, height: number): Image {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.floor(((x + 0.5) * src.width) / width);
      const sy = Math.floor(((y + 0.5) * src.height) / height);
      const from = (sy * src.width + sx) * 4;
      out.rgba.set(src.rgba.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return out;
}

/** A large, smooth picture made small by averaging the pixels each new one covers (weighted by alpha). */
export function shrinkSmooth(src: Image, width: number, height: number): Image {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * src.width) / width);
      const x1 = Math.floor(((x + 1) * src.width) / width);
      const y0 = Math.floor((y * src.height) / height);
      const y1 = Math.floor(((y + 1) * src.height) / height);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const at = (j * src.width + i) * 4;
          const alpha = src.rgba[at + 3]!;
          r += src.rgba[at]! * alpha;
          g += src.rgba[at + 1]! * alpha;
          b += src.rgba[at + 2]! * alpha;
          a += alpha;
        }
      }
      if (a === 0) continue;
      const n = (x1 - x0) * (y1 - y0);
      out.rgba.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)], (y * width + x) * 4);
    }
  }
  return out;
}

/** Turned clockwise by a number of quarter turns. */
export function turn(src: Image, quarters: number): Image {
  let image = src;
  for (let q = 0; q < ((quarters % 4) + 4) % 4; q++) {
    const out = blank(image.height, image.width);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const from = (y * image.width + x) * 4;
        out.rgba.set(image.rgba.subarray(from, from + 4), (x * out.width + (image.height - 1 - y)) * 4);
      }
    }
    image = out;
  }
  return image;
}

/** Mirrored left to right. */
export function mirror(src: Image): Image {
  const out = blank(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const from = (y * src.width + x) * 4;
      out.rgba.set(src.rgba.subarray(from, from + 4), (y * src.width + (src.width - 1 - x)) * 4);
    }
  }
  return out;
}

/** Colours multiplied by `[r, g, b]` (0 to 255 each): grey turns into that colour, light grey into a light one. */
export function tint(src: Image, [r, g, b]: readonly [number, number, number]): Image {
  const out = { width: src.width, height: src.height, rgba: src.rgba.slice() };
  for (let i = 0; i < out.rgba.length; i += 4) {
    out.rgba[i] = Math.round((out.rgba[i]! * r) / 255);
    out.rgba[i + 1] = Math.round((out.rgba[i + 1]! * g) / 255);
    out.rgba[i + 2] = Math.round((out.rgba[i + 2]! * b) / 255);
  }
  return out;
}

/** The smallest part of the image that holds every visible pixel. */
export function trim(src: Image): Image {
  let left = src.width;
  let top = src.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.rgba[(y * src.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return blank(0, 0);
  const out = blank(right - left + 1, bottom - top + 1);
  for (let y = 0; y < out.height; y++) {
    out.rgba.set(src.rgba.subarray(((top + y) * src.width + left) * 4, ((top + y) * src.width + right + 1) * 4), y * out.width * 4);
  }
  return out;
}

/** Draw `src` into `dst` with its top left at (x, y), over what is there (fully transparent pixels are skipped). */
export function draw(dst: Image, src: Image, x: number, y: number): void {
  for (let j = 0; j < src.height; j++) {
    for (let i = 0; i < src.width; i++) {
      const from = (j * src.width + i) * 4;
      const alpha = src.rgba[from + 3]!;
      const tx = x + i;
      const ty = y + j;
      if (alpha === 0 || tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      const to = (ty * dst.width + tx) * 4;
      if (alpha === 255 || dst.rgba[to + 3] === 0) {
        dst.rgba.set(src.rgba.subarray(from, from + 4), to);
        continue;
      }
      const k = alpha / 255;
      for (let c = 0; c < 3; c++) dst.rgba[to + c] = Math.round(src.rgba[from + c]! * k + dst.rgba[to + c]! * (1 - k));
      dst.rgba[to + 3] = Math.max(dst.rgba[to + 3]!, alpha);
    }
  }
}

/** Draw `src` into frame `index` of a sheet of `frameWidth` × `frameHeight` frames, centred, or sitting on the bottom with `bottom`. */
export function place(
  sheet: Image,
  index: number,
  frameWidth: number,
  frameHeight: number,
  src: Image,
  { bottom = false, dy = 0 } = {}
): void {
  const columns = Math.floor(sheet.width / frameWidth);
  const ox = (index % columns) * frameWidth + Math.floor((frameWidth - src.width) / 2);
  const oy = Math.floor(index / columns) * frameHeight + (bottom ? frameHeight - src.height : Math.floor((frameHeight - src.height) / 2));
  draw(sheet, src, ox, oy + dy);
}

/** Every pixel made fully opaque or fully transparent (at half alpha), so a shrunk picture keeps a hard edge. */
export function solid(src: Image): Image {
  const out = { width: src.width, height: src.height, rgba: src.rgba.slice() };
  for (let i = 3; i < out.rgba.length; i += 4) out.rgba[i] = out.rgba[i]! >= 128 ? 255 : 0;
  return out;
}

/** A one-pixel outline in `color` around the visible pixels (inside the image's bounds), as Kenney's tiny packs draw theirs. */
export function outline(src: Image, [r, g, b]: readonly [number, number, number]): Image {
  const out = { width: src.width, height: src.height, rgba: src.rgba.slice() };
  const seen = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < src.width && y < src.height && src.rgba[(y * src.width + x) * 4 + 3]! > 0;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (seen(x, y)) continue;
      if (seen(x - 1, y) || seen(x + 1, y) || seen(x, y - 1) || seen(x, y + 1)) out.rgba.set([r, g, b, 255], (y * src.width + x) * 4);
    }
  }
  return out;
}

/** The colours turned to grey (by brightness), ready for `tint`. */
export function grey(src: Image): Image {
  const out = { width: src.width, height: src.height, rgba: src.rgba.slice() };
  for (let i = 0; i < out.rgba.length; i += 4) {
    const v = Math.round(0.3 * out.rgba[i]! + 0.59 * out.rgba[i + 1]! + 0.11 * out.rgba[i + 2]!);
    out.rgba.fill(Math.min(255, Math.round(v * 1.6)), i, i + 3);
  }
  return out;
}
