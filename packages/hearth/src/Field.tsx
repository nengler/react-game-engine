import { Entity, Sprite, Tilemap } from "@rge/runtime/jsx";

import { HEARTH } from "./rules/map.ts";

/** The ground: the map's tiles, and the hearth where the path ends. */
export function Field() {
  return (
    <Entity>
      <Tilemap map="field" image="tiles.png" layer="Tiles" />
      <Sprite image="hearth.png" originX={10} originY={14} x={HEARTH.x - 4} y={HEARTH.y + 4} />
    </Entity>
  );
}
