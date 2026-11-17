import { Entity, Sprite } from "@tsengine/runtime/jsx";

import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./rules/constants.ts";
import { hash2 } from "./rules/rng.ts";

const TILE = 32;
const COLS = Math.ceil(SCREEN_WIDTH / TILE) + 2;
const ROWS = Math.ceil(SCREEN_HEIGHT / TILE) + 2;

interface GroundProps {
  /** The middle of the view. */
  cx: number;
  cy: number;
}

/**
 * The endless field: the 32-pixel cells around the view, each showing a tile picked by hashing its cell, so a cell looks the same
 * every time it comes back into view. Keyed by cell, so only the row or column that comes into view is new.
 */
export function Ground({ cx, cy }: GroundProps) {
  const left = Math.floor((cx - SCREEN_WIDTH / 2) / TILE) - 1;
  const top = Math.floor((cy - SCREEN_HEIGHT / 2) / TILE) - 1;
  const cells: { key: string; x: number; y: number; frame: number }[] = [];
  for (let r = 0; r < ROWS + 1; r++)
    for (let c = 0; c < COLS + 1; c++) {
      const col = left + c;
      const row = top + r;
      const h = hash2(col, row);
      cells.push({ key: `${col},${row}`, x: col * TILE, y: row * TILE, frame: h < 0.7 ? 0 : h < 0.85 ? 1 : h < 0.95 ? 2 : 3 });
    }
  return (
    <Entity>
      {cells.map((c) => (
        <Sprite key={c.key} image="ground.png" frameWidth={TILE} frameHeight={TILE} frame={c.frame} x={c.x} y={c.y} />
      ))}
    </Entity>
  );
}
