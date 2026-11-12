/**
 * Writes the game's art: for now the ground tiles (`assets/tiles.png`: floor, wall, water). Original, made here, and committed.
 * Run with `npm run assets`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { TILE } from "../src/rules/constants.ts";

const assets = join(dirname(fileURLToPath(import.meta.url)), "../assets");
mkdirSync(assets, { recursive: true });

type Rgb = readonly [number, number, number];

/** An RGBA PNG from a flat array of width × height × 4 bytes. */
function rgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function png(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Three tiles side by side: grass, stone wall, water. A little speckle so a flat field does not look like an error. */
const tiles = png(TILE * 3, TILE, (x, y) => {
  const tile = Math.floor(x / TILE);
  const lx = x % TILE;
  const speck = (lx * 7 + y * 13) % 11 === 0;
  if (tile === 0) return speck ? [74, 132, 78] : [88, 150, 92];
  if (tile === 1) return lx === 0 || y === 0 || lx === TILE - 1 || y === TILE - 1 ? [70, 72, 82] : speck ? [118, 120, 132] : [104, 106, 118];
  return (lx + y * 3) % 9 < 2 ? [92, 150, 214] : [58, 112, 188];
});
writeFileSync(join(assets, "tiles.png"), tiles);
console.log("wrote assets/tiles.png");

// ---- Sprites: sixteen 16 x 16 frames in a row (RGBA), drawn here with a few lines each. ----
const FRAMES = 16;
const sheet = new Uint8Array(FRAMES * TILE * TILE * 4);
function px(frame: number, x: number, y: number, color: string): void {
  if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
  const at = (y * FRAMES * TILE + frame * TILE + x) * 4;
  const n = parseInt(color.slice(1), 16);
  sheet[at] = (n >> 16) & 255;
  sheet[at + 1] = (n >> 8) & 255;
  sheet[at + 2] = n & 255;
  sheet[at + 3] = 255;
}
const box = (frame: number, x0: number, y0: number, w: number, h: number, color: string): void => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(frame, x, y, color);
};
const disc = (frame: number, cx: number, cy: number, r: number, color: string): void => {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r / 2) px(frame, cx + x, cy + y, color);
};

// 0 to 3: the keeper's apprentice, facing down, up, left, right (a hooded figure with a lantern-orange scarf).
for (let f = 0; f < 4; f++) {
  box(f, 5, 4, 6, 9, "#3b5a7a"); // cloak
  box(f, 5, 3, 6, 1, "#2c4560");
  disc(f, 8, 6, 3, "#e9c9a0"); // face
  box(f, 5, 3, 6, 3, "#3b5a7a"); // hood
  box(f, 5, 9, 6, 2, "#f28b3c"); // scarf
  box(f, 5, 13, 2, 2, "#2c2f3a"); // boots
  box(f, 9, 13, 2, 2, "#2c2f3a");
}
box(0, 6, 5, 4, 3, "#e9c9a0"); px(0, 7, 6, "#222"); px(0, 9, 6, "#222");
box(2, 5, 5, 2, 3, "#e9c9a0"); px(2, 5, 6, "#222");
box(3, 9, 5, 2, 3, "#e9c9a0"); px(3, 10, 6, "#222");
// 4: a beetle: shell, legs, two feelers.
disc(4, 8, 9, 5, "#7a3b2a"); box(4, 3, 8, 10, 1, "#5a2a1e"); box(4, 7, 3, 1, 3, "#3a1a12"); box(4, 9, 3, 1, 3, "#3a1a12");
for (const x of [3, 5, 10, 12]) box(4, x, 13, 1, 2, "#3a1a12");
// 5: a wisp: a glowing drop with a tail.
disc(5, 8, 7, 4, "#b58cff"); disc(5, 8, 7, 2, "#f1e6ff"); box(5, 7, 11, 2, 3, "#8a63d6"); px(5, 8, 14, "#6a49a8");
// 6: a villager: a robe and a hat.
box(6, 4, 6, 8, 9, "#8a6a3a"); disc(6, 8, 5, 3, "#e9c9a0"); box(6, 4, 2, 8, 2, "#5a4a2a"); box(6, 6, 0, 4, 2, "#5a4a2a"); px(6, 7, 5, "#222"); px(6, 9, 5, "#222");
// 7: the lantern. 8: the key. 9: the shears. 10: a bell.
box(7, 5, 3, 6, 10, "#f2e05a"); box(7, 4, 2, 8, 1, "#8a7a2a"); box(7, 4, 13, 8, 1, "#8a7a2a"); box(7, 7, 5, 2, 6, "#fff6b0");
disc(8, 5, 5, 3, "#d8d8d8"); disc(8, 5, 5, 1, "#10131c"); box(8, 7, 5, 7, 2, "#d8d8d8"); box(8, 11, 7, 2, 3, "#d8d8d8");
box(9, 3, 3, 3, 5, "#c8c8d0"); box(9, 10, 3, 3, 5, "#c8c8d0"); box(9, 6, 7, 4, 2, "#9a9aa6"); box(9, 4, 9, 2, 5, "#8a5a2a"); box(9, 10, 9, 2, 5, "#8a5a2a");
box(10, 5, 4, 6, 7, "#d9b64a"); box(10, 4, 11, 8, 2, "#d9b64a"); box(10, 7, 2, 2, 2, "#8a7a2a"); disc(10, 8, 14, 1, "#8a7a2a");
// 11: a shrine: a stone with a glowing rune. 12: a door. 13: the gate. 14: a bush. 15: the swing.
box(11, 4, 3, 8, 11, "#7a7e8c"); box(11, 3, 12, 10, 2, "#5a5e6c"); box(11, 7, 5, 2, 6, "#6fd6d0"); box(11, 5, 7, 6, 2, "#6fd6d0");
box(12, 2, 0, 12, 16, "#6b4a2b"); box(12, 3, 1, 10, 14, "#8a6338"); box(12, 11, 8, 2, 2, "#d9b64a");
box(13, 0, 0, 16, 16, "#9a7a2a"); box(13, 2, 2, 12, 12, "#d9b64a"); box(13, 7, 2, 2, 12, "#9a7a2a"); disc(13, 8, 8, 2, "#fff1b0");
disc(14, 8, 8, 7, "#2f7a3a"); disc(14, 6, 6, 3, "#3f9a4a"); disc(14, 11, 10, 3, "#256a30"); for (const [x, y] of [[5, 10], [10, 5], [8, 12]] as const) px(14, x, y, "#d95a6a");
for (let i = 2; i < 14; i++) { px(15, i, 3, "#ffffff"); px(15, i, 12, "#ffffff"); } for (let i = 3; i < 13; i++) { px(15, 2, i, "#ffffff"); px(15, 13, i, "#ffffff"); }
writeFileSync(join(assets, "things.png"), rgbaPng(FRAMES * TILE, TILE, sheet));
console.log("wrote assets/things.png");

// ---- Sound: short synthesised effects and a looping theme (16-bit mono PCM WAVs). ----
function wav(samples: Float64Array, rate = 22050): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 0.5 * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
/** A sequence of notes [hz, seconds], each fading out, with a wave shape; 0 hz is a rest. */
function notes(seq: readonly (readonly [number, number])[], shape: (phase: number) => number = Math.sin, volume = 1, rate = 22050): Float64Array {
  const total = seq.reduce((n, [, s]) => n + Math.round(s * rate), 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const [hz, seconds] of seq) {
    const n = Math.round(seconds * rate);
    for (let i = 0; i < n; i++) out[at + i] = hz === 0 ? 0 : shape(2 * Math.PI * hz * (i / rate)) * volume * Math.min(1, i / 200) * (1 - i / n) ** 1.5;
    at += n;
  }
  return out;
}
const square = (p: number): number => (Math.sin(p) >= 0 ? 0.6 : -0.6);
const tri = (p: number): number => (2 / Math.PI) * Math.asin(Math.sin(p));
const save = (name: string, samples: Float64Array): void => writeFileSync(join(assets, name), wav(samples));
save("pickup.wav", notes([[660, 0.07], [880, 0.07], [1320, 0.14]], square, 0.6));
save("talk.wav", notes([[320, 0.04]], square, 0.4));
save("swing.wav", notes([[300, 0.05], [200, 0.08]], square, 0.5));
save("hit.wav", notes([[150, 0.1], [90, 0.12]], square, 0.8));
save("hurt.wav", notes([[220, 0.1], [110, 0.2]], tri, 1));
save("shrine.wav", notes([[523, 0.12], [659, 0.12], [784, 0.12], [1046, 0.3]], tri, 0.9));
save("door.wav", notes([[180, 0.08], [140, 0.1]], tri, 0.8));
save("deny.wav", notes([[140, 0.1], [120, 0.15]], square, 0.5));
save("cut.wav", notes([[900, 0.03], [600, 0.05]], square, 0.5));
save("win.wav", notes([[523, 0.15], [659, 0.15], [784, 0.15], [1046, 0.5], [784, 0.15], [1046, 0.6]], tri, 1));
// The theme: a slow eight-bar loop of triangle notes over a drone, in A minor.
const bar = (a: number, b: number, c: number): [number, number][] => [[a, 0.5], [b, 0.5], [c, 0.5], [b, 0.5]];
const melody = [...bar(220, 261.6, 329.6), ...bar(196, 246.9, 293.7), ...bar(174.6, 220, 261.6), ...bar(196, 246.9, 293.7), ...bar(220, 261.6, 329.6), ...bar(164.8, 207.7, 246.9), ...bar(174.6, 220, 261.6), ...bar(220, 261.6, 220)];
save("theme.wav", notes(melody, tri, 0.55));
console.log("wrote the sounds and the theme");
