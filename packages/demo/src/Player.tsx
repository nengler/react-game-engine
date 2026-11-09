import { useInput, useRef, useState, useUpdate, Entity, Shape } from "@rge/runtime/jsx";

/** A square that moves with the arrow keys or WASD, at 140 pixels per second. */
export function Player() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
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
      <Shape kind="rect" width={24} height={24} color="gold" />
    </Entity>
  );
}
