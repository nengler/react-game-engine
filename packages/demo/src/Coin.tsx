import { useState, Collider, Entity, Shape } from "@rge/runtime/jsx";

/**
 * Something to collect. It reads who touched it from the other collider's `owner` (the name of the entity the
 * collider belongs to), and vanishes. Its collider is on the "item" layer and only hits the player's layer.
 */
export function Coin() {
  const [taken, setTaken] = useState(false);

  return (
    <Entity name="Coin">
      {!taken && <Shape kind="circle" width={16} height={16} color="#e8a317" />}
      {!taken && (
        <Collider
          width={16}
          height={16}
          tag="coin"
          layer="item"
          hits={["player"]}
          onCollisionEnter={(other) => {
            if (other.owner === "Player") {
              setTaken(true);
            }
          }}
        />
      )}
    </Entity>
  );
}
