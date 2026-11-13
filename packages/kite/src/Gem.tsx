import { Collider, Entity, Shape } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/** The optional pickup, off the main path of room 7: it takes itself when the character touches it, and is gone after. */
export function Gem() {
  const gems = useGame((s) => s.gems);
  const collect = useGame((s) => s.collect);

  return (
    <Entity>
      {gems === 0 && (
        <>
          <Shape kind="circle" width={8} height={8} color="#7de3ff" />
          <Shape kind="circle" width={4} height={4} color="#e8fbff" transform={{ x: 2, y: 1 }} />
          <Collider
            width={8}
            height={8}
            tag="gem"
            layer="item"
            hits={["player"]}
            onCollisionEnter={(other) => {
              if (other.tag === "player") {
                collect();
              }
            }}
          />
        </>
      )}
    </Entity>
  );
}
