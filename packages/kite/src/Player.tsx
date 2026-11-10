import { useInput, useRef, useUpdate, Entity, Shape } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

/**
 * The character. It reads the buttons, hands them to the game state's `step` (all the movement rules are plain functions
 * in `rules/`), and draws a box where the body is. Arrows or WASD move, Z, C or Space jump, X or Shift dash.
 */
export function Player() {
  const x = useGame((s) => s.player.x);
  const y = useGame((s) => s.player.y);
  const originX = useGame((s) => s.originX);
  const originY = useGame((s) => s.originY);
  const dead = useGame((s) => s.dead);
  const dashes = useGame((s) => s.player.dashes);
  const step = useGame((s) => s.step);
  const buttons = useRef(0);

  useInput((input) => {
    buttons.current =
      (input.down("ArrowLeft") || input.down("A") ? 1 : 0) +
      (input.down("ArrowRight") || input.down("D") ? 2 : 0) +
      (input.down("ArrowUp") || input.down("W") ? 4 : 0) +
      (input.down("ArrowDown") || input.down("S") ? 8 : 0) +
      (input.down("Z") || input.down("C") || input.down("Space") ? 16 : 0) +
      (input.pressed("Z") || input.pressed("C") || input.pressed("Space") ? 32 : 0) +
      (input.pressed("X") || input.pressed("Shift") ? 64 : 0);
  });

  useUpdate((dt) => {
    step(buttons.current, dt);
  });

  return (
    <Entity name="Player" transform={{ x: originX + x, y: originY + y }}>
      {!dead && <Shape kind="rect" width={8} height={11} color={dashes > 0 ? "#ff7a59" : "#59b8ff"} />}
    </Entity>
  );
}
