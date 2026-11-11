import { Entity, Text, useInput, useMount } from "@rge/runtime/jsx";
import { useGame } from "./GameState.ts";
import { Menu } from "./Menu.tsx";

export function Title() {
  const moveCursor = useGame((s) => s.moveCursor);
  const activate = useGame((s) => s.activate);
  const openTitle = useGame((s) => s.openTitle);
  useMount(() => {
    openTitle();
  });
  useInput((input) => {
    if (input.pressed("up")) moveCursor(-1);
    if (input.pressed("down")) moveCursor(1);
    if (input.pressed("confirm")) activate();
  });
  return (
    <Entity name="Title">
      <Text transform={{ x: 0, y: 30 }} width={320} align="center" size={30} color="#e8d9a8" text="BRAMBLE" />
      <Menu top={90} />
    </Entity>
  );
}
