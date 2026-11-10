import { Collider, Entity, Shape } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * The optional pickup, off the main path of room 7. A collider on the "item" layer that only hits the player's layer: the
 * character's own collider tells the game state when it is touched. It is gone once picked up.
 */
export function Gem() {
  const gems = useGame((s) => s.gems);
  const taken = gems > 0;

  return (
    <Entity name="Gem">
      {!taken && <Shape kind="circle" width={8} height={8} color="#7de3ff" />}
      {!taken && <Shape kind="circle" width={4} height={4} color="#e8fbff" transform={{ x: 2, y: 1 }} />}
      {!taken && <Collider width={8} height={8} tag="gem" layer="item" hits={["player"]} />}
    </Entity>
  );
}
