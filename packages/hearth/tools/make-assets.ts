/**
 * Writes the game's assets: the art is laid out from Kenney's CC0 packs (kenney.nl: Tiny Battle, Tiny Town, Tiny Dungeon, Tower
 * Defense, Pixel Platformer), and the sound effects are Kenney's too; the files used are copied into `tools/kenney/`, named after
 * their pack. The music loop is made here in code, and the bitmap font is Kite's own file copied across. Run it with
 * `npm run hearth:assets`; the outputs are committed. `assets/README.md` lists them.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  blank,
  draw,
  grey,
  kenneyFolder,
  nearest,
  outline,
  place,
  save,
  shrinkSmooth,
  solid,
  tint,
  trim,
  turn,
  type Image,
} from "../../../tools/sprite-kit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kenney = kenneyFolder(join(here, "kenney"));
const assets = join(here, "../assets");
mkdirSync(assets, { recursive: true });

type Rgb = readonly [number, number, number];

// -- palette ------------------------------------------------------------------------------------------------------------
// Each tower kind's colour, which tints its turret (and its shot, for the bolt).
const KIND_COLOR: Record<string, { light: Rgb }> = {
  bolt: { light: [0xff, 0xd8, 0x6a] },
  mortar: { light: [0xff, 0x8a, 0x70] },
  frost: { light: [0x9a, 0xe4, 0xff] },
};
const KINDS = ["bolt", "mortar", "frost"] as const;
// The dark outline Kenney's tiny packs draw around everything, added to the Tower Defense pieces so they match.
const INK: Rgb = [0x3f, 0x26, 0x31];

// -- tiles: 8 × 4 of 10 × 10 ----------------------------------------------------------------------------------------------
// 1 grass, 2 grass with flowers, 3 path (Tiny Battle and Tiny Town, 16 × 16 shrunk to 10 × 10), 4 build pad (Tower Defense's
// square plate on grass). The rest are empty: tiles 10-12 and 20 up are the Markers layer's.
function tiles(): void {
  const sheet = blank(80, 40);
  ["tiny-battle-0000", "tiny-battle-0001", "tiny-town-0025", "tiny-battle-0000"].forEach((name, i) =>
    place(sheet, i, 10, 10, nearest(kenney(name), 10, 10))
  );
  place(sheet, 3, 10, 10, outline(solid(shrinkSmooth(kenney("tower-defense-0180"), 8, 8)), INK));
  save(assets, "tiles.png", sheet);
}

// -- enemies: 14 × 14 frames, 4 to a row; row 0 runner (a bat), 1 grunt (a slime), 2 brute (a cyclops), from Tiny Dungeon ---------
// The walk is the picture bobbing a pixel; it faces right (the game flips it for left).
function enemies(): void {
  const sheet = blank(56, 42);
  ["tiny-dungeon-0120", "tiny-dungeon-0108", "tiny-dungeon-0109"].forEach((name, row) => {
    const enemy = nearest(kenney(name), 14, 14);
    for (let f = 0; f < 4; f++) place(sheet, row * 4 + f, 14, 14, enemy, { dy: f % 2 === 0 ? 0 : -1 });
  });
  save(assets, "enemies.png", sheet);
}

// -- towers: 12 × 12 frames, three to a row; frame = kind × 3 + level (rows: bolt, mortar, frost) ---------------------------------
// From Kenney's Tower Defense pack (128 × 128, averaged down and given the tiny packs' dark outline): a square plate, and a
// cannon in the kind's colour that grows with each level. The barrel points right from the middle of its frame; the game turns
// it around (6, 6).
function towers(): void {
  const bases = blank(36, 36);
  const barrels = blank(36, 36);
  const plate = outline(solid(shrinkSmooth(kenney("tower-defense-0180"), 10, 10)), INK);
  KINDS.forEach((kind, k) => {
    for (let level = 0; level < 3; level++) {
      place(bases, k * 3 + level, 12, 12, plate);
      place(barrels, k * 3 + level, 12, 12, cannon(kind, 8 + level));
    }
  });
  save(assets, "tower_bases.png", bases);
  save(assets, "barrels.png", barrels);
}

/** The cannon (Tower Defense's tile 249, its barrel turned to point right), `size` pixels square, in the kind's colour. */
function cannon(kind: (typeof KINDS)[number], size: number): Image {
  return outline(tint(grey(turn(solid(shrinkSmooth(kenney("tower-defense-0249"), size, size)), 1)), KIND_COLOR[kind]!.light), INK);
}

// -- icons: 10 × 10, six of them: bolt, mortar, frost, gold, lives, wave -----------------------------------------------------------
// The three towers (plate and turret), a Pixel Platformer coin, and Tiny Battle's heart and flag.
function icons(): void {
  const sheet = blank(60, 10);
  KINDS.forEach((kind, i) => {
    place(sheet, i, 10, 10, cannon(kind, 8));
  });
  place(sheet, 3, 10, 10, nearest(trim(kenney("pixel-platformer-0151")), 10, 10));
  place(sheet, 4, 10, 10, nearest(trim(kenney("tiny-battle-0195")), 10, 9));
  place(sheet, 5, 10, 10, nearest(trim(kenney("tiny-battle-0194")), 9, 10));
  save(assets, "icons.png", sheet);
}

// -- shots: 8 × 8, four: bolt, shell, muzzle flash, spark (Tower Defense's bullets and its white star) ---------------------------------
function shots(): void {
  const sheet = blank(32, 8);
  const small = (name: string, size: number): Image => shrinkSmooth(trim(kenney(name)), size, size);
  place(sheet, 0, 8, 8, tint(small("tower-defense-0272", 4), KIND_COLOR.bolt!.light));
  place(sheet, 1, 8, 8, small("tower-defense-0274", 6));
  place(sheet, 2, 8, 8, small("tower-defense-0022", 7));
  place(sheet, 3, 8, 8, small("tower-defense-0272", 3));
  save(assets, "shots.png", sheet);
}

// -- the hearth: 20 × 20, two frames: Tiny Battle's headquarters with a flickering Tower Defense flame on the roof ------------------
function hearth(): void {
  const sheet = blank(40, 20);
  ["tower-defense-0295", "tower-defense-0296"].forEach((flame, f) => {
    place(sheet, f, 20, 20, kenney("tiny-battle-0009"), { bottom: true });
    draw(sheet, shrinkSmooth(trim(kenney(flame)), 4, 6), f * 20 + 8, 0);
  });
  save(assets, "hearth.png", sheet);
}

// -- the cursor: Tiny Battle's corner brackets, 14 × 14 ------------------------------------------------------------------------------
function cursor(): void {
  save(assets, "cursor.png", nearest(kenney("tiny-battle-0061"), 14, 14));
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
const sine = (phase: number): number => Math.sin(phase * 2 * Math.PI);
let seed = 4242;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};

/** The effects: Kenney's sounds (Interface, Impact, Sci-fi, Digital, RPG audio, Music Jingles), as 22.05 kHz mono WAVs in `tools/kenney/`. */
function sfx(): void {
  const sounds: Record<string, string> = {
    "build.wav": "impact-sounds-impact-plank-medium-000",
    "upgrade.wav": "digital-audio-power-up-5",
    "sell.wav": "rpg-audio-handle-coins",
    "deny.wav": "interface-sounds-error-004",
    "bolt.wav": "sci-fi-sounds-laser-small-000",
    "mortar.wav": "impact-sounds-impact-punch-heavy-000",
    "frost.wav": "interface-sounds-glass-001",
    "hit.wav": "impact-sounds-impact-generic-light-000",
    "boom.wav": "sci-fi-sounds-explosion-crunch-000",
    "death.wav": "digital-audio-zap-two-tone",
    "leak.wav": "digital-audio-low-down",
    "wave.wav": "interface-sounds-maximize-006",
    "win.wav": "music-jingles-jingles-nes-12",
    "lose.wav": "music-jingles-jingles-nes-11",
    "click.wav": "interface-sounds-click-001",
  };
  for (const [name, source] of Object.entries(sounds)) copyFileSync(join(here, "kenney", `${source}.wav`), join(assets, name));
}

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
