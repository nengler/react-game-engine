import { MAP } from "./map.ts";
import { pathAt } from "./path.ts";
import { TOWERS, type TowerKind } from "./towers.ts";

/** How many pixels of the path a pad's tower of this kind could reach: where a sensible player builds first. */
export function coverage(pad: number, kind: TowerKind): number {
  const p = MAP.pads[pad]!;
  let n = 0;
  for (let d = 0; d <= MAP.path.length; d += 2) {
    const at = pathAt(MAP.path, d);
    if (Math.hypot(at.x - p.x, at.y - p.y) <= TOWERS[kind].range) n += 2;
  }
  return n;
}

export const BEST = [...MAP.pads].map((p) => p.id).sort((a, b) => coverage(b, "bolt") - coverage(a, "bolt") || a - b);
