/**
 * Writes the game's art and sound effects from Kenney's free CC0 packs (kenney.nl), and its music. The Kenney files used are
 * copied into `tools/kenney/` under their pack's name and number (`tiny-dungeon-0084.png` is Tiny Dungeon's `tile_0084.png`;
 * the sounds are converted to WAV), so this runs offline. It lays the tiles out as the sheets the game reads: the packs are
 * 16 × 16, the game's tile size, so nothing is scaled. Run with `npm run assets`; the outputs are committed.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodePng, encodePng } from "@tsengine/player-node";

import { TILE } from "../src/rules/constants.ts";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "../assets");
mkdirSync(assets, { recursive: true });

// ---- Sheets made of Kenney tiles. ----
interface Image {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}
const kenney = (name: string): Image => decodePng(readFileSync(join(here, "kenney", `${name}.png`)));
const blank = (width: number, height: number): Image => ({ width, height, rgba: new Uint8Array(width * height * 4) });

/** Draw `src` into `dst` at (dx, dy), each source pixel `scale` × `scale`, mirrored if asked; transparent pixels are skipped. */
function blit(dst: Image, src: Image, dx: number, dy: number, { flipX = false, scale = 1 } = {}): void {
  for (let y = 0; y < src.height * scale; y++) {
    for (let x = 0; x < src.width * scale; x++) {
      const sx = Math.floor((flipX ? src.width * scale - 1 - x : x) / scale);
      const from = (Math.floor(y / scale) * src.width + sx) * 4;
      if (src.rgba[from + 3] === 0) continue;
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      dst.rgba.set(src.rgba.subarray(from, from + 4), (ty * dst.width + tx) * 4);
    }
  }
}

/** A row of 16 × 16 frames, one per entry, in order. */
function strip(frames: readonly ((frame: Image) => void)[]): Image {
  const sheet = blank(frames.length * TILE, TILE);
  frames.forEach((draw, i) => {
    const frame = blank(TILE, TILE);
    draw(frame);
    blit(sheet, frame, i * TILE, 0);
  });
  return sheet;
}
const tile =
  (name: string, options: { flipX?: boolean; scale?: number } = {}) =>
  (frame: Image): void =>
    blit(frame, kenney(name), 0, 0, options);

/** Micro Roguelike's tiles sit on a solid background: its near-black pixels are made transparent. */
function keyed(name: string): Image {
  const image = kenney(name);
  const rgba = image.rgba.slice();
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! + rgba[i + 1]! + rgba[i + 2]! < 120) rgba[i + 3] = 0;
  return { ...image, rgba };
}

/** The bell: Kenney's packs have none, so it is drawn here in their style (a dark outline around flat colour with one highlight). */
function bell(frame: Image): void {
  const rows = [
    "................",
    "......####......",
    "......#bb#......",
    ".....######.....",
    "....#yyyyyy#....",
    "...#ywyyyyyy#...",
    "...#ywyyyyyy#...",
    "...#ywyyyyyy#...",
    "...#yyyyyyyy#...",
    "..#yyyyyyyyyy#..",
    "..#oooooooooo#..",
    "..############..",
    "......#bb#......",
    ".......##.......",
    "................",
    "................",
  ];
  const colors: Record<string, readonly number[]> = {
    "#": [0x3f, 0x26, 0x31],
    y: [0xf3, 0xb2, 0x3e],
    o: [0xc8, 0x76, 0x2c],
    w: [0xff, 0xec, 0xb0],
    b: [0x8e, 0x52, 0x2e],
  };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x]!];
      if (c !== undefined) frame.rgba.set([...c, 255], (y * frame.width + x) * 4);
    }
  });
}

// The ground (`assets/tiles.png`), in the order the maps' tile ids count: 1 grass, 2 stone wall, 3 water.
const tiles = strip([tile("tiny-town-0000"), tile("tiny-town-0126"), tile("tiny-battle-0037")]);
writeFileSync(join(assets, "tiles.png"), encodePng(tiles));
console.log("wrote assets/tiles.png");

// Everything on the ground (`assets/things.png`), in the order `src/rules/view.ts` (FRAME) counts.
const things = strip([
  tile("tiny-dungeon-0084"), // 0 the apprentice (a wizard), facing down
  tile("tiny-dungeon-0084"), // 1 facing up: the pack draws characters from the front only
  tile("tiny-dungeon-0084", { flipX: true }), // 2 facing left
  tile("tiny-dungeon-0084"), // 3 facing right
  tile("tiny-dungeon-0122"), // 4 the beetle (a spider)
  tile("tiny-dungeon-0121"), // 5 the wisp (a ghost)
  tile("tiny-dungeon-0085"), // 6 a villager
  (frame) => blit(frame, keyed("micro-roguelike-0039"), 0, 0, { scale: 2 }), // 7 the lantern (an 8 × 8 tile, doubled)
  tile("tiny-town-0117"), // 8 the key
  tile("tiny-farm-0088"), // 9 the shears (a sickle)
  bell, // 10 the bell
  tile("tiny-dungeon-0065"), // 11 a shrine (a carved stone)
  tile("tiny-dungeon-0045"), // 12 a door
  tile("tiny-dungeon-0057"), // 13 the gate (a barred grate)
  tile("tiny-farm-0078"), // 14 a bush (a bramble with berries)
  tile("tiny-dungeon-0104"), // 15 the swing (a sword)
]);
writeFileSync(join(assets, "things.png"), encodePng(things));
console.log("wrote assets/things.png");

// ---- Sound: Kenney's effects, and a looping theme synthesised here (16-bit mono PCM WAVs). ----
function wav(samples: Float64Array, rate = 22050): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 0.5 * 32767), i * 2);
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
/** A sequence of notes [hz, seconds], each fading out, with a wave shape; 0 hz is a rest. */
function notes(
  seq: readonly (readonly [number, number])[],
  shape: (phase: number) => number = Math.sin,
  volume = 1,
  rate = 22050
): Float64Array {
  const total = seq.reduce((n, [, s]) => n + Math.round(s * rate), 0);
  const out = new Float64Array(total);
  let at = 0;
  for (const [hz, seconds] of seq) {
    const n = Math.round(seconds * rate);
    for (let i = 0; i < n; i++)
      out[at + i] = hz === 0 ? 0 : shape(2 * Math.PI * hz * (i / rate)) * volume * Math.min(1, i / 200) * (1 - i / n) ** 1.5;
    at += n;
  }
  return out;
}
const tri = (p: number): number => (2 / Math.PI) * Math.asin(Math.sin(p));
const save = (name: string, samples: Float64Array): void => writeFileSync(join(assets, name), wav(samples));
// The effects are Kenney's (Digital Audio, Interface Sounds, Impact Sounds, RPG Audio, Music Jingles), as 22.05 kHz mono WAVs in
// `tools/kenney/`.
const sounds: Record<string, string> = {
  "pickup.wav": "digital-audio-power-up-2",
  "talk.wav": "interface-sounds-tick-002",
  "swing.wav": "rpg-audio-knife-slice",
  "hit.wav": "impact-sounds-impact-soft-medium-000",
  "hurt.wav": "impact-sounds-impact-punch-heavy-000",
  "shrine.wav": "interface-sounds-maximize-008",
  "door.wav": "rpg-audio-door-open-1",
  "deny.wav": "interface-sounds-error-004",
  "cut.wav": "rpg-audio-chop",
  "win.wav": "music-jingles-jingles-nes-12",
};
for (const [name, source] of Object.entries(sounds)) copyFileSync(join(here, "kenney", `${source}.wav`), join(assets, name));

// The theme: a slow eight-bar loop of triangle notes over a drone, in A minor.
const bar = (a: number, b: number, c: number): [number, number][] => [
  [a, 0.5],
  [b, 0.5],
  [c, 0.5],
  [b, 0.5],
];
const melody = [
  ...bar(220, 261.6, 329.6),
  ...bar(196, 246.9, 293.7),
  ...bar(174.6, 220, 261.6),
  ...bar(196, 246.9, 293.7),
  ...bar(220, 261.6, 329.6),
  ...bar(164.8, 207.7, 246.9),
  ...bar(174.6, 220, 261.6),
  ...bar(220, 261.6, 220),
];
save("theme.wav", notes(melody, tri, 0.55));
console.log("wrote the sounds and the theme");
