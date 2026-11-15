/**
 * Writes the game's placeholder assets, all made here (nothing is copied from anywhere): the tile sheet, the character's sheet,
 * a 5 × 7 pixel font, the sound effects and the music loop. Run it with `npm run kite:assets`; the outputs are committed, and
 * `assets/README.md` says where each came from. The art is drawn from code on purpose, so it can be changed without a tool.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "@rge/player-node";

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
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rgba.set([r, g, b, a], (y * this.width + x) * 4);
  }
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  write(name: string): void {
    writeFileSync(join(assets, name), encodePng({ width: this.width, height: this.height, rgba: this.rgba }));
  }
}

// -- palette ------------------------------------------------------------------------------------------------------------
const STONE: Rgb = [0x3b, 0x46, 0x66];
const STONE_DARK: Rgb = [0x32, 0x3c, 0x5a];
const STONE_LIGHT: Rgb = [0x5a, 0x6b, 0x99];
const SPIKE: Rgb = [0xd9, 0x43, 0x5a];
const SPIKE_LIGHT: Rgb = [0xf2, 0x7a, 0x8c];
const BODY: Rgb = [0xff, 0xf1, 0xd6];
const BODY_SHADE: Rgb = [0xe0, 0xc9, 0xa6];
const SCARF: Rgb = [0xff, 0x7a, 0x59];
const SCARF_DARK: Rgb = [0xc4, 0x4f, 0x3a];
const EYE: Rgb = [0x23, 0x1f, 0x33];

// -- tiles: 8 × 2 of 10 × 10 ----------------------------------------------------------------------------------------------
// 1 stone, 2 stone with a lit top, 3-6 spikes (up, down, left, right), 7 exit, 8 start, 9 end marker (the last three are empty).
function tiles(): void {
  const c = new Canvas(80, 20);
  const noise = (x: number, y: number): number => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7;
  const stone = (ox: number, oy: number, lit: boolean): void => {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        let color = noise(ox + x, oy + y) === 0 ? STONE_DARK : STONE;
        if (lit && y === 0) color = STONE_LIGHT;
        if (lit && y === 1) color = noise(x, y) < 3 ? STONE_LIGHT : color;
        c.set(ox + x, oy + y, color);
      }
    }
  };
  stone(0, 0, false);
  stone(10, 0, true);
  // Spikes: three teeth, each a small triangle, drawn for each direction on the half of the tile they occupy.
  const teeth = (ox: number, dir: "up" | "down" | "left" | "right"): void => {
    for (let t = 0; t < 3; t++) {
      for (let depth = 0; depth < 5; depth++) {
        const width = Math.max(1, 3 - Math.floor(depth * 0.7)); // wide at the base, one pixel at the tip
        const start = Math.floor(t * 3.33 + (3 - width) / 2) + (depth === 4 ? 0 : 0);
        for (let w = 0; w < width; w++) {
          const along = start + w;
          const color = w === 0 ? SPIKE_LIGHT : SPIKE;
          if (dir === "up") c.set(ox + along, 9 - depth, color);
          else if (dir === "down") c.set(ox + along, depth, color);
          else if (dir === "left") c.set(ox + 9 - depth, along, color);
          else c.set(ox + depth, along, color);
        }
      }
    }
  };
  teeth(20, "up");
  teeth(30, "down");
  teeth(40, "left");
  teeth(50, "right");
  c.write("tiles.png");
}

// -- the character: 12 × 12 frames, 8 per row ---------------------------------------------------------------------------------
// 0-1 idle, 2-7 run, 8 jump, 9 fall, 10 wall slide, 11 dash, 12-15 death. It faces right; the game mirrors it for left.
function hero(): void {
  const c = new Canvas(96, 24);
  const frame = (index: number, draw: (put: (x: number, y: number, color: Rgb) => void) => void): void => {
    const ox = (index % 8) * 12;
    const oy = Math.floor(index / 8) * 12;
    draw((x, y, color) => c.set(ox + x, oy + y, color));
  };
  /** The body: a rounded bean, `squash` rows shorter and `lean` pixels shifted, with an eye and a scarf blowing back. */
  const bean = (
    put: (x: number, y: number, color: Rgb) => void,
    opts: { top?: number; lean?: number; scarf?: number; feet?: number } = {}
  ): void => {
    const top = opts.top ?? 2;
    const lean = opts.lean ?? 0;
    const bottom = 11 - (opts.feet ?? 0);
    for (let y = top; y <= bottom; y++) {
      const rows = bottom - top;
      const edge = y === top || y === bottom ? 2 : y === top + 1 || y === bottom - 1 ? 1 : 0;
      for (let x = 2 + edge; x <= 8 - edge; x++) put(x + lean, y, y > top + rows * 0.65 ? BODY_SHADE : BODY);
    }
    put(7 + lean, top + 2, EYE);
    put(7 + lean, top + 3, EYE);
    // The scarf: from the back of the neck, trailing left, lifting with `scarf`.
    const sy = top + 4;
    put(1 + lean, sy, SCARF);
    put(0 + lean, sy + (opts.scarf ?? 0), SCARF_DARK);
    put(2 + lean, sy, SCARF);
    put(2 + lean, sy + 1, SCARF_DARK);
  };
  frame(0, (p) => bean(p));
  frame(1, (p) => bean(p, { top: 3 }));
  for (let i = 0; i < 6; i++)
    frame(2 + i, (p) => bean(p, { top: 2 + (i % 3 === 1 ? 1 : 0), lean: 1, scarf: i % 2, feet: i % 3 === 1 ? 0 : 0 }));
  frame(8, (p) => bean(p, { top: 0, scarf: -1 })); // stretched up
  frame(9, (p) => bean(p, { top: 1, scarf: 1 }));
  frame(10, (p) => bean(p, { top: 2, lean: -1, scarf: 0 })); // against the wall
  frame(11, (p) => bean(p, { top: 4, lean: 1, scarf: 0 })); // low and long
  for (let i = 0; i < 4; i++) {
    frame(12 + i, (p) => {
      // A burst: pixels flying outward from the middle.
      const r = 2 + i * 2;
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        p(Math.round(6 + Math.cos(ang) * r), Math.round(7 + Math.sin(ang) * r), a % 2 ? BODY : SCARF);
      }
    });
  }
  c.write("hero.png");
}

// -- the pixel font: 16 × 6 cells of 5 × 8, the characters 32 to 127 ---------------------------------------------------------------
// Each glyph is seven rows of five columns, `#` lit.
const G = (...rows: string[]): string => {
  if (rows.length !== 7 || rows.some((r) => r.length !== 5)) throw new Error(`a glyph is 7 rows of 5 columns: ${rows.join("/")}`);
  return rows.join("");
};
const GLYPHS: Record<string, string> = {
  A: G(".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
  B: G("####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."),
  C: G(".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."),
  D: G("####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."),
  E: G("#####", "#....", "#....", "####.", "#....", "#....", "#####"),
  F: G("#####", "#....", "#....", "####.", "#....", "#....", "#...."),
  G: G(".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."),
  H: G("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
  I: G("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
  J: G("..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."),
  K: G("#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"),
  L: G("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
  M: G("#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"),
  N: G("#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"),
  O: G(".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
  P: G("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
  Q: G(".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"),
  R: G("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
  S: G(".####", "#....", "#....", ".###.", "....#", "....#", "####."),
  T: G("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
  U: G("#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
  V: G("#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."),
  W: G("#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"),
  X: G("#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"),
  Y: G("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."),
  Z: G("#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"),
  "0": G(".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."),
  "1": G("..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."),
  "2": G(".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"),
  "3": G("####.", "....#", "....#", ".###.", "....#", "....#", "####."),
  "4": G("...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."),
  "5": G("#####", "#....", "####.", "....#", "....#", "#...#", ".###."),
  "6": G(".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."),
  "7": G("#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."),
  "8": G(".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."),
  "9": G(".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."),
  ".": G(".....", ".....", ".....", ".....", ".....", ".##..", ".##.."),
  ",": G(".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."),
  ":": G(".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."),
  "!": G("..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."),
  "?": G(".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."),
  "-": G(".....", ".....", ".....", "#####", ".....", ".....", "....."),
  "/": G("....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."),
  "'": G("..#..", "..#..", ".#...", ".....", ".....", ".....", "....."),
  "(": G("...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."),
  ")": G(".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."),
  "+": G(".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."),
  "=": G(".....", ".....", "#####", ".....", "#####", ".....", "....."),
  ">": G("#....", ".#...", "..#..", "...#.", "..#..", ".#...", "#...."),
  "<": G("....#", "...#.", "..#..", ".#...", "..#..", "...#.", "....#"),
  _: G(".....", ".....", ".....", ".....", ".....", ".....", "#####"),
};
function font(): void {
  const c = new Canvas(80, 48);
  for (let code = 32; code < 128; code++) {
    const ch = String.fromCharCode(code);
    const glyph = GLYPHS[ch.toUpperCase()];
    if (glyph === undefined) continue;
    const ox = ((code - 32) % 16) * 5;
    const oy = Math.floor((code - 32) / 16) * 8;
    for (let i = 0; i < 35; i++) if (glyph[i] === "#") c.set(ox + (i % 5), oy + Math.floor(i / 5), [255, 255, 255]);
  }
  c.write("font.png");
}

// -- sound ----------------------------------------------------------------------------------------------------------------------
const RATE = 22050;

function wav(samples: Float32Array, rate = RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const square = (phase: number, duty = 0.5): number => (phase % 1 < duty ? 1 : -1);
const saw = (phase: number): number => 2 * (phase % 1) - 1;
let seed = 12345;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};

/** A tone sweeping from `from` to `to` Hz over `seconds`, with a volume envelope. */
function sweep(seconds: number, from: number, to: number, shape: (phase: number) => number, volume = 0.4, decay = 3): Float32Array {
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

function noiseBurst(seconds: number, volume: number, lowpass: number): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += (random() - last) * lowpass;
    out[i] = last * volume * Math.pow(1 - i / n, 2);
  }
  return out;
}

function sfx(): void {
  writeFileSync(join(assets, "jump.wav"), wav(sweep(0.14, 260, 620, (p) => square(p, 0.4), 0.32, 2.5)));
  const dash = noiseBurst(0.18, 0.7, 0.35);
  const dashTone = sweep(0.18, 700, 180, saw, 0.2, 3);
  writeFileSync(join(assets, "dash.wav"), wav(dash.map((v, i) => v + (dashTone[i] as number))));
  writeFileSync(join(assets, "land.wav"), wav(sweep(0.09, 140, 55, (p) => Math.sin(p * 2 * Math.PI), 0.7, 4)));
  const death = sweep(0.4, 520, 70, saw, 0.3, 2.2);
  const deathNoise = noiseBurst(0.4, 0.3, 0.5);
  writeFileSync(join(assets, "death.wav"), wav(death.map((v, i) => v + (deathNoise[i] as number))));
  const gem = new Float32Array(Math.round(0.36 * RATE));
  [0, 0.09, 0.18].forEach((start, k) => {
    const note = sweep(0.17, [660, 880, 1320][k] as number, [660, 880, 1320][k] as number, (p) => square(p, 0.25), 0.28, 3);
    note.forEach((v, i) => (gem[Math.round(start * RATE) + i] = (gem[Math.round(start * RATE) + i] as number) + v));
  });
  writeFileSync(join(assets, "gem.wav"), wav(gem));
  writeFileSync(join(assets, "start.wav"), wav(sweep(0.2, 440, 880, (p) => square(p, 0.5), 0.3, 2)));
}

/** A 16-second loop: a bass line and a lead over a minor pentatonic, 96 beats a minute. */
function music(): void {
  const rate = 16000;
  const bpm = 96;
  const beat = 60 / bpm;
  const bars = 8;
  const total = Math.round(bars * 4 * beat * rate);
  const out = new Float32Array(total);
  const note = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
  // A minor pentatonic: A C D E G.
  const bass = [45, 45, 52, 45, 43, 43, 50, 43, 48, 48, 55, 48, 40, 40, 47, 40];
  const lead = [
    [69, 0, 72, 74],
    [76, 0, 74, 72],
    [74, 0, 72, 69],
    [67, 0, 69, 0],
    [72, 0, 74, 76],
    [79, 0, 76, 74],
    [72, 0, 69, 67],
    [69, 0, 0, 0],
  ];
  const place = (start: number, length: number, hz: number, volume: number, shape: (p: number) => number): void => {
    const s = Math.round(start * rate);
    const n = Math.round(length * rate);
    let phase = 0;
    for (let i = 0; i < n && s + i < total; i++) {
      phase += hz / rate;
      const env = Math.min(1, i / 80) * Math.pow(1 - i / n, 1.4);
      out[s + i] = (out[s + i] as number) + shape(phase) * volume * env;
    }
  };
  for (let b = 0; b < bars * 2; b++) place(b * 2 * beat, beat * 0.9, note(bass[b % bass.length] as number), 0.22, (p) => square(p, 0.3));
  for (let b = 0; b < bars; b++) {
    const bar = lead[b % lead.length] as number[];
    bar.forEach((midi, k) => {
      if (midi !== 0) place((b * 4 + k) * beat, beat * 0.8, note(midi), 0.16, (p) => square(p, 0.25));
    });
  }
  // A soft hat on the off-beats.
  for (let k = 0; k < bars * 4; k++) {
    const s = Math.round((k * beat + beat / 2) * rate);
    for (let i = 0; i < 700 && s + i < total; i++) out[s + i] = (out[s + i] as number) + random() * 0.05 * (1 - i / 700);
  }
  writeFileSync(join(assets, "theme.wav"), wav(out, rate));
}

tiles();
hero();
font();
sfx();
music();
console.log("wrote the tile sheet, the character, the font, five sound effects and the music loop to", assets);
