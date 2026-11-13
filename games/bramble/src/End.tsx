import { Entity, Text, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

export function End() {
  const { toTitle } = useGame.actions();
  const time = useGame((s) => s.run.time);
  useInput((input) => {
    if (input.pressed("confirm")) toTitle();
  });
  const minutes = Math.floor(time / 60);
  const seconds = String(Math.floor(time % 60)).padStart(2, "0");
  return (
    <Entity>
      <Text transform={{ x: 0, y: 55 }} width={320} align="center" size={20} color="#e8d9a8">The gate opens.</Text>
      <Text transform={{ x: 0, y: 85 }} width={320} align="center" size={10} color="#a7b0c8">{`Time ${minutes}:${seconds}`}</Text>
      <Text transform={{ x: 0, y: 120 }} width={320} align="center" size={10} color="#a7b0c8">Press Enter</Text>
    </Entity>
  );
}
