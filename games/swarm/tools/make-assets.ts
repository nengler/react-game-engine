/**
 * Writes the game's assets, all made here in code: the sprite sheet (the player, three enemies, two gems, a bolt and a blade), the
 * ground tiles and the sound effects. Run it with `node games/swarm/tools/make-assets.ts`; the outputs are committed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "@tsengine/player-node";

const assets = join(dirname(fileURLToPath(import.meta.url)), "../assets");
mkdirSync(assets, { recursive: true });

type Rgb = readonly [number, number, number];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.rgba = new Uint8Array(width * height * 4);
  }
  set(x: number, y: number, [r, g, b]: Rgb, a = 255): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rgba.set([r, g, b, a], (y * this.width + x) * 4);
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  disc(cx: number, cy: number, r: number, c: Rgb): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.set(x, y, c);
  }
  write(name: string): void {
    writeFileSync(join(assets, name), encodePng({ width: this.width, height: this.height, rgba: this.rgba }));
  }
}

const INK: Rgb = [0x16, 0x13, 0x1f];
const WHITE: Rgb = [0xf4, 0xec, 0xd8];

// -- sprites.png: 16 × 16 frames in a row ---------------------------------------------------------------------------------------
// 0-1 player, 2-3 bat, 4-5 zombie, 6-7 brute, 8 gem, 9 big gem, 10 bolt, 11 blade.
{
  const c = new Canvas(16 * 12, 16);
  // The player: a hooded figure, legs apart on the second frame.
  for (let f = 0; f < 2; f++) {
    const x = f * 16;
    c.disc(x + 8, 6, 4, [0x4a, 0x6f, 0xd8]);
    c.rect(x + 5, 8, 6, 5, [0x3a, 0x55, 0xb0]);
    c.rect(x + 7, 5, 4, 2, [0xf2, 0xc9, 0xa0]);
    c.set(x + 9, 5, INK);
    if (f === 0) {
      c.rect(x + 6, 13, 2, 2, INK);
      c.rect(x + 9, 13, 2, 2, INK);
    } else {
      c.rect(x + 5, 13, 2, 2, INK);
      c.rect(x + 10, 13, 2, 2, INK);
    }
  }
  // The bat: wings up, then down.
  for (let f = 0; f < 2; f++) {
    const x = 32 + f * 16;
    const body: Rgb = [0x8c, 0x5c, 0xd6];
    c.disc(x + 8, 8, 3, body);
    for (let i = 0; i < 5; i++) {
      const wy = f === 0 ? 7 - i * 0.6 : 8 + i * 0.6;
      c.set(x + 4 - i, wy, body);
      c.set(x + 12 + i, wy, body);
      c.set(x + 4 - i, wy + 1, body);
      c.set(x + 12 + i, wy + 1, body);
    }
    c.set(x + 7, 7, [0xff, 0xe0, 0x60]);
    c.set(x + 9, 7, [0xff, 0xe0, 0x60]);
  }
  // The zombie: green, arms out, a shuffle.
  for (let f = 0; f < 2; f++) {
    const x = 64 + f * 16;
    const skin: Rgb = [0x7d, 0xc4, 0x6a];
    c.disc(x + 8, 5, 3, skin);
    c.rect(x + 5, 8, 6, 5, [0x5a, 0x4a, 0x7a]);
    c.rect(x + 10, 9, 4, 2, skin);
    c.set(x + 7, 4, INK);
    c.set(x + 9, 4, INK);
    c.rect(x + 5 + f, 13, 2, 2, INK);
    c.rect(x + 9 - f, 13, 2, 2, INK);
  }
  // The brute: wide and red.
  for (let f = 0; f < 2; f++) {
    const x = 96 + f * 16;
    const hide: Rgb = [0xd8, 0x5a, 0x43];
    c.rect(x + 2, 3 + f, 12, 10, hide);
    c.rect(x + 3, 4 + f, 10, 3, [0xf2, 0x93, 0x7a]);
    c.set(x + 5, 6 + f, INK);
    c.set(x + 10, 6 + f, INK);
    c.rect(x + 3, 13, 3, 3, INK);
    c.rect(x + 10, 13, 3, 3, INK);
  }
  // Gems: a small blue one, a big red one.
  const gem = (x: number, r: number, main: Rgb, light: Rgb): void => {
    for (let y = -r; y <= r; y++) for (let i = -(r - Math.abs(y)); i <= r - Math.abs(y); i++) c.set(x + 8 + i, 8 + y, main);
    c.set(x + 7, 7, light);
    c.set(x + 7, 6, light);
  };
  gem(128, 3, [0x5a, 0xd1, 0xff], WHITE);
  gem(144, 5, [0xff, 0x5a, 0x7a], WHITE);
  // The bolt, pointing right.
  c.rect(160 + 3, 7, 9, 2, [0xff, 0xe0, 0x80]);
  c.rect(160 + 10, 6, 3, 4, WHITE);
  // A blade, pointing up.
  for (let y = 2; y < 12; y++) c.rect(176 + 7, y, 2, 1, [0xd0, 0xe4, 0xf0]);
  c.rect(176 + 5, 12, 6, 1, [0x8a, 0x6a, 0x48]);
  c.rect(176 + 7, 13, 2, 2, [0x8a, 0x6a, 0x48]);
  c.write("sprites.png");
}

// -- ground.png: four 32 × 32 tiles (plain, tufts, stones, flowers) -------------------------------------------------------------
{
  const c = new Canvas(128, 32);
  const base: Rgb = [0x22, 0x1d, 0x30];
  const dark: Rgb = [0x1d, 0x19, 0x29];
  for (let t = 0; t < 4; t++) {
    const x = t * 32;
    c.rect(x, 0, 32, 32, base);
    for (let i = 0; i < 6; i++) c.set(x + ((i * 13 + t * 7) % 32), (i * 19 + t * 5) % 32, dark);
    if (t === 1)
      for (const [a, b] of [
        [8, 10],
        [20, 22],
        [14, 4],
      ] as const)
        c.rect(x + a, b, 1, 3, [0x3a, 0x4a, 0x48]);
    if (t === 2) {
      c.disc(x + 10, 20, 2, [0x3a, 0x34, 0x4a]);
      c.disc(x + 22, 9, 1.5, [0x3a, 0x34, 0x4a]);
    }
    if (t === 3)
      for (const [a, b] of [
        [9, 12],
        [21, 24],
      ] as const)
        c.disc(x + a, b, 1, [0x6a, 0x4a, 0x7a]);
  }
  c.write("ground.png");
}

// -- sound ----------------------------------------------------------------------------------------------------------------------
const RATE = 22050;

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const square = (phase: number): number => (phase % 1 < 0.5 ? 1 : -1);
const sine = (phase: number): number => Math.sin(phase * 2 * Math.PI);
let noiseSeed = 1234;
const random = (): number => {
  noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
  return (noiseSeed / 4294967296) * 2 - 1;
};

function sweep(seconds: number, from: number, to: number, shape: (phase: number) => number, volume: number, decay = 3): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (from + (to - from) * t) / RATE;
    out[i] = shape(phase) * volume * Math.exp(-decay * t) * Math.min(1, i / 60);
  }
  return out;
}

function noise(seconds: number, volume: number, lowpass: number): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += (random() - last) * lowpass;
    out[i] = last * volume * Math.pow(1 - i / n, 2);
  }
  return out;
}

function notes(list: readonly (readonly [number, number])[], volume: number): Float32Array {
  const total = list.reduce((a, [, s]) => a + s, 0);
  const out = new Float32Array(Math.round(total * RATE * 1.4) + 200);
  let at = 0;
  for (const [hz, seconds] of list) {
    sweep(seconds * 1.4, hz, hz, square, volume, 2.5).forEach((v, i) => {
      const j = Math.round(at * RATE) + i;
      if (j < out.length) out[j] = out[j]! + v;
    });
    at += seconds;
  }
  return out;
}

const put = (name: string, samples: Float32Array): void => writeFileSync(join(assets, name), wav(samples));
put("shoot.wav", sweep(0.08, 1400, 600, square, 0.15, 4));
put("hit.wav", noise(0.05, 0.4, 0.5));
put("die.wav", sweep(0.1, 400, 120, square, 0.15, 3));
put("gem.wav", sweep(0.06, 1800, 2400, sine, 0.25, 3));
put("hurt.wav", sweep(0.2, 300, 90, square, 0.3, 2));
put(
  "level.wav",
  notes(
    [
      [523, 0.08],
      [659, 0.08],
      [784, 0.08],
      [1047, 0.16],
    ],
    0.18
  )
);
put("pick.wav", sweep(0.1, 700, 1200, sine, 0.3, 2));
put(
  "start.wav",
  notes(
    [
      [392, 0.1],
      [523, 0.1],
      [659, 0.2],
    ],
    0.18
  )
);
put(
  "over.wav",
  notes(
    [
      [392, 0.15],
      [330, 0.15],
      [262, 0.3],
    ],
    0.2
  )
);
console.log(`wrote the assets to ${assets}`);
