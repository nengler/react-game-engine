import { useState, useUpdate, Collider, Entity, Shape } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * A square that moves with the arrow keys or WASD, at 140 pixels per second. It collects coins (added to the game's
 * shared `stats.coins`, which the HUD shows) and turns red while it overlaps spikes: `other.tag` tells them apart, and the exit event ends the hurt.
 */
export function Player() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  // Actions of the game's state: the player calls them and reads nothing, so a change never re-renders it.
  const { collect, hit } = useGame.actions();
  const [hurt, setHurt] = useState(false);

  // The keys held this step: useUpdate gets the same input as useInput.
  useUpdate((dt, input) => {
    const moveX = (input.down("ArrowRight") || input.down("D") ? 1 : 0) - (input.down("ArrowLeft") || input.down("A") ? 1 : 0);
    const moveY = (input.down("ArrowDown") || input.down("S") ? 1 : 0) - (input.down("ArrowUp") || input.down("W") ? 1 : 0);
    setX((x) => x + moveX * 140 * dt);
    setY((y) => y + moveY * 140 * dt);
  });

  return (
    <Entity x={x} y={y}>
      <Shape kind="rect" width={24} height={24} color={hurt ? "tomato" : "gold"} />
      <Collider
        width={24}
        height={24}
        tag="player"
        layer="player"
        onCollisionEnter={(other) => {
          if (other.tag === "coin") {
            collect();
          } else if (other.tag === "spikes") {
            setHurt(true);
            hit();
          }
        }}
        onCollisionExit={(other) => {
          if (other.tag === "spikes") {
            setHurt(false);
          }
        }}
      />
    </Entity>
  );
}
