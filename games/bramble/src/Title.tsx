import { Entity, Text, useInput } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";

export function Title() {
  const begin = useGame((s) => s.begin);
  useInput((input) => {
    if (input.pressed("confirm")) begin();
  });
  return (
    <Entity name="Title">
      <Text transform={{ x: 0, y: 60 }} width={320} align="center" size={30} color="#e8d9a8" text="BRAMBLE" />
      <Text transform={{ x: 0, y: 110 }} width={320} align="center" size={10} color="#a7b0c8" text="Press Enter" />
    </Entity>
  );
}
