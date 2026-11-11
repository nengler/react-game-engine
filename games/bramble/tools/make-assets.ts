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
