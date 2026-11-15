import { useInput, Game, Screen, Text } from "@rge/runtime/jsx";

import { useGame } from "./GameState.ts";
import { Hero } from "./Hero.tsx";

/** The root. Move the hero with the arrow keys; Z counts a step. */
export default function Main() {
  const steps = useGame((s) => s.steps);
  const { step } = useGame.actions();

  // A press is something that happens once: it goes in useInput.
  useInput((input) => {
    if (input.pressed("Z")) step();
  });

  return (
    <Game title="__NAME__" width={320} height={180} background="#10131c" assets="assets" font="font.png" textSize={8}>
      <Screen width={320} height={180} fit="integer">
        <Hero />
        <Text x={8} y={8} color="white">{`steps: ${steps}`}</Text>
      </Screen>
    </Game>
  );
}
