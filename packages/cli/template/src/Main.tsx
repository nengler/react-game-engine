import { useInput, useState, useUpdate, Entity, Game, Screen, Sprite, Text } from "@rge/runtime/jsx";
import { moveBy } from "./rules/move.ts";
import { useGame } from "./GameState.ts";

/** The root. Move the hero with the arrow keys; Z counts a step. */
export default function Main() {
  const [x, setX] = useState(160);
  const [y, setY] = useState(90);
  const steps = useGame((s) => s.steps);
  const { step } = useGame.actions();

  // A press is something that happens once: it goes in useInput.
  useInput((input) => {
    if (input.pressed("Z")) step();
  });
  // Movement is over time: it reads the held keys in useUpdate, which gets the same input as useInput.
  useUpdate((dt, input) => {
    const dirX = (input.down("ArrowRight") ? 1 : 0) - (input.down("ArrowLeft") ? 1 : 0);
    const dirY = (input.down("ArrowDown") ? 1 : 0) - (input.down("ArrowUp") ? 1 : 0);
    setX((x) => moveBy(x, dirX, dt));
    setY((y) => moveBy(y, dirY, dt));
  });

  return (
    <Game title="__NAME__" width={320} height={180} background="#10131c" assets="assets">
      <Screen width={320} height={180} fit="integer">
        <Entity name="Hero" transform={{ x, y }}>
          <Sprite image="hero.png" originX={8} originY={8} />
        </Entity>
        <Text transform={{ x: 8, y: 8 }} size={12} color="white">{`steps: ${steps}`}</Text>
      </Screen>
    </Game>
  );
}
