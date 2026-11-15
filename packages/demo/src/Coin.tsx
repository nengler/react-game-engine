import { useMutable, Collider, Entity, Shape } from "@tsengine/runtime/jsx";

/**
 * Something to collect. It reads who touched it from the other collider's `owner` (the name of the entity the
 * collider belongs to), and vanishes. Its collider is on the "item" layer and only hits the player's layer.
 */
export function Coin() {
  const s = useMutable({ taken: false });

  return (
    <Entity>
      {!s.taken && <Shape kind="circle" width={16} height={16} color="#e8a317" />}
      {!s.taken && (
        <Collider
          width={16}
          height={16}
          tag="coin"
          layer="item"
          hits={["player"]}
          onCollisionEnter={(other) => {
            if (other.owner === "Player") {
              s.taken = true;
            }
          }}
        />
      )}
    </Entity>
  );
}
