import { useInput, useRef, useState, useUpdate, Collider, Entity, Shape, Text } from "@rge/runtime/jsx";

/**
 * A square that moves with the arrow keys or WASD, at 140 pixels per second. It collects coins (counted above it) and
 * turns red while it overlaps spikes: `other.tag` tells them apart, and the exit event ends the hurt.
 */
export function Player() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [coins, setCoins] = useState(0);
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
      <Text size={12} color="white" transform={{ x: 0, y: -16 }}>
        Coins: {coins}
      </Text>
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
