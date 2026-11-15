/**
 * Writes the game's assets, all made here in code (nothing is copied from anywhere, but the bitmap font, which is Kite's own file
 * copied across): the tile sheet, the enemies, the towers and their barrels, the shots, the icons, the hearth, the cursor, the
 * sound effects and the music loop. Run it with `npm run hearth:assets`; the outputs are committed. `assets/README.md` lists them.
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

// -- palette ------------------------------------------------------------------------------------------------------------
const GRASS: Rgb = [0x2b, 0x4a, 0x3a];
const GRASS_DARK: Rgb = [0x25, 0x41, 0x34];
const TUFT: Rgb = [0x4a, 0x7a, 0x4e];
const DIRT: Rgb = [0x8a, 0x6a, 0x48];
const DIRT_DARK: Rgb = [0x7a, 0x5c, 0x3e];
const DIRT_LIGHT: Rgb = [0x9c, 0x7a, 0x55];
const PLATE: Rgb = [0x56, 0x5f, 0x7a];
const PLATE_LIGHT: Rgb = [0x7d, 0x88, 0xa8];
const PLATE_DARK: Rgb = [0x3e, 0x46, 0x5e];
const INK: Rgb = [0x1a, 0x16, 0x24];
const WHITE: Rgb = [0xff, 0xf1, 0xd6];

const KIND_COLOR: Record<string, { main: Rgb; light: Rgb; dark: Rgb }> = {
  bolt: { main: [0xf2, 0xb1, 0x3c], light: [0xff, 0xdd, 0x7a], dark: [0xb0, 0x78, 0x1e] },
  mortar: { main: [0xd9, 0x5a, 0x43], light: [0xf2, 0x93, 0x7a], dark: [0x9a, 0x3a, 0x2c] },
  frost: { main: [0x5a, 0xc8, 0xe8], light: [0xb8, 0xf0, 0xff], dark: [0x32, 0x86, 0xa8] },
};
const KINDS = ["bolt", "mortar", "frost"] as const;

const noise = (x: number, y: number): number => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 7;

// -- tiles: 8 × 4 of 10 × 10 ----------------------------------------------------------------------------------------------
// 1 grass, 2 grass with a tuft, 3 path, 4 build pad. The rest are empty: tiles 10-12 and 20 up are the Markers layer's.
function tiles(): void {
  const c = new Canvas(80, 40);
  for (let i = 0; i < 4; i++) {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const n = noise(i * 10 + x, y);
        if (i < 2) c.set(i * 10 + x, y, n === 0 ? GRASS_DARK : GRASS);
        else if (i === 2) c.set(i * 10 + x, y, n === 0 ? DIRT_DARK : n === 1 ? DIRT_LIGHT : DIRT);
        else c.set(i * 10 + x, y, GRASS);
      }
    }
  }
  // A tuft of grass blades.
  for (const [x, y] of [
    [13, 5],
    [14, 4],
    [15, 5],
    [14, 6],
    [17, 2],
    [18, 1],
  ] as const)
    c.set(x, y, TUFT);
  // The pad: a round stone plate.
  c.disc(35, 5, 4.4, PLATE_DARK);
  c.disc(35, 4.6, 4, PLATE);
  c.disc(34.4, 3.8, 2.2, PLATE_LIGHT);
  c.write("tiles.png");
}

// -- enemies: 14 × 14 frames, 4 to a row; row 0 runner, 1 grunt, 2 brute ----------------------------------------------------------
function enemies(): void {
  const c = new Canvas(56, 42);
  const look: Record<string, { body: Rgb; shade: Rgb; r: number }> = {
    runner: { body: [0xe8, 0xd0, 0x5a], shade: [0xb0, 0x98, 0x32], r: 3 },
    grunt: { body: [0x7a, 0xc4, 0x6a], shade: [0x4e, 0x8c, 0x44], r: 4.2 },
    brute: { body: [0xb0, 0x6a, 0xc0], shade: [0x7a, 0x3e, 0x8a], r: 6 },
  };
  (["runner", "grunt", "brute"] as const).forEach((kind, row) => {
    const { body, shade, r } = look[kind] as { body: Rgb; shade: Rgb; r: number };
    for (let f = 0; f < 4; f++) {
      const ox = f * 14 + 7;
      const oy = row * 14 + 7;
      const bob = f % 2 === 0 ? 0 : -1;
      // Two feet taking turns, then the body, with an eye on the right (the game flips it for left).
      const step = [-1, 0, 1, 0][f] as number;
      c.rect(ox - r * 0.6 - 1 + step, oy + r - 1, 3, 2, shade);
      c.rect(ox + r * 0.6 - 2 - step, oy + r - 1, 3, 2, shade);
      c.disc(ox, oy + bob, r, shade);
      c.disc(ox - 0.3, oy + bob - 0.5, r - 0.8, body);
      c.set(ox + r * 0.45, oy + bob - 1, INK);
      c.set(ox + r * 0.45, oy + bob, INK);
      if (kind === "brute") {
        c.set(ox - 3, oy + bob - 6, shade);
        c.set(ox + 3, oy + bob - 6, shade);
      }
    }
  });
  c.write("enemies.png");
}

// -- towers: 12 × 12 frames, three to a row; frame = kind × 3 + level (rows: bolt, mortar, frost) ---------------------------------
function towers(): void {
  const bases = new Canvas(36, 36);
  const barrels = new Canvas(36, 36);
  KINDS.forEach((kind, k) => {
    const col = KIND_COLOR[kind] as { main: Rgb; light: Rgb; dark: Rgb };
    for (let level = 0; level < 3; level++) {
      const ox = level * 12;
      const oy = k * 12;
      // A plinth: round, with a rim in the tower's colour that grows a ring per level.
      bases.disc(ox + 6, oy + 6, 5.2, PLATE_DARK);
      bases.disc(ox + 6, oy + 5.6, 4.8, PLATE);
      for (let i = 0; i <= level; i++) bases.disc(ox + 6, oy + 6, 5.5 - i * 1.4 - 0.5, i % 2 === 0 ? col.dark : col.main);
      bases.disc(ox + 6, oy + 6, 1.8 + (2 - level) * 0.1, PLATE_DARK);
      // The barrel points right from the middle of its frame; the game turns it around (6, 6).
      const len = 5 + level * 0.5;
      if (kind === "bolt") {
        barrels.rect(ox + 6, oy + 5, len, 2, col.main);
        barrels.rect(ox + 6, oy + 5, len, 1, col.light);
        barrels.rect(ox + 6 + len - 1, oy + 4, 1, 4, col.dark);
      } else if (kind === "mortar") {
        barrels.rect(ox + 5, oy + 4, len - 0.5, 4, col.dark);
        barrels.rect(ox + 5, oy + 4, len - 0.5, 1, col.main);
        barrels.rect(ox + 5 + len - 1, oy + 3, 2, 6, col.main);
        barrels.set(ox + 5 + len, oy + 5, INK);
        barrels.set(ox + 5 + len, oy + 6, INK);
      } else {
        // A crystal: a diamond that gets longer with each level.
        for (let i = 0; i < len + 1; i++) {
          const half = Math.max(0.5, 2 - Math.abs(i - len / 2) * (2 / (len / 2)));
          for (let j = -Math.floor(half); j <= Math.floor(half); j++) barrels.set(ox + 5 + i, oy + 6 + j, j < 0 ? col.light : col.main);
        }
      }
    }
  });
  bases.write("tower_bases.png");
  barrels.write("barrels.png");
}

// -- icons: 10 × 10, six of them: bolt, mortar, frost, gold, lives, wave -----------------------------------------------------------
function icons(): void {
  const c = new Canvas(60, 10);
  KINDS.forEach((kind, i) => {
    const col = KIND_COLOR[kind] as { main: Rgb; light: Rgb; dark: Rgb };
    c.disc(i * 10 + 5, 5, 4.2, col.dark);
    c.disc(i * 10 + 5, 4.6, 3.6, col.main);
    c.disc(i * 10 + 4.2, 3.6, 1.4, col.light);
  });
  // Gold: a coin.
  c.disc(35, 5, 4, [0xb0, 0x78, 0x1e]);
  c.disc(35, 5, 3.2, [0xf2, 0xc8, 0x3c]);
  c.rect(35, 3, 1, 4, [0xb0, 0x78, 0x1e]);
  // Lives: a heart.
  const heart = ["01100110", "11111111", "11111111", "01111110", "00111100", "00011000"];
  heart.forEach((row, y) => [...row].forEach((ch, x) => ch === "1" && c.set(41 + x, 2 + y, [0xe0, 0x4a, 0x5a])));
  // Wave: a pennant on a pole.
  c.rect(51, 1, 1, 8, WHITE);
  for (let y = 0; y < 4; y++) c.rect(52, 1 + y, 5 - y, 1, [0x5a, 0xc8, 0xe8]);
  c.write("icons.png");
}

// -- shots: 8 × 8, four: bolt, shell, muzzle flash, spark ------------------------------------------------------------------------
function shots(): void {
  const c = new Canvas(32, 8);
  const b = KIND_COLOR.bolt as { main: Rgb; light: Rgb };
  c.disc(4, 4, 2.2, b.main);
  c.disc(3.6, 3.6, 1.1, b.light);
  const m = KIND_COLOR.mortar as { main: Rgb; light: Rgb; dark: Rgb };
  c.disc(12, 4, 3, m.dark);
  c.disc(11.6, 3.6, 2, m.main);
  c.set(11, 3, m.light);
  for (const [x, y] of [
    [20, 4],
    [19, 4],
    [21, 4],
    [20, 3],
    [20, 5],
    [18, 2],
    [22, 2],
    [18, 6],
    [22, 6],
  ] as const)
    c.set(x, y, WHITE);
  c.disc(28, 4, 1.4, [0xff, 0xdd, 0x7a]);
  c.write("shots.png");
}

// -- the hearth: 20 × 20, two flickering frames ------------------------------------------------------------------------------------
function hearth(): void {
  const c = new Canvas(40, 20);
  for (let f = 0; f < 2; f++) {
    const ox = f * 20;
    c.rect(ox + 2, 8, 16, 11, PLATE_DARK);
    c.rect(ox + 2, 8, 16, 2, PLATE_LIGHT);
    c.rect(ox + 4, 10, 12, 9, PLATE);
    c.rect(ox + 6, 12, 8, 7, INK);
    const flame = f === 0 ? 6 : 8;
    c.disc(ox + 10, 17, 3.2, [0xd9, 0x5a, 0x43]);
    c.disc(ox + 10, 17 - flame / 4, 2.4, [0xf2, 0xb1, 0x3c]);
    c.disc(ox + 10, 16 - flame / 4, 1.2, [0xff, 0xf1, 0xd6]);
    for (let y = 0; y < 3; y++) c.set(ox + 10 + (f === 0 ? -1 : 1), 6 - y * 2, [0x8e, 0x9a, 0xc2]);
  }
  c.write("hearth.png");
}

// -- the cursor: four corner brackets around a 14 × 14 square ----------------------------------------------------------------------
function cursor(): void {
  const c = new Canvas(14, 14);
  for (const [x, y, dx, dy] of [
    [0, 0, 1, 1],
    [13, 0, -1, 1],
    [0, 13, 1, -1],
    [13, 13, -1, -1],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      c.set(x + dx * i, y, WHITE);
      c.set(x, y + dy * i, WHITE);
    }
  }
  c.write("cursor.png");
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
const sine = (phase: number): number => Math.sin(phase * 2 * Math.PI);
let seed = 4242;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};

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

const mix = (...parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) p.forEach((v, i) => (out[i] = (out[i] as number) + v));
  return out;
};

/** Notes one after another: `[hz, seconds]` each, with the shape and volume given. */
function melody(notes: readonly (readonly [number, number])[], shape: (p: number) => number, volume: number, decay = 2.5): Float32Array {
  const total = notes.reduce((a, [, s]) => a + s, 0);
  const out = new Float32Array(Math.round(total * RATE) + 200);
  let at = 0;
  for (const [hz, seconds] of notes) {
    sweep(seconds * 1.4, hz, hz, shape, volume, decay).forEach((v, i) => {
      const j = Math.round(at * RATE) + i;
      if (j < out.length) out[j] = (out[j] as number) + v;
    });
    at += seconds;
  }
  return out;
}

function sfx(): void {
  const put = (name: string, samples: Float32Array): void => writeFileSync(join(assets, name), wav(samples));
  put(
    "build.wav",
    mix(
      melody(
        [
          [330, 0.06],
          [494, 0.1],
        ],
        (p) => square(p, 0.4),
        0.3
      ),
      noiseBurst(0.08, 0.25, 0.3)
    )
  );
  put(
    "upgrade.wav",
    melody(
      [
        [392, 0.07],
        [523, 0.07],
        [659, 0.12],
      ],
      (p) => square(p, 0.25),
      0.28
    )
  );
  put(
    "sell.wav",
    melody(
      [
        [784, 0.06],
        [523, 0.06],
        [392, 0.1],
      ],
      sine,
      0.4
    )
  );
  put("deny.wav", sweep(0.14, 150, 110, square, 0.25, 2));
  put(
    "bolt.wav",
    sweep(0.07, 900, 500, (p) => square(p, 0.3), 0.18, 3)
  );
  put("mortar.wav", mix(sweep(0.18, 160, 50, sine, 0.7, 3), noiseBurst(0.12, 0.25, 0.2)));
  put("frost.wav", mix(sweep(0.25, 1500, 2200, sine, 0.22, 3), sweep(0.25, 2000, 3000, sine, 0.12, 4)));
  put("hit.wav", sweep(0.04, 600, 300, saw, 0.15, 4));
  put("boom.wav", mix(noiseBurst(0.25, 0.8, 0.25), sweep(0.25, 120, 40, sine, 0.5, 3)));
  put("death.wav", mix(sweep(0.16, 500, 200, saw, 0.22, 3), noiseBurst(0.1, 0.25, 0.4)));
  put("leak.wav", sweep(0.3, 260, 90, square, 0.3, 2));
  put(
    "wave.wav",
    melody(
      [
        [262, 0.12],
        [262, 0.12],
        [392, 0.3],
      ],
      (p) => square(p, 0.5),
      0.26,
      1.5
    )
  );
  put(
    "win.wav",
    melody(
      [
        [523, 0.12],
        [659, 0.12],
        [784, 0.12],
        [1047, 0.4],
      ],
      (p) => square(p, 0.25),
      0.28,
      1.5
    )
  );
  put(
    "lose.wav",
    melody(
      [
        [392, 0.2],
        [330, 0.2],
        [262, 0.2],
        [196, 0.5],
      ],
      saw,
      0.26,
      1.5
    )
  );
  put("click.wav", sweep(0.03, 800, 800, square, 0.15, 4));
}

/** A 20-second loop: a warm bass and a lead on a C major pentatonic, 84 beats a minute. */
function music(): void {
  const rate = 16000;
  const beat = 60 / 84;
  const bars = 8;
  const total = Math.round(bars * 4 * beat * rate);
  const out = new Float32Array(total);
  const note = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
  const bass = [36, 36, 43, 36, 33, 33, 40, 33, 38, 38, 45, 38, 31, 31, 38, 31];
  const lead = [
    [72, 0, 76, 79],
    [76, 0, 74, 72],
    [69, 0, 72, 76],
    [74, 0, 72, 0],
    [79, 0, 76, 74],
    [72, 0, 74, 76],
    [74, 0, 71, 67],
    [72, 0, 0, 0],
  ];
  const place = (start: number, length: number, hz: number, volume: number, shape: (p: number) => number): void => {
    const s = Math.round(start * rate);
    const n = Math.round(length * rate);
    let phase = 0;
    for (let i = 0; i < n && s + i < total; i++) {
      phase += hz / rate;
      out[s + i] = (out[s + i] as number) + shape(phase) * volume * Math.min(1, i / 80) * Math.pow(1 - i / n, 1.3);
    }
  };
  for (let b = 0; b < bars * 2; b++) place(b * 2 * beat, beat * 1.7, note(bass[b % bass.length] as number), 0.24, (p) => sine(p));
  for (let b = 0; b < bars; b++)
    (lead[b % lead.length] as number[]).forEach(
      (midi, k) => midi !== 0 && place((b * 4 + k) * beat, beat * 0.9, note(midi), 0.13, (p) => square(p, 0.3))
    );
  for (let k = 0; k < bars * 4; k++) {
    const s = Math.round((k * beat + beat / 2) * rate);
    for (let i = 0; i < 500 && s + i < total; i++) out[s + i] = (out[s + i] as number) + random() * 0.04 * (1 - i / 500);
  }
  writeFileSync(join(assets, "theme.wav"), wav(out, rate));
}

tiles();
enemies();
towers();
icons();
shots();
hearth();
cursor();
sfx();
music();
console.log("wrote the sheets, fifteen sound effects and the music loop to", assets);
