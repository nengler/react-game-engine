import { useMutable, useUpdate, Collider, Entity, Shape } from "@tsengine/runtime/jsx";

import { useGame } from "./GameState.ts";

/**
 * A square that moves with the arrow keys or WASD, at 140 pixels per second. It collects coins (added to the game's
 * shared `stats.coins`, which the HUD shows) and turns red while it overlaps spikes: `other.tag` tells them apart, and the exit event ends the hurt.
 */
export function Player() {
  const s = useMutable({ x: 0, y: 0, hurt: false });
  // Actions of the game's state: the player calls them and reads nothing, so a change never re-renders it.
  const { collect, hit } = useGame.actions();

  // The keys held this step: useUpdate gets the same input as useInput.
  useUpdate((dt, input) => {
    const moveX = (input.down("ArrowRight") || input.down("D") ? 1 : 0) - (input.down("ArrowLeft") || input.down("A") ? 1 : 0);
    const moveY = (input.down("ArrowDown") || input.down("S") ? 1 : 0) - (input.down("ArrowUp") || input.down("W") ? 1 : 0);
    s.x += moveX * 140 * dt;
    s.y += moveY * 140 * dt;
  });

  return (
    <Entity x={s.x} y={s.y}>
      <Shape kind="rect" width={24} height={24} color={s.hurt ? "tomato" : "gold"} />
      <Collider
        width={24}
        height={24}
        tag="player"
        layer="player"
        onCollisionEnter={(other) => {
          if (other.tag === "coin") {
            collect();
          } else if (other.tag === "spikes") {
            s.hurt = true;
            hit();
          }
        }}
        onCollisionExit={(other) => {
          if (other.tag === "spikes") {
            s.hurt = false;
          }
        }}
      />
    </Entity>
  );
}
