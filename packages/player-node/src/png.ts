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

/** Read back a PNG written by `encodePng` (8-bit RGBA, no interlacing): for tests of the screenshot tool. */
export function decodePng(bytes: Uint8Array): Pixels {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6) throw new Error("decodePng only reads 8-bit RGBA.");
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    if (raw[row] !== 0) throw new Error("decodePng only reads unfiltered rows.");
    rgba.set(raw.subarray(row + 1, row + 1 + width * 4), y * width * 4);
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
