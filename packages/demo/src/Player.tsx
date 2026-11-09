import { useInput, useRef, useState, useUpdate, Collider, Entity, Shape } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * A square that moves with the arrow keys or WASD, at 140 pixels per second. It collects coins (added to the game's
 * shared `stats.coins`, which the HUD shows) and turns red while it overlaps spikes: `other.tag` tells them apart, and the exit event ends the hurt.
 */
export function Player() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  // Setters for two leaves of the game's state. The player only sets them, so a change never re-renders it.
  const [, setCoins] = useGame((s) => s.stats.coins);
  const [, setHits] = useGame((s) => s.stats.hits);
  const [hurt, setHurt] = useState(false);
  // The direction held this frame: refs hold values that must not cause a render.
  const moveX = useRef(0);
  const moveY = useRef(0);

  useInput((input) => {
    moveX.current = (input.down("ArrowRight") || input.down("D") ? 1 : 0) - (input.down("ArrowLeft") || input.down("A") ? 1 : 0);
    moveY.current = (input.down("ArrowDown") || input.down("S") ? 1 : 0) - (input.down("ArrowUp") || input.down("W") ? 1 : 0);
  });

  useUpdate((dt) => {
    setX((x) => x + moveX.current * 140 * dt);
    setY((y) => y + moveY.current * 140 * dt);
  });

  return (
    <Entity name="Player" transform={{ x, y }}>
      <Shape kind="rect" width={24} height={24} color={hurt ? "tomato" : "gold"} />
      <Collider
        width={24}
        height={24}
        tag="player"
        layer="player"
        onCollisionEnter={(other) => {
          if (other.tag === "coin") {
            setCoins((n) => n + 1);
          } else if (other.tag === "spikes") {
            setHurt(true);
            setHits((n) => n + 1);
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
