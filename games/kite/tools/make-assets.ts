/**
 * Writes the game's assets: the tile sheet and the character's sheet from Kenney's Pixel Platformer pack (CC0, kenney.nl, the
 * tiles used are copied into `tools/kenney/`), and, made here in code, a 5 × 7 pixel font, the death burst and the music loop.
 * The sound effects come from Kenney's audio packs (`tools/kenney/*.wav`). Run it with `npm run kite:assets`; the outputs are
 * committed, and `assets/README.md` says where each came from.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "@tsengine/player-node";

import { blank, kenneyFolder, nearest, place, save, turn, type Image } from "../../../tools/sprite-kit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kenney = kenneyFolder(join(here, "kenney"));
const assets = join(here, "../assets");
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
// The death burst's two colours, the alien's greens.
const BODY: Rgb = [0x6f, 0xd6, 0x7c];
const SCARF: Rgb = [0x2f, 0x9a, 0x5a];

// -- tiles: 8 × 2 of 10 × 10 ----------------------------------------------------------------------------------------------
// 1 dirt, 2 dirt with grass on top, 3-6 spikes (up, down, left, right), 7 exit, 8 start, 9 end marker (the last three are empty).
// Kenney's Pixel Platformer tiles are 18 × 18; each is shrunk to 10 × 10 by taking every other pixel or so.
function tiles(): void {
  const sheet = blank(80, 20);
  const tile = (name: string): Image => nearest(kenney(name), 10, 10);
  place(sheet, 0, 10, 10, tile("pixel-platformer-0122"));
  place(sheet, 1, 10, 10, tile("pixel-platformer-0002"));
  const spikes = tile("pixel-platformer-0068"); // points up, sitting on the bottom of its tile
  place(sheet, 2, 10, 10, spikes);
  place(sheet, 3, 10, 10, turn(spikes, 2));
  place(sheet, 4, 10, 10, turn(spikes, 3));
  place(sheet, 5, 10, 10, turn(spikes, 1));
  save(assets, "tiles.png", sheet);
}

// -- the character: 12 × 12 frames, 8 per row ---------------------------------------------------------------------------------
// 0-1 idle, 2-7 run, 8 jump, 9 fall, 10 wall slide, 11 dash, 12-15 death. It faces right; the game mirrors it for left.
// The character is Kenney's Pixel Platformer alien (two 24 × 24 frames, halved); the death burst is drawn here.
function hero(): void {
  const sheet = blank(96, 24);
  const [a, b] = [kenney("pixel-platformer-0000"), kenney("pixel-platformer-0001")].map((f) => nearest(f, 12, 12)) as [Image, Image];
  const frames = [a, b, a, b, a, b, a, b, b, a, a, b];
  frames.forEach((f, i) => place(sheet, i, 12, 12, f));
  for (let i = 0; i < 4; i++) {
    // A burst: pixels flying outward from the middle, in the alien's colours.
    const r = 2 + i * 2;
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4;
      const x = ((12 + i) % 8) * 12 + Math.round(6 + Math.cos(angle) * r);
      const y = 12 + Math.round(7 + Math.sin(angle) * r);
      if (x < 0 || y < 12 || y >= 24) continue;
      sheet.rgba.set([...(k % 2 ? BODY : SCARF), 255], (y * 96 + x) * 4);
    }
  }
  save(assets, "hero.png", sheet);
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
let seed = 12345;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};

/** The effects: Kenney's sounds (Digital Audio, Impact Sounds, Interface Sounds), converted to 22.05 kHz mono WAVs in `tools/kenney/`. */
function sfx(): void {
  const sounds: Record<string, string> = {
    "jump.wav": "digital-audio-phase-jump-1",
    "dash.wav": "digital-audio-zap-1",
    "land.wav": "impact-sounds-footstep-concrete-000",
    "death.wav": "digital-audio-zap-three-tone-down",
    "gem.wav": "digital-audio-power-up-2",
    "start.wav": "interface-sounds-confirmation-001",
  };
  for (const [name, source] of Object.entries(sounds)) copyFileSync(join(here, "kenney", `${source}.wav`), join(assets, name));
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
