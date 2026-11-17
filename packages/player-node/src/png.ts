import { crc32, deflateSync, inflateSync } from "node:zlib";

import type { Pixels } from "./backend.ts";

/** Encode RGBA8 pixels (top row first) as a PNG. */
export function encodePng(pixels: Pixels): Uint8Array {
  const { width, height, rgba } = pixels;
  if (rgba.length !== width * height * 4)
    throw new Error(`encodePng: ${width} × ${height} needs ${width * height * 4} bytes, not ${rgba.length}.`);
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const at = y * (1 + width * 4);
    raw[at] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), at + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Decode a PNG to RGBA8: any colour type (grey, RGB, palette, each with or without alpha, and `tRNS` transparency), bit depths
 * 1 to 16 (16-bit samples keep their high byte), and every row filter. Interlaced images are refused. It reads back what
 * `encodePng` writes (for the screenshot tool's comparisons) and ordinary PNGs from elsewhere (for asset scripts).
 */
export function decodePng(bytes: Uint8Array): Pixels {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let palette: Uint8Array = new Uint8Array(0);
  let transparency: Uint8Array = new Uint8Array(0);
  const data: Buffer[] = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      if (body[12] !== 0) throw new Error("decodePng does not read interlaced PNGs.");
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`decodePng: unknown colour type ${colorType}.`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const step = Math.max(1, bitsPerPixel >> 3); // the filters' "corresponding byte to the left"
  const raw = inflateSync(Buffer.concat(data));
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= step ? rows[out + i - step]! : 0;
      const b = y > 0 ? rows[out - stride + i]! : 0;
      const c = i >= step && y > 0 ? rows[out - stride + i - step]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`decodePng: unknown row filter ${filter}.`);
      rows[out + i] = (raw[src + i]! + predicted) & 255;
    }
  }
  // One sample of a row, scaled to 8 bits (a palette index is returned as is).
  const sample = (y: number, index: number): number => {
    if (depth === 8) return rows[y * stride + index]!;
    if (depth === 16) return rows[y * stride + index * 2]!;
    const bit = index * depth;
    const value = (rows[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colorType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  // The tRNS colour key of a grey or RGB image, in the same 8-bit terms as `sample`.
  const key = (i: number): number => {
    const value = (transparency[i * 2]! << 8) | transparency[i * 2 + 1]!;
    return depth === 16 ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      if (colorType === 3) {
        const index = sample(y, s);
        rgba[o] = palette[index * 3] ?? 0;
        rgba[o + 1] = palette[index * 3 + 1] ?? 0;
        rgba[o + 2] = palette[index * 3 + 2] ?? 0;
        rgba[o + 3] = transparency[index] ?? 255;
      } else if (colorType === 0 || colorType === 4) {
        const grey = sample(y, s);
        rgba.fill(grey, o, o + 3);
        rgba[o + 3] = colorType === 4 ? sample(y, s + 1) : transparency.length >= 2 && grey === key(0) ? 0 : 255;
      } else {
        const r = sample(y, s);
        const g = sample(y, s + 1);
        const b = sample(y, s + 2);
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] =
          colorType === 6 ? sample(y, s + 3) : transparency.length >= 6 && r === key(0) && g === key(1) && b === key(2) ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

// A 3 × 5 digit font for contact-sheet labels, one row per entry, bits from the left.
const DIGITS: readonly (readonly number[])[] = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 7, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 1, 1, 1],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7],
];

export interface SheetOptions {
  /** Frames per row. Default 4. */
  readonly columns?: number;
  /** Whole-number enlargement of each frame. Default 1. */
  readonly scale?: number;
  /** Pixels between frames. Default 4. */
  readonly gap?: number;
  /** A number to print in each frame's corner, for each frame (its step). */
  readonly labels?: readonly number[];
}

/** Lay frames out in a grid on a dark background: one image of a whole run. All frames must be the same size. */
export function contactSheet(frames: readonly Pixels[], options: SheetOptions = {}): Pixels {
  const first = frames[0];
  if (first === undefined) throw new Error("contactSheet needs at least one frame.");
  const columns = Math.max(1, Math.min(options.columns ?? 4, frames.length));
  const scale = Math.max(1, Math.floor(options.scale ?? 1));
  const gap = options.gap ?? 4;
  const cellW = first.width * scale;
  const cellH = first.height * scale;
  const rows = Math.ceil(frames.length / columns);
  const width = columns * cellW + (columns + 1) * gap;
  const height = rows * cellH + (rows + 1) * gap;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 24;
    rgba[i + 1] = 24;
    rgba[i + 2] = 28;
    rgba[i + 3] = 255;
  }
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    const at = (y * width + x) * 4;
    rgba[at] = r;
    rgba[at + 1] = g;
    rgba[at + 2] = b;
    rgba[at + 3] = 255;
  };
  frames.forEach((frame, index) => {
    if (frame.width !== first.width || frame.height !== first.height) throw new Error("contactSheet: every frame must be the same size.");
    const left = gap + (index % columns) * (cellW + gap);
    const top = gap + Math.floor(index / columns) * (cellH + gap);
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const from = (Math.floor(y / scale) * frame.width + Math.floor(x / scale)) * 4;
        put(left + x, top + y, frame.rgba[from] as number, frame.rgba[from + 1] as number, frame.rgba[from + 2] as number);
      }
    }
    const label = options.labels?.[index];
    if (label !== undefined) drawNumber(String(label), left + 2, top + 2, Math.max(1, Math.floor(scale / 2)), put, width, height);
  });
  return { width, height, rgba };
}

function drawNumber(
  text: string,
  x: number,
  y: number,
  size: number,
  put: (x: number, y: number, r: number, g: number, b: number) => void,
  width: number,
  height: number
): void {
  // A dark box behind the digits so they read on any room.
  const boxW = text.length * 4 * size + size;
  for (let dy = 0; dy < 6 * size; dy++)
    for (let dx = 0; dx < boxW; dx++) if (x + dx < width && y + dy < height) put(x + dx, y + dy, 0, 0, 0);
  for (let i = 0; i < text.length; i++) {
    const glyph = DIGITS[Number(text[i])] as readonly number[];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (((glyph[row] as number) >> (2 - col)) & 1) {
          for (let dy = 0; dy < size; dy++)
            for (let dx = 0; dx < size; dx++)
              put((x + (i * 4 + col) * size + dx + size / 2) | 0, (y + row * size + dy + size / 2) | 0, 255, 255, 80);
        }
      }
    }
  }
}
