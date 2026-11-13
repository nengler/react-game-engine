import { Entity, Sprite, Tilemap } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { spotsOf } from "./rules/view.ts";

/** The map the character is on: its ground from the Tiled map (drawn from the sheet its tileset names), and over it the things the rules know about, each a frame of `things.png`. */
export function World() {
  const run = useGame((s) => s.run);
  return (
    <Entity>
      <Tilemap map={run.map} layer="Ground" />
      {spotsOf(run).map((spot) => (
        <Sprite key={spot.id} image="things.png" frameWidth={16} frameHeight={16} frame={spot.frame} transform={{ x: spot.x, y: spot.y }} />
      ))}
    </Entity>
  );
}
